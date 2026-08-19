/**
 * core is runtime-neutral (no DOM lib, no @types/node — see §2), but Web Crypto
 * exists in every runtime we target (Node ≥20, Electron main/renderer, browsers).
 * Declare the one global we use instead of pulling in a whole environment lib.
 */
declare const crypto: {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};
