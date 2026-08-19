/**
 * UUIDv7 (ADR-0006): time-ordered, collision-safe across offline tills.
 * Uses Web Crypto (available in Electron main, Node >= 20 and browsers) so this
 * module stays runtime-neutral. rand_a carries a per-millisecond monotonic
 * counter so ids generated in the same millisecond still sort by creation order.
 */

let lastMs = -1;
let seq = 0; // 12-bit counter in rand_a

export function uuidv7(): string {
  let ms = Date.now();
  if (ms === lastMs) {
    seq = (seq + 1) & 0xfff;
    // counter exhausted within one millisecond: borrow the next one
    if (seq === 0) ms += 1;
  } else if (ms < lastMs) {
    // clock went backwards; keep ids monotonic by staying on lastMs
    ms = lastMs;
    seq = (seq + 1) & 0xfff;
    if (seq === 0) ms += 1;
  } else {
    seq = 0;
  }
  lastMs = ms;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // 48-bit big-endian unix ms
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  // version 7 + 12-bit monotonic counter
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f);
  bytes[7] = seq & 0xff;
  // RFC 9562 variant (10xx) over random rand_b
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = "";
  for (let i = 0; i < 16; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Millisecond timestamp embedded in a UUIDv7 (diagnostics/tests). */
export function uuidv7Timestamp(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}
