/**
 * PIN policy, hashing and lockout — the whole credential story, in one file.
 *
 * ADR-0012. Three things worth knowing before editing:
 *
 * 1. **The PIN is a string that must not linger.** It arrives, it is compared,
 *    it is dropped. Nothing here returns it, logs it, or puts it in an error.
 *    The error for a wrong PIN says "wrong PIN" and nothing else.
 *
 * 2. **Hashing lives next door, in `pin-hash.ts`.** This file is imported by
 *    the renderer and the sandboxed preload, which have no Node — so anything
 *    reaching for `node:crypto` must stay out of it. Weak-PIN hints and the
 *    lockout countdown are UI concerns; hashing never is.
 *
 * 3. **Hashes are self-describing.** Every stored hash carries its own scheme,
 *    so swapping the KDF is not a migration: old hashes keep verifying under
 *    the scheme they were written with, new ones use the current default. The
 *    argon2id → scrypt fallback costs nothing at the database level.
 *
 * 4. **The KDF is not the real control.** A six-digit PIN has a million values;
 *    anyone holding the database file can exhaust that whatever guards it. The
 *    control is the lockout ladder below plus the shop's front door. The KDF
 *    exists so a stolen backup does not hand over PINs instantly.
 */
/* ------------------------------------------------------------------ policy */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/**
 * PINs that are technically valid and practically worthless. Kept short on
 * purpose: a long blocklist trains staff to pick the first thing that passes,
 * which is not the same as picking something good.
 */
const PIN_BLOCKLIST = new Set([
  "1234", "4321", "0000", "1111", "1212", "2121", "6969", "1004", "2000",
  "2580", // straight down the middle of a keypad
  "1379", "3971", // the four corners
  "123456", "654321", "112233", "121212", "123123", "000000", "111111",
]);

export type PinProblem = "length" | "digits" | "repeated" | "sequence" | "common";

/** null when the PIN is acceptable; otherwise why it is not. */
export function checkPin(pin: string): PinProblem | null {
  if (!/^\d+$/.test(pin)) return "digits";
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) return "length";
  if (PIN_BLOCKLIST.has(pin)) return "common";
  // 1111 — one digit is not a secret
  if (new Set(pin).size === 1) return "repeated";
  if (hasRun(pin)) return "sequence";
  return null;
}

export function isPinAcceptable(pin: string): boolean {
  return checkPin(pin) === null;
}

/**
 * A run of 3+ consecutive digits in either direction, anywhere in the PIN.
 * "3456" and "8764" both fail; "1357" and "9042" both pass. Three rather than
 * the whole length because "1235" is barely better than "1234".
 */
function hasRun(pin: string): boolean {
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < pin.length; i++) {
    const delta = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    ascending = delta === 1 ? ascending + 1 : 1;
    descending = delta === -1 ? descending + 1 : 1;
    if (ascending >= 3 || descending >= 3) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ lockout */

/**
 * 5 failures → 1 minute · next 5 → 5 minutes · thereafter 15.
 *
 * It locks the PERSON, not the till: a cashier fumbling their PIN must never
 * stop the owner from selling. The same ladder governs login, unlock and
 * approval, because otherwise the approval keypad is an unrated oracle for
 * guessing the owner's PIN.
 */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_LADDER_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

export interface LockoutState {
  failedAttempts: number;
  lockedUntil: number | null;
}

/** Is this user locked right now? */
export function isLockedOut(state: LockoutState, nowMs: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > nowMs;
}

export function lockoutRemainingMs(state: LockoutState, nowMs: number): number {
  if (!isLockedOut(state, nowMs)) return 0;
  return state.lockedUntil! - nowMs;
}

/** Attempts left before the next lock, for the "te quedan N intentos" message. */
export function attemptsRemaining(state: LockoutState): number {
  return Math.max(0, LOCKOUT_THRESHOLD - (state.failedAttempts % LOCKOUT_THRESHOLD));
}

/** A wrong PIN. Returns the row's next state — the caller persists it. */
export function registerFailure(state: LockoutState, nowMs: number): LockoutState {
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts % LOCKOUT_THRESHOLD !== 0) {
    return { failedAttempts, lockedUntil: state.lockedUntil };
  }
  // every fifth failure trips the next rung, holding at the top one
  const rung = Math.min(
    Math.floor(failedAttempts / LOCKOUT_THRESHOLD) - 1,
    LOCKOUT_LADDER_MS.length - 1,
  );
  return { failedAttempts, lockedUntil: nowMs + LOCKOUT_LADDER_MS[rung]! };
}

/** A correct PIN wipes the slate. */
export function registerSuccess(): LockoutState {
  return { failedAttempts: 0, lockedUntil: null };
}

/* ------------------------------------------------------ recovery formatting */

/**
 * Strip grouping and case so a code typed with or without dashes compares the
 * same. Lives here rather than in pin-hash because the Login field wants it too
 * — and the renderer cannot import anything that touches node:crypto.
 */
export function normalizeRecoveryCodeInput(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
