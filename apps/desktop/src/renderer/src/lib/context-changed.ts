/**
 * "The till's own facts changed" — its name, today (ADR-0024 §1).
 *
 * The shell reads `meta:context` once, at sign-in, and every header and screen
 * title is drawn from that copy. A rename in Ajustes has to reach them without
 * a restart, so Ajustes announces it and the shell reads the context again.
 */
const EVENT = "arkom:context-changed";

export function announceContextChanged(): void {
  window.dispatchEvent(new Event(EVENT));
}

export function onContextChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
