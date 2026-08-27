/**
 * Install argon2id, if this build has it.
 *
 * Core ships with scrypt and takes an argon2 implementation from the host
 * rather than importing one, so `packages/core` keeps no native dependency and
 * the web app and test runner import it without one (ADR-0012 §2).
 *
 * A failure here is not fatal by design: hashes are self-describing, so a till
 * that falls back to scrypt keeps verifying argon2 hashes written earlier and
 * writes scrypt ones from then on. The lockout ladder is the real control.
 */
import { setArgon2 } from "@arkom/core/pin-hash";

export function installKdf(): void {
  try {
    // required lazily so a packaging problem degrades instead of failing to boot
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const argon2 = require("@node-rs/argon2") as {
      hashSync: (pin: string, opts: { algorithm: number }) => string;
      verifySync: (hash: string, pin: string) => boolean;
      Algorithm: { Argon2id: number };
    };
    setArgon2({
      hash: (pin) => argon2.hashSync(pin, { algorithm: argon2.Algorithm.Argon2id }),
      verify: (hash, pin) => argon2.verifySync(hash, pin),
    });
    console.log("[auth] argon2id available");
  } catch (err) {
    console.warn("[auth] argon2id unavailable, using scrypt:", (err as Error).message);
  }
}
