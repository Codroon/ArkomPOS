import { afterEach, describe, expect, it } from "vitest";
import {
  activeScheme,
  attemptsRemaining,
  checkPin,
  generateRecoveryCode,
  hashPin,
  hashRecoveryCode,
  isLockedOut,
  isPinAcceptable,
  LOCKOUT_LADDER_MS,
  LOCKOUT_THRESHOLD,
  lockoutRemainingMs,
  normalizeRecoveryCode,
  registerFailure,
  registerSuccess,
  setArgon2,
  verifyPin,
  verifyRecoveryCode,
  type LockoutState,
} from "../pin";

afterEach(() => setArgon2(null));

describe("PIN policy", () => {
  it("accepts ordinary 4-6 digit PINs", () => {
    for (const pin of ["1357", "9042", "8317", "402913", "70581"]) {
      expect(checkPin(pin), pin).toBeNull();
    }
  });

  it("rejects non-digits", () => {
    for (const pin of ["12a4", "  12", "1 2 3", "", "abcd"]) {
      expect(checkPin(pin), pin).toBe(pin === "" ? "digits" : "digits");
    }
  });

  it("rejects the wrong length", () => {
    expect(checkPin("135")).toBe("length");
    expect(checkPin("1357902")).toBe("length");
  });

  it("rejects one digit repeated", () => {
    for (const pin of ["1111", "7777", "999999"]) {
      expect(checkPin(pin), pin).toMatch(/repeated|common/);
    }
  });

  it("rejects runs in either direction, anywhere in the PIN", () => {
    for (const pin of ["1234", "4321", "987654", "9123", "8764", "70123"]) {
      expect(checkPin(pin), pin).toMatch(/sequence|common/);
    }
  });

  it("allows a run of only two", () => {
    // "12" is a pair, not a run — rejecting it would leave too little to choose from
    expect(isPinAcceptable("1297")).toBe(true);
  });

  it("rejects the blocklist", () => {
    expect(checkPin("2580")).toBe("common"); // straight down the keypad
    expect(checkPin("1379")).toBe("common"); // the four corners
    expect(checkPin("112233")).toBe("common");
  });
});

/* The suite runs twice: once on scrypt, once on argon2id if it is installed.
   Both are supported schemes and both must round-trip. */
const SCHEMES: [string, () => void][] = [["scrypt", () => setArgon2(null)]];
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const a = require("@node-rs/argon2");
  SCHEMES.push([
    "argon2id",
    () =>
      setArgon2({
        hash: (pin) => a.hashSync(pin, { algorithm: a.Algorithm.Argon2id }),
        verify: (hash, pin) => a.verifySync(hash, pin),
      }),
  ]);
} catch {
  // argon2 not installed in this environment — scrypt path still fully covered
}

describe.each(SCHEMES)("hashing (%s)", (name, install) => {
  it("round-trips", () => {
    install();
    expect(activeScheme()).toBe(name === "argon2id" ? "argon2id" : "scrypt");
    const hash = hashPin("8317");
    expect(verifyPin(hash, "8317")).toBe(true);
    expect(verifyPin(hash, "8318")).toBe(false);
  });

  it("never stores the PIN in the hash", () => {
    install();
    expect(hashPin("8317")).not.toContain("8317");
  });

  it("salts: the same PIN hashed twice gives different strings", () => {
    install();
    expect(hashPin("8317")).not.toBe(hashPin("8317"));
  });
});

describe("hash scheme dispatch", () => {
  it("reads a scrypt hash back even after argon2 becomes the default", () => {
    setArgon2(null);
    const legacy = hashPin("8317");
    expect(legacy.startsWith("scrypt$")).toBe(true);

    // the shop upgrades and argon2 becomes available — old rows must still work
    setArgon2({ hash: () => "$argon2id$stub", verify: () => true });
    expect(verifyPin(legacy, "8317")).toBe(true);
    expect(verifyPin(legacy, "9999")).toBe(false);
  });

  it("treats a corrupt hash as a wrong PIN rather than throwing", () => {
    setArgon2(null);
    for (const junk of ["", "garbage", "scrypt$onlyonefield", "$argon2id$truncated"]) {
      expect(() => verifyPin(junk, "8317")).not.toThrow();
      expect(verifyPin(junk, "8317")).toBe(false);
    }
  });
});

describe("recovery codes", () => {
  it("is 12 characters, grouped in fours", () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(12);
  });

  it("avoids characters that misread on a receipt", () => {
    for (let i = 0; i < 40; i++) {
      expect(generateRecoveryCode()).not.toMatch(/[01OIL]/);
    }
  });

  it("verifies regardless of grouping or case", () => {
    const code = generateRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(verifyRecoveryCode(hash, code)).toBe(true);
    expect(verifyRecoveryCode(hash, code.replace(/-/g, "").toLowerCase())).toBe(true);
    expect(verifyRecoveryCode(hash, generateRecoveryCode())).toBe(false);
  });
});

describe("lockout ladder", () => {
  const fresh: LockoutState = { failedAttempts: 0, lockedUntil: null };
  const NOW = 1_800_000_000_000;

  const failTimes = (n: number, from: LockoutState = fresh, now = NOW): LockoutState => {
    let state = from;
    for (let i = 0; i < n; i++) state = registerFailure(state, now);
    return state;
  };

  it("does not lock before the threshold", () => {
    const state = failTimes(LOCKOUT_THRESHOLD - 1);
    expect(isLockedOut(state, NOW)).toBe(false);
    expect(attemptsRemaining(state)).toBe(1);
  });

  it("locks for a minute at 5", () => {
    const state = failTimes(5);
    expect(isLockedOut(state, NOW)).toBe(true);
    expect(lockoutRemainingMs(state, NOW)).toBe(LOCKOUT_LADDER_MS[0]);
  });

  it("locks for five minutes at 10, fifteen at 15", () => {
    expect(lockoutRemainingMs(failTimes(10), NOW)).toBe(LOCKOUT_LADDER_MS[1]);
    expect(lockoutRemainingMs(failTimes(15), NOW)).toBe(LOCKOUT_LADDER_MS[2]);
  });

  it("holds at the top rung rather than growing forever", () => {
    expect(lockoutRemainingMs(failTimes(20), NOW)).toBe(LOCKOUT_LADDER_MS[2]);
    expect(lockoutRemainingMs(failTimes(50), NOW)).toBe(LOCKOUT_LADDER_MS[2]);
  });

  it("unlocks itself once the clock passes", () => {
    const state = failTimes(5);
    expect(isLockedOut(state, NOW + LOCKOUT_LADDER_MS[0] - 1)).toBe(true);
    expect(isLockedOut(state, NOW + LOCKOUT_LADDER_MS[0])).toBe(false);
  });

  it("a correct PIN wipes the slate", () => {
    const state = registerSuccess();
    expect(state).toEqual({ failedAttempts: 0, lockedUntil: null });
    expect(isLockedOut(state, NOW)).toBe(false);
  });

  it("counts attempts remaining within the current rung", () => {
    expect(attemptsRemaining(fresh)).toBe(5);
    expect(attemptsRemaining(failTimes(3))).toBe(2);
    expect(attemptsRemaining(failTimes(5))).toBe(5); // locked; the next rung starts over
    expect(attemptsRemaining(failTimes(7))).toBe(3);
  });
});
