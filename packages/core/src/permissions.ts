/**
 * The permission registry — every capability the till has, in one file.
 *
 * ADR-0012 §6 chose this over a roles/permissions/role_permissions schema. For
 * a shop with two to five staff that would be three tables, three screens and a
 * join to answer a question a static object answers at compile time — and it
 * would move "what a cashier can do" out of code review and into production
 * data, where it cannot be tested.
 *
 * Two properties this file must keep:
 *
 *   1. **An unknown key is a compile error.** `PermissionKey` is derived from
 *      the registry, so a typo at a call site does not silently deny.
 *   2. **Adding a role or a module is an edit HERE and nowhere else.** The
 *      Usuarios override toggles and the Approval modal both render from this
 *      registry, so new keys appear in both with no UI change. See the
 *      "Reserved for future modules" section of ADR-0012.
 */

/** Groups the Usuarios screen renders as sections, in this order. */
export const PERMISSION_MODULES = ["sale", "catalog", "inventory", "admin"] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export interface PermissionDef {
  key: string;
  module: PermissionModule;
  /** Spanish label shown in Usuarios and in the Approval modal (ADR-0011). */
  labelEs: string;
  /**
   * Can a second person authorize this for someone who lacks it? Setting this
   * is the ENTIRE cost of making an action approvable — the modal reads it.
   */
  approvable: boolean;
}

export const PERMISSIONS = [
  /* ---- sale ---- */
  { key: "sale.create", module: "sale", labelEs: "Vender", approvable: false },
  { key: "sale.park", module: "sale", labelEs: "Aparcar tickets", approvable: false },
  { key: "sale.resume", module: "sale", labelEs: "Recuperar tickets aparcados", approvable: false },
  { key: "sale.price_override", module: "sale", labelEs: "Modificar el precio de una línea", approvable: true },

  /* ---- catalog ---- */
  { key: "catalog.view", module: "catalog", labelEs: "Ver el catálogo", approvable: false },
  { key: "catalog.attach_code", module: "catalog", labelEs: "Asignar un código a un artículo", approvable: false },
  { key: "catalog.create", module: "catalog", labelEs: "Crear artículos", approvable: true },
  { key: "catalog.edit", module: "catalog", labelEs: "Editar artículos", approvable: true },

  /* ---- inventory ---- */
  { key: "inventory.view", module: "inventory", labelEs: "Ver el inventario", approvable: false },
  { key: "inventory.receive", module: "inventory", labelEs: "Registrar entradas de stock", approvable: false },
  // registered before its screen exists: the key is the contract, the UI arrives later
  { key: "inventory.adjust", module: "inventory", labelEs: "Ajustar stock", approvable: true },

  /* ---- admin: owner-only, and not approvable ---- */
  // a cashier does not manage users with the owner leaning over their shoulder;
  // the owner signs in themselves
  { key: "users.manage", module: "admin", labelEs: "Gestionar usuarios", approvable: false },
  { key: "settings.edit", module: "admin", labelEs: "Cambiar ajustes", approvable: false },
  { key: "backup.manage", module: "admin", labelEs: "Gestionar copias de seguridad", approvable: false },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const BY_KEY = new Map<string, PermissionDef>(PERMISSIONS.map((p) => [p.key, p]));

export function permissionDef(key: PermissionKey): PermissionDef {
  return BY_KEY.get(key)!;
}

export function isApprovable(key: string): boolean {
  return BY_KEY.get(key)?.approvable === true;
}

/** For the Approval modal and Usuarios — never invent a label from the key. */
export function permissionLabelEs(key: string): string {
  return BY_KEY.get(key)?.labelEs ?? key;
}

/* ---------------------------------------------------------------- roles */

export const ROLES = ["owner", "cashier"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS_ES: Record<Role, string> = {
  owner: "Responsable",
  cashier: "Cajero",
};

/**
 * What each role gets before overrides.
 *
 * The owner is deliberately NOT a list: `can()` short-circuits, so nobody can
 * lock the owner out of their own shop — including themselves, via a stray
 * override.
 *
 * A cashier can sell, look at the catalogue and stock, receive deliveries, and
 * attach an unknown barcode to a product while receiving. Everything else is
 * either approvable (they press the button and the owner types a PIN) or
 * owner-only (the button is not there).
 */
export const CASHIER_DEFAULTS: readonly PermissionKey[] = [
  "sale.create",
  "sale.park",
  "sale.resume",
  "catalog.view",
  "catalog.attach_code",
  "inventory.view",
  "inventory.receive",
];

const ROLE_DEFAULTS: Record<Role, readonly PermissionKey[] | "all"> = {
  owner: "all",
  cashier: CASHIER_DEFAULTS,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------- resolution */

/** The shape `can()` needs. Deliberately not the DB row — no hash comes near it. */
export interface PermissionSubject {
  role: string;
  /** key → boolean, layered over the role's defaults. Either direction. */
  overrides?: Record<string, boolean> | null;
}

/**
 * Context for resource-level rules. Unused today and part of the signature from
 * day one on purpose (ADR-0012, Rule 3): "a technician may only edit repairs
 * assigned to them" must land inside `can()` without editing a single call
 * site, and adding the parameter later would mean editing all of them.
 */
export interface PermissionCtx {
  [key: string]: unknown;
}

/**
 * The whole authorization decision.
 *
 * Owner short-circuits: ADR-0012 §7. Otherwise role defaults, then the user's
 * override if it names this key — an override wins in BOTH directions, so a
 * specific cashier can be granted `catalog.edit` or denied `inventory.receive`
 * without inventing a role for them.
 */
export function can(
  subject: PermissionSubject | null,
  key: PermissionKey,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx?: PermissionCtx,
): boolean {
  if (!subject) return false;
  if (subject.role === "owner") return true;

  const override = subject.overrides?.[key];
  if (typeof override === "boolean") return override;

  const defaults = isRole(subject.role) ? ROLE_DEFAULTS[subject.role] : [];
  if (defaults === "all") return true;
  return defaults.includes(key);
}

/** Every key this subject holds — what the renderer receives in SessionInfo. */
export function resolvePermissions(subject: PermissionSubject): PermissionKey[] {
  return PERMISSIONS.map((p) => p.key).filter((key) => can(subject, key));
}

/** Which of a subject's permissions differ from their role's defaults. */
export function effectiveOverrides(subject: PermissionSubject): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const { key } of PERMISSIONS) {
    const override = subject.overrides?.[key];
    if (typeof override === "boolean") out[key] = override;
  }
  return out;
}

/**
 * Is this key a default for the role? Usuarios shows "Por defecto" /
 * "Permitido" / "Bloqueado" so it is obvious which toggles the owner changed.
 */
export function isRoleDefault(role: string, key: PermissionKey): boolean {
  if (role === "owner") return true;
  const defaults = isRole(role) ? ROLE_DEFAULTS[role] : [];
  return defaults === "all" || defaults.includes(key);
}
