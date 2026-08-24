/**
 * `pnpm imei:gen [n]` — print n valid test IMEIs (default 10).
 *
 * A real IMEI's last digit is a Luhn checksum of the first 14, which is why
 * invented numbers get rejected. This uses core's own check-digit function, so
 * what it prints is exactly what the app accepts. Dev fixture only — nothing
 * here writes to the database.
 */
import { imeiWithCheckDigit, isValidImei } from "@arkom/core";

const count = Math.min(Math.max(Number.parseInt(process.argv[2] ?? "10", 10) || 10, 1), 200);

/** 14-digit base: a fixed reporting-body prefix + random body, like a real TAC+serial. */
function randomBase14(): string {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += (byte % 10).toString();
  return `3534740${body}`;
}

const imeis = new Set<string>();
while (imeis.size < count) {
  const imei = imeiWithCheckDigit(randomBase14());
  if (isValidImei(imei)) imeis.add(imei); // belt and braces: never print one the app would reject
}

for (const imei of imeis) console.log(imei);
