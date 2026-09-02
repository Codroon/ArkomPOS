/**
 * An inline error that expires when the input it was about changes.
 *
 * The dialogs all had the same shape: a server refusal stored in state, cleared
 * only on submit or cancel. So the message sat under the field while the shop
 * corrected the very thing it complained about — a fixed problem still looking
 * broken, which is how somebody concludes a feature does not work and stops
 * using it. That is exactly what happened with "Add a technician": the refusal
 * from an earlier attempt was still on screen next to a perfectly good name.
 *
 * The obvious fix is `setError(null)` in every `onChange`, and it is the wrong
 * one: it is a line four people must remember in four files, and the fifth
 * dialog will forget it.
 *
 * So the error carries the input it was ABOUT, and rendering compares. There is
 * no event to wire and nothing to remember — the message disappears because the
 * question changed, not because somebody wrote code to hide it.
 */
import { useState } from "react";

/** What is HELD: a message and the input it was a refusal about. */
export interface HeldError {
  message: string;
  key: string;
}

/**
 * The whole rule, as a function, so it can be tested without a React renderer —
 * `packages/ui` has no test runner and adding one would mean new dependencies.
 * The hook below is a two-line wrapper around this.
 */
export function errorFor(held: HeldError | null, key: string): string | null {
  return held !== null && held.key === key ? held.message : null;
}

export interface FieldError {
  /** The message, or null once the input has moved on. */
  error: string | null;
  /** Record a refusal against the input as it stands right now. */
  fail: (message: string) => void;
  /** Drop it outright — for closing a dialog, or starting a fresh attempt. */
  clear: () => void;
}

/**
 * @param key the input this error would be about. For a multi-field dialog,
 * join the fields that could cause a refusal — any edit to any of them makes a
 * standing message stale.
 */
export function useFieldError(key: string): FieldError {
  const [held, setHeld] = useState<HeldError | null>(null);
  return {
    error: errorFor(held, key),
    fail: (message: string) => setHeld({ message, key }),
    clear: () => setHeld(null),
  };
}
