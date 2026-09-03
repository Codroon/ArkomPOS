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
export const PERMISSION_MODULES = ["sale", "catalog", "inventory", "transfers", "usedDevices", "repair", "workshop", "cash", "reports", "admin"] as const;
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
  /* Giving money back. Approvable rather than owner-only: the customer is at
     the counter and a cashier presses the button, an owner completes it
     (ADR-0012, ADR-0019). */
  { key: "sale.refund", module: "sale", labelEs: "Devolver una venta", approvable: true },
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
  /* Seeing the supplier list and adding a name to it.
     Deliberately NOT `inventory.receive`: a technician ordering a part needs to
     say who it is coming from, and receiving stock is withheld from them for a
     reason that has nothing to do with knowing the shop's suppliers
     (ADR-0012 §"what a technician may do"). Low stakes both ways — a supplier
     is a name on a list until a delivery or a part order references it. */
  { key: "supplier.manage", module: "inventory", labelEs: "Ver y añadir proveedores", approvable: false },

  /* ---- transfers: the WU counter (ADR-0018) ----
     Counter work: a cashier sends, pays out and reads the log by default. A
     CANCEL is approvable — it hands back money that is already out of the
     drawer, which is the one transfer action with a way to lose cash. */
  { key: "transfers.view", module: "transfers", labelEs: "Ver el registro de giros", approvable: false },
  { key: "transfers.create", module: "transfers", labelEs: "Registrar envíos y pagos", approvable: false },
  { key: "transfers.cancel", module: "transfers", labelEs: "Cancelar un giro", approvable: true },
  /* verification is counter work and moves no money at all (ADR-0019) */
  { key: "transfers.verify", module: "transfers", labelEs: "Verificar giros", approvable: false },
  /* the MTCN is the key the reconciliation import joins on: changing it
     re-points the row at a different WU transaction */
  { key: "transfers.editMtcn", module: "transfers", labelEs: "Corregir el MTCN de un giro", approvable: false },

  /* ---- used devices (ADR-0013) ----
     Buying is counter work, so the cashier holds most of these by default. The
     two they do not hold are the two that cost the shop money or expose a
     third party: overriding an agreed price, and reading the seller's ID. */
  { key: "usedDevices.create", module: "usedDevices", labelEs: "Comprar dispositivos usados", approvable: false },
  { key: "usedDevices.priceOverride", module: "usedDevices", labelEs: "Modificar el precio de compra sugerido", approvable: true },
  { key: "usedDevices.sendToInventory", module: "usedDevices", labelEs: "Enviar un dispositivo a inventario", approvable: false },
  { key: "usedDevices.editRefurbCost", module: "usedDevices", labelEs: "Editar el coste de reacondicionamiento", approvable: false },
  // personal data of someone who is not a customer: off by default, grantable
  { key: "usedDevices.viewSeller", module: "usedDevices", labelEs: "Ver los datos del vendedor", approvable: false },
  { key: "usedDevices.redeemCredit", module: "usedDevices", labelEs: "Canjear saldo a favor", approvable: false },
  { key: "usedDevices.voidCredit", module: "usedDevices", labelEs: "Anular un vale de saldo", approvable: false },

  /* ---- repairs (ADR-0014) ----
     The two withheld from a technician are withheld for the reason ADR-0012
     gave itself: receiving stock is how a part gets quietly written off, and
     closing a ticket as unrepairable moves money. */
  { key: "repair.view", module: "repair", labelEs: "Ver reparaciones", approvable: false },
  { key: "repair.create", module: "repair", labelEs: "Recibir un dispositivo a reparar", approvable: false },
  { key: "repair.edit", module: "repair", labelEs: "Editar una ficha de reparación", approvable: false },
  { key: "repair.quote.set", module: "repair", labelEs: "Preparar el presupuesto", approvable: false },
  { key: "repair.quote.approve", module: "repair", labelEs: "Registrar la aprobación del cliente", approvable: false },
  { key: "repair.parts.manage", module: "repair", labelEs: "Añadir y quitar piezas", approvable: false },
  { key: "repair.parts.receive", module: "repair", labelEs: "Recibir una pieza pedida", approvable: false },
  { key: "repair.assign", module: "repair", labelEs: "Asignar técnico", approvable: false },
  { key: "repair.markReady", module: "repair", labelEs: "Marcar una reparación como lista", approvable: false },
  { key: "repair.collect", module: "repair", labelEs: "Cobrar y entregar una reparación", approvable: false },
  // lowering an agreed charge is the one edit the customer never sees
  { key: "repair.price_override", module: "repair", labelEs: "Rebajar un cargo ya aprobado", approvable: true },
  { key: "repair.markNotRepaired", module: "repair", labelEs: "Cerrar una ficha como no reparada", approvable: true },

  /* ---- workshop ---- */
  { key: "workshop.view", module: "workshop", labelEs: "Ver el taller", approvable: false },

  /* ---- cash (ADR-0015) ----
     Opening, counting and closing the drawer is counter work: a cashier who
     cannot open a till cannot start the day, and a cashier who cannot close one
     leaves the count to somebody who was not there. The two the cashier does not
     hold are the two that need a witness — a real discrepancy, and money leaving
     the drawer in a lump — and both are approvable, so the button is there and an
     owner's PIN completes it. Reading past shifts is owner-only because a Z is
     the shop's own statement of a day. */
  { key: "cash.view", module: "cash", labelEs: "Ver la caja y la vista X", approvable: false },
  { key: "cash.open", module: "cash", labelEs: "Abrir turno", approvable: false },
  { key: "cash.close", module: "cash", labelEs: "Cerrar turno", approvable: false },
  { key: "cash.close_over_tolerance", module: "cash", labelEs: "Cerrar turno con descuadre", approvable: true },
  { key: "cash.movement", module: "cash", labelEs: "Registrar entradas y salidas de efectivo", approvable: false },
  { key: "cash.movement_over_threshold", module: "cash", labelEs: "Registrar un movimiento de efectivo alto", approvable: true },
  { key: "cash.history", module: "cash", labelEs: "Ver turnos anteriores y reimprimir la Z", approvable: false },

  /* ---- reports (ADR-0016) ----
     Two keys, because seeing the shop and seeing what it costs are different
     things to be allowed to know. Neither is approvable: a report is not an
     action somebody stands over your shoulder to authorise, it is access, and
     access is granted per person in Usuarios. */
  { key: "reports.view", module: "reports", labelEs: "Ver informes", approvable: false },
  { key: "reports.costs", module: "reports", labelEs: "Ver costes y márgenes en informes", approvable: false },

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

export const ROLES = ["owner", "cashier", "technician"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS_ES: Record<Role, string> = {
  owner: "Responsable",
  cashier: "Cajero",
  technician: "Técnico",
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
  "supplier.manage",
  /* the client asked for the whole buy-and-shelve flow at the counter, so
     sending to inventory is a cashier default and not an approval */
  "transfers.view",
  "transfers.create",
  "transfers.verify",
  "usedDevices.create",
  "usedDevices.sendToInventory",
  "usedDevices.editRefurbCost",
  "usedDevices.redeemCredit",
  /* repairs: counter work and workshop work, but not receiving stock and not
     closing a ticket as unrepairable — both of those move money or stock in a
     way that should have an owner behind it */
  "repair.view",
  "repair.create",
  "repair.edit",
  "repair.quote.set",
  "repair.quote.approve",
  "repair.parts.manage",
  "repair.parts.receive",
  "repair.assign",
  "repair.markReady",
  "repair.collect",
  "workshop.view",
  /* the drawer: open it, count it, close it, and move money in and out of it up
     to the threshold. What is missing is a real discrepancy and a big movement */
  "cash.view",
  "cash.open",
  "cash.close",
  "cash.movement",
];

/**
 * The workshop, not the counter.
 *
 * A technician works on devices: they quote, fit parts, mark things ready and
 * hand them back. They do not sell — `sale.create` is absent, which is the whole
 * difference from a cashier — and two repair permissions are withheld for the
 * reason ADR-0012 gave itself: **receiving stock is how a part gets quietly
 * written off**, and **closing a ticket as unrepairable moves money**. Both are
 * grantable per person; neither is a default.
 *
 * `repair.price_override` is absent from every role but owner because it is
 * approvable: the technician presses the button and an owner's PIN completes it.
 */
export const TECHNICIAN_DEFAULTS: readonly PermissionKey[] = [
  "catalog.view",
  "inventory.view",
  "supplier.manage",
  "repair.view",
  "repair.create",
  "repair.edit",
  "repair.quote.set",
  "repair.quote.approve",
  "repair.parts.manage",
  "repair.assign",
  "repair.markReady",
  "repair.collect",
  "workshop.view",
];

const ROLE_DEFAULTS: Record<Role, readonly PermissionKey[] | "all"> = {
  owner: "all",
  cashier: CASHIER_DEFAULTS,
  technician: TECHNICIAN_DEFAULTS,
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
