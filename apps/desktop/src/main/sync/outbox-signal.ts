/**
 * "This till just wrote something" — ADR-0024 §3.
 *
 * The push used to run once a minute, so a sale reached the cloud, and the
 * other counter, up to a minute later. Now every committed `mutate()` rings
 * this, and the outbox sends within a fraction of a second. A signal and not an
 * import because `mutate-runner.ts` is below the sync layer and must stay so:
 * the runner says a write happened; whether anybody pushes is `push.ts`'s
 * business, and an unlinked till has nobody listening.
 */
let listener: (() => void) | null = null;

export function onLocalWrite(fn: () => void): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** Called after the transaction COMMITTED. Never throws into the write that rang it. */
export function localWriteHappened(): void {
  try {
    listener?.();
  } catch {
    /* the minute timer pushes it anyway */
  }
}
