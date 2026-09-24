/**
 * The two secrets the cloud handles: a device token and an enrolment code.
 *
 * Both follow one rule — **the database stores a digest, never the secret**. A
 * token is shown once, to the till that will use it; a code is shown once, to
 * the person who will type it. Neither can be read back out of Postgres, which
 * means a dump of this database does not let anyone push into a shop's stream.
 *
 * Lookups are by digest, so there is nothing to compare in variable time: the
 * caller's guess is hashed and used as an index key. Constant-time comparison
 * would be guarding a door that has no handle.
 */
import { createHash, randomBytes } from "node:crypto";

/** SHA-256, hex. Fast on purpose: these are 128+ bit random secrets, not passwords. */
export function digest(secret: string): string {
  return createHash("sha256").update(secret.trim(), "utf8").digest("hex");
}

/**
 * A device token: 256 bits, URL-safe, prefixed so it is recognisable in a log
 * that should never contain one.
 */
export function newDeviceToken(): string {
  return `cdrn_${randomBytes(32).toString("base64url")}`;
}

/**
 * Unambiguous alphabet: no O/0 and no I/1, because this is read off one screen
 * and typed on another, often by somebody on the phone to their installer.
 * Exactly 32 symbols, so each character consumes five bits with no bias.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** XXXX-XXXX-XXXX — 60 bits of entropy, which is not brute-forceable over HTTP. */
export function newEnrolCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i += 1) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += CODE_ALPHABET[bytes[i]! & 31];
  }
  return out;
}

/**
 * How long a code is worth pasting. Long enough that an owner can generate one
 * today and let the installer use it on Thursday; short enough that a code left
 * in an email is not a standing invitation.
 */
export const ENROL_CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `Authorization: Bearer <token>` → the token, or null if the header is not that. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}
