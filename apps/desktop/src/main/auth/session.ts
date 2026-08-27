/**
 * The session — one per running app, held here and nowhere else.
 *
 * ADR-0012 §4. The renderer never holds a credential, a hash, or a role it can
 * edit; it receives `SessionInfo` and is told when that changes. A renderer that
 * lies to itself about what to draw gains nothing, because every handler asks
 * this module, not the caller.
 *
 * Memory-only, deliberately: **an app restart always lands on Login.** Nothing
 * here is written to disk, so there is no session file to steal or forge.
 */
import { BrowserWindow } from "electron";
import { resolvePermissions, type PermissionKey, type SessionInfo } from "@arkom/core";

export interface Session {
  userId: string;
  name: string;
  role: string;
  permissions: PermissionKey[];
  /** the lock overlay is up; the session and any cart survive it */
  locked: boolean;
  lastActivityMs: number;
}

let current: Session | null = null;

/** Milliseconds of quiet before the lock overlay drops. 0 disables it. */
let idleLimitMs = 5 * 60_000;
let idleTimer: ReturnType<typeof setInterval> | null = null;

export function getSession(): Session | null {
  return current;
}

export function toSessionInfo(session: Session | null): SessionInfo | null {
  if (!session) return null;
  return {
    userId: session.userId,
    name: session.name,
    role: session.role,
    permissions: session.permissions,
    locked: session.locked,
  };
}

/** Push the session to every window, so the UI never has to poll. */
function broadcast(): void {
  const payload = toSessionInfo(current);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("auth:changed", payload);
  }
}

export function startSession(user: { id: string; name: string; role: string; overrides: Record<string, boolean> }): SessionInfo {
  current = {
    userId: user.id,
    name: user.name,
    role: user.role,
    permissions: resolvePermissions({ role: user.role, overrides: user.overrides }),
    locked: false,
    lastActivityMs: Date.now(),
  };
  broadcast();
  return toSessionInfo(current)!;
}

export function endSession(): void {
  current = null;
  broadcast();
}

export function lockSession(): void {
  if (!current) return;
  current.locked = true;
  broadcast();
}

export function unlockSession(): SessionInfo | null {
  if (!current) return null;
  current.locked = false;
  current.lastActivityMs = Date.now();
  broadcast();
  return toSessionInfo(current);
}

/**
 * Called by the renderer's throttled activity ping. Ignored while locked — a
 * mouse moving over the lock overlay must not keep the session awake, or the
 * overlay would never have dropped in the first place.
 */
export function noteActivity(): void {
  if (current && !current.locked) current.lastActivityMs = Date.now();
}

export function setIdleLimitMinutes(minutes: number): void {
  idleLimitMs = Math.max(0, minutes) * 60_000;
}

/**
 * One timer for the whole app, ticking every 15 seconds rather than scheduling
 * per keystroke: the resolution that matters is "did five minutes pass", and a
 * quarter-minute of slack is invisible to a shop.
 */
export function startIdleWatcher(): void {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (!current || current.locked || idleLimitMs === 0) return;
    if (Date.now() - current.lastActivityMs >= idleLimitMs) lockSession();
  }, 15_000);
}

export function stopIdleWatcher(): void {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
}

/**
 * Pure form of the idle rule, so the timing is testable without a clock.
 * Exported for the tests rather than used internally — the interval above is
 * the production path and this is the specification it follows.
 */
export function shouldLock(
  session: Pick<Session, "locked" | "lastActivityMs"> | null,
  idleMinutes: number,
  nowMs: number,
): boolean {
  if (!session || session.locked) return false;
  if (idleMinutes <= 0) return false; // "Nunca" — a back-office till may want this
  return nowMs - session.lastActivityMs >= idleMinutes * 60_000;
}
