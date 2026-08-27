/**
 * PIN hashing and recovery codes — the parts that need `node:crypto`.
 *
 * Split out of `pin.ts` because core's main entry is bundled into the RENDERER
 * and the sandboxed PRELOAD, neither of which has Node. Importing this module
 * from either would break the preload at load time, which takes the whole
 * bridge with it — found the honest way, by running the app.
 *
 * Main imports it as `@arkom/core/pin-hash`. Nothing else should.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { normalizeRecoveryCodeInput } from "./pin";

export type PinScheme = "argon2id" | "scrypt";

/** Set by the host once at startup when argon2 is available (see setArgon2). */
interface Argon2Impl {
  hash(pin: string): string;
  verify(hash: string, pin: string): boolean;
}
let argon2: Argon2Impl | null = null;

/**
 * Hand core an argon2id implementation. Done by the host rather than imported
 * here so that `packages/core` keeps no native dependency of its own — the web
 * app and the test runner import this module happily without one.
 */
export function setArgon2(impl: Argon2Impl | null): void {
  argon2 = impl;
}

export function activeScheme(): PinScheme {
  return argon2 ? "argon2id" : "scrypt";
}

const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384; // 2^14 — ~50ms, comfortably under a keypress cadence

/** `scrypt$<salt-hex>$<hash-hex>` or argon2's own `$argon2id$...` string. */
export function hashPin(pin: string): string {
  if (argon2) return argon2.hash(pin);
  const salt = randomBytes(16);
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify against whichever scheme the stored hash names. Never throws on a
 * malformed hash — a corrupt row must read as "wrong PIN", not crash the login
 * screen and lock the shop out of its own till.
 */
export function verifyPin(storedHash: string, pin: string): boolean {
  try {
    if (storedHash.startsWith("$argon2")) {
      return argon2 ? argon2.verify(storedHash, pin) : false;
    }
    const [scheme, saltHex, hashHex] = storedHash.split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pin, Buffer.from(saltHex, "hex"), expected.length, { N: SCRYPT_COST });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- recovery codes */

/**
 * Crockford-ish alphabet: no 0/O, no 1/I/L. The owner reads this off a thermal
 * receipt, possibly in a hurry, possibly a year later.
 */
const RECOVERY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const RECOVERY_LENGTH = 12;

/** `K7M4-P2XR-9TQD` — grouped for reading, ungrouped for comparing. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_LENGTH; i++) {
    out += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
  }
  return out.replace(/(.{4})(?=.)/g, "$1-");
}

export { normalizeRecoveryCodeInput as normalizeRecoveryCode };

/**
 * Recovery codes are hashed with plain SHA-256, not the PIN KDF, and that is
 * deliberate: a 12-character code from a 30-symbol alphabet has ~59 bits of
 * entropy, so it needs no stretching, and login must not stall for 50ms per
 * guess on a code nobody brute-forces anyway.
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCodeInput(code)).digest("hex");
}

export function verifyRecoveryCode(storedHash: string, code: string): boolean {
  const candidate = Buffer.from(hashRecoveryCode(code), "hex");
  const expected = Buffer.from(storedHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

