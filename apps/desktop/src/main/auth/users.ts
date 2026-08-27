/**
 * The users repository — credentials, lockout and the guards around them.
 *
 * Everything that touches a PIN hash lives behind this file. Nothing here
 * returns a hash, and no function takes a PIN that it does not immediately
 * compare and discard (ADR-0012 §2).
 */
import { and, eq } from "drizzle-orm";
import {
  appError,
  attemptsRemaining,
  can,
  effectiveOverrides,
  isLockedOut,
  isPinAcceptable,
  isRole,
  lockoutRemainingMs,
  mutate,
  registerFailure,
  registerSuccess,
  resolvePermissions,
  toOplogJson,
  uuidv7,
  type LogFn,
  type MutationCtx,
  type PermissionKey,
  type UserRow,
} from "@arkom/core";
import {
  generateRecoveryCode,
  hashPin,
  hashRecoveryCode,
  verifyPin,
  verifyRecoveryCode,
} from "@arkom/core/pin-hash";
import { schema as s, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

type UserRecord = typeof s.users.$inferSelect;

/** Never let a hash out of this module. */
export function toUserRow(u: UserRecord): UserRow {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    active: u.active,
    overrides: (u.permissionOverrides as Record<string, boolean> | null) ?? {},
    lastLoginAtMs: u.lastLoginAt?.getTime() ?? null,
    lockedUntilMs: u.lockedUntil?.getTime() ?? null,
  };
}

export function findUser(db: ArkomDb, ctx: MutationCtx, id: string): UserRecord | undefined {
  return db
    .select()
    .from(s.users)
    .where(and(eq(s.users.tenantId, ctx.tenantId), eq(s.users.id, id)))
    .all()[0];
}

export function listUsers(db: ArkomDb, ctx: MutationCtx, activeOnly = false): UserRecord[] {
  const rows = db.select().from(s.users).where(eq(s.users.tenantId, ctx.tenantId)).all();
  const filtered = activeOnly ? rows.filter((u) => u.active) : rows;
  // owners first, then alphabetical — the Login screen reads top-left first
  return filtered.sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name, "es") : a.role === "owner" ? -1 : 1,
  );
}

export function hasAnyUser(db: ArkomDb, ctx: MutationCtx): boolean {
  return db.select({ id: s.users.id }).from(s.users).where(eq(s.users.tenantId, ctx.tenantId)).limit(1).all().length > 0;
}

export function countActiveOwners(db: ArkomDb, ctx: MutationCtx, excludingId?: string): number {
  return listUsers(db, ctx, true).filter((u) => u.role === "owner" && u.id !== excludingId).length;
}

/* ------------------------------------------------------- PIN verification */

export interface PinCheck {
  user: UserRecord;
  permissions: PermissionKey[];
}

/**
 * The single place a PIN is checked, for login, unlock and approval alike.
 *
 * The same lockout ladder governs all three on purpose (ADR-0012 §3): if
 * approval were unrated, the Approval keypad would be an oracle for guessing
 * the owner's PIN at leisure.
 *
 * `reason` only reaches the audit trail — never the error message.
 */
export function verifyUserPin(
  db: ArkomDb,
  ctx: MutationCtx,
  userId: string,
  pin: string,
  reason: "login" | "unlock" | "approval" | "recover" | "pin_change",
): PinCheck {
  const user = findUser(db, ctx, userId);
  if (!user || !user.active) {
    // deliberately the same error an inactive user gets: the login screen only
    // lists active users, so anything else is a caller that should not be here
    throw appError("INVALID_PIN", "PIN incorrecto.");
  }

  const now = Date.now();
  const state = { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil?.getTime() ?? null };

  if (isLockedOut(state, now)) {
    throw appError(
      "USER_LOCKED",
      String(Math.ceil(lockoutRemainingMs(state, now) / 1000)), // seconds, for the countdown
    );
  }

  if (!verifyPin(user.pinHash, pin)) {
    const next = registerFailure(state, now);
    persistLockout(db, ctx, user, next, reason, false);
    if (next.lockedUntil !== null && next.lockedUntil > now) {
      throw appError("USER_LOCKED", String(Math.ceil((next.lockedUntil - now) / 1000)));
    }
    throw appError("INVALID_PIN", String(attemptsRemaining(next)));
  }

  if (state.failedAttempts !== 0 || state.lockedUntil !== null) {
    persistLockout(db, ctx, user, registerSuccess(), reason, true);
  }

  return {
    user,
    permissions: resolvePermissions({ role: user.role, overrides: toUserRow(user).overrides }),
  };
}

/** Lockout counters are persisted so killing the app does not reset them. */
function persistLockout(
  db: ArkomDb,
  ctx: MutationCtx,
  user: UserRecord,
  next: { failedAttempts: number; lockedUntil: number | null },
  reason: string,
  success: boolean,
): void {
  mutate(makeMutateRunner(db), { ...ctx, userId: user.id }, (tx, log) => {
    tx.update(s.users)
      .set({
        failedAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil === null ? null : new Date(next.lockedUntil),
        updatedAt: new Date(),
      })
      .where(eq(s.users.id, user.id))
      .run();
    // NB: no PIN, not even a length, ever reaches this payload
    log({
      entity: "user",
      entityId: user.id,
      action: success ? "auth_success" : "auth_failure",
      before: null,
      after: {
        reason,
        failedAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil,
        lockedOut: next.lockedUntil !== null && next.lockedUntil > Date.now(),
      },
    });
  });
}

/** Record an auth event that changes no row (login, logout, lock, unlock…). */
export function logAuthEvent(
  db: ArkomDb,
  ctx: MutationCtx,
  userId: string,
  action: string,
  after: Record<string, unknown> = {},
): void {
  mutate(makeMutateRunner(db), { ...ctx, userId }, (_tx, log) => {
    log({ entity: "user", entityId: userId, action, before: null, after });
  });
}

export function markLogin(db: ArkomDb, ctx: MutationCtx, user: UserRecord): void {
  mutate(makeMutateRunner(db), { ...ctx, userId: user.id }, (tx, log) => {
    const at = new Date();
    tx.update(s.users).set({ lastLoginAt: at, updatedAt: at }).where(eq(s.users.id, user.id)).run();
    log({ entity: "user", entityId: user.id, action: "login", before: null, after: { name: user.name, role: user.role } });
  });
}

/* --------------------------------------------------------------- writes */

function assertPinAcceptable(pin: string): void {
  if (!isPinAcceptable(pin)) {
    throw appError(
      "WEAK_PIN",
      "Ese PIN es demasiado fácil de adivinar. Evita 1234, 1111 y fechas.",
      "pin",
    );
  }
}

export interface CreateUserInput {
  name: string;
  role: string;
  pin: string;
  overrides?: Record<string, boolean>;
}

/**
 * Create a user. Owners get a recovery code, returned ONCE and never again —
 * only its hash is stored (ADR-0012 §8).
 */
export function createUser(
  db: ArkomDb,
  ctx: MutationCtx,
  input: CreateUserInput,
): { user: UserRow; recoveryCode: string | null } {
  if (!isRole(input.role)) throw appError("VALIDATION", "Rol no válido.", "role");
  assertPinAcceptable(input.pin);

  const clash = listUsers(db, ctx).find((u) => u.name.toLowerCase() === input.name.trim().toLowerCase());
  if (clash) throw appError("DUPLICATE_NAME", "Ya hay un usuario con ese nombre.", "name");

  const recoveryCode = input.role === "owner" ? generateRecoveryCode() : null;

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      name: input.name.trim(),
      role: input.role,
      pinHash: hashPin(input.pin),
      permissionOverrides: input.overrides ?? {},
      active: true,
      failedAttempts: 0,
      lockedUntil: null,
      recoveryCodeHash: recoveryCode ? hashRecoveryCode(recoveryCode) : null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(s.users).values(row).run();
    // the audit entry carries everything EXCEPT the two secrets
    const { pinHash: _p, recoveryCodeHash: _r, ...safe } = row;
    log({ entity: "user", entityId: row.id, action: "create", before: null, after: toOplogJson(safe) });
    return { user: toUserRow(row as UserRecord), recoveryCode };
  });
}

export interface UpdateUserInput {
  id: string;
  name?: string;
  role?: string;
  overrides?: Record<string, boolean>;
  active?: boolean;
}

/**
 * Edit a user. The last active owner cannot be demoted or deactivated — refused
 * in here rather than merely disabled in the UI, because "the button was greyed
 * out" is not a guarantee (spec G6).
 */
export function updateUser(db: ArkomDb, ctx: MutationCtx, input: UpdateUserInput): UserRow {
  const user = findUser(db, ctx, input.id);
  if (!user) throw appError("VALIDATION", "Usuario no encontrado.");
  if (input.role !== undefined && !isRole(input.role)) {
    throw appError("VALIDATION", "Rol no válido.", "role");
  }

  const losingOwner =
    user.role === "owner" &&
    ((input.role !== undefined && input.role !== "owner") || input.active === false);
  if (losingOwner && countActiveOwners(db, ctx, user.id) === 0) {
    throw appError(
      "LAST_OWNER",
      "Debe quedar al menos un responsable activo. Crea otro antes de cambiar este.",
    );
  }

  if (input.name !== undefined) {
    const clash = listUsers(db, ctx).find(
      (u) => u.id !== user.id && u.name.toLowerCase() === input.name!.trim().toLowerCase(),
    );
    if (clash) throw appError("DUPLICATE_NAME", "Ya hay un usuario con ese nombre.", "name");
  }

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const patch = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.overrides !== undefined ? { permissionOverrides: input.overrides } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      updatedAt: new Date(),
    };
    tx.update(s.users).set(patch).where(eq(s.users.id, user.id)).run();
    const after = tx.select().from(s.users).where(eq(s.users.id, user.id)).all()[0]!;
    log({
      entity: "user",
      entityId: user.id,
      action: "update",
      before: toOplogJson(stripSecrets(user)),
      after: toOplogJson(stripSecrets(after)),
    });
    return toUserRow(after);
  });
}

function stripSecrets(u: UserRecord): Record<string, unknown> {
  const { pinHash: _p, recoveryCodeHash: _r, ...safe } = u;
  return safe;
}

/**
 * Reset a PIN. Changing your OWN requires the current one — an unattended
 * unlocked till must not let a passer-by take the owner's account (spec G5).
 */
export function resetPin(
  db: ArkomDb,
  ctx: MutationCtx,
  actorUserId: string,
  input: { id: string; newPin: string; currentPin?: string },
): void {
  const user = findUser(db, ctx, input.id);
  if (!user) throw appError("VALIDATION", "Usuario no encontrado.");
  assertPinAcceptable(input.newPin);

  if (actorUserId === input.id) {
    if (!input.currentPin) {
      throw appError("VALIDATION", "Introduce tu PIN actual.", "currentPin");
    }
    verifyUserPin(db, ctx, input.id, input.currentPin, "pin_change");
  }

  mutate(makeMutateRunner(db), { ...ctx, userId: actorUserId }, (tx, log) => {
    const now = new Date();
    tx.update(s.users)
      .set({ pinHash: hashPin(input.newPin), failedAttempts: 0, lockedUntil: null, updatedAt: now })
      .where(eq(s.users.id, user.id))
      .run();
    log({
      entity: "user",
      entityId: user.id,
      action: "pin_reset",
      before: null,
      after: { byUserId: actorUserId, self: actorUserId === user.id },
    });
  });
}

/* ------------------------------------------------------------- recovery */

/**
 * Owner recovery. Rate-limited by the same ladder as everything else, so the
 * code cannot be guessed at leisure. Succeeding issues a NEW code — the old one
 * is dead the moment this returns.
 */
export function recoverWithCode(
  db: ArkomDb,
  ctx: MutationCtx,
  userId: string,
  code: string,
  newPin: string,
): string {
  const user = findUser(db, ctx, userId);
  if (!user || !user.active || user.role !== "owner" || !user.recoveryCodeHash) {
    throw appError("INVALID_PIN", "Código de recuperación incorrecto.");
  }
  assertPinAcceptable(newPin);

  const now = Date.now();
  const state = { failedAttempts: user.failedAttempts, lockedUntil: user.lockedUntil?.getTime() ?? null };
  if (isLockedOut(state, now)) {
    throw appError("USER_LOCKED", String(Math.ceil(lockoutRemainingMs(state, now) / 1000)));
  }

  if (!verifyRecoveryCode(user.recoveryCodeHash, code)) {
    persistLockout(db, ctx, user, registerFailure(state, now), "recover", false);
    throw appError("INVALID_PIN", "Código de recuperación incorrecto.");
  }

  const nextCode = generateRecoveryCode();
  mutate(makeMutateRunner(db), { ...ctx, userId: user.id }, (tx, log) => {
    const at = new Date();
    tx.update(s.users)
      .set({
        pinHash: hashPin(newPin),
        recoveryCodeHash: hashRecoveryCode(nextCode),
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: at,
      })
      .where(eq(s.users.id, user.id))
      .run();
    log({ entity: "user", entityId: user.id, action: "recovered", before: null, after: { name: user.name } });
  });
  return nextCode;
}

/** Does this user hold the permission? Used by the approval path. */
export function userCan(user: UserRecord, key: PermissionKey): boolean {
  return can({ role: user.role, overrides: toUserRow(user).overrides }, key);
}

export { effectiveOverrides };
