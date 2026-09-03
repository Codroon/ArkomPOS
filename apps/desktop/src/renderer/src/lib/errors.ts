/**
 * Typed IPC errors, in the reader's language.
 *
 * The contract is the CODE (ADR-0012, system-design §4.5); the message that
 * travels with it is domain detail written in Spanish by the main process. Until
 * v0.14.1 this file translated seven codes and let the other twelve fall through
 * to that Spanish detail, so an English till answered a permission refusal in
 * Spanish — a hardcoded string with extra steps.
 *
 * The map below is `Record<ErrorCode, TKey | null>`, which makes the compiler the
 * guard: a code added to the union without a decision here does not build.
 *
 * `VALIDATION` maps to null on purpose. Its message is free-form detail naming
 * the field and the value, there are ~130 of them, and ADR-0011 decided they
 * render verbatim. That is the one seam left, and it is deliberate — see the
 * v0.14.1 report.
 */
import { parseIpcError, type ErrorCode, type IpcError } from "@arkom/core";
import type { TFn, TKey } from "@arkom/ui";

/** The typed envelope behind a bridge rejection, or null for an untyped failure. */
export function ipcOf(err: unknown): IpcError | null {
  return parseIpcError(err);
}

/**
 * One key per code, or null to pass the domain detail through.
 *
 * INVALID_PIN and USER_LOCKED carry a NUMBER in their message — attempts left,
 * seconds left — which the login and approval screens read and phrase for
 * themselves. Anywhere else the generic sentence is the right answer: showing
 * "3" to somebody who asked to save a product would be worse than saying
 * nothing.
 */
const KEY_FOR: Record<ErrorCode, TKey | null> = {
  AUTH_REQUIRED: "err.authRequired",
  PERMISSION_DENIED: "err.permissionDenied",
  APPROVAL_REQUIRED: "err.approvalRequired",
  INVALID_PIN: "err.invalidPin",
  USER_LOCKED: "err.userLocked",
  WEAK_PIN: "err.weakPin",
  LAST_OWNER: "err.lastOwner",
  PRINT_FAILED: "print.failed",
  DUPLICATE_NAME: "err.duplicateName",
  DUPLICATE_BARCODE: "err.duplicateBarcode",
  DUPLICATE_IMEI: "err.duplicateImei",
  NEGATIVE_STOCK: "err.negativeStock",
  UNIT_NOT_AVAILABLE: "err.unitNotAvailable",
  TENDER_MISMATCH: "err.tenderMismatch",
  SHIFT_REQUIRED: "err.shiftRequired",
  PRINTER_REQUIRED: "err.printerRequired",
  REVIEW_REQUIRED: "err.reviewRequired",
  DUPLICATE_MTCN: "err.duplicateMtcn",
  VALIDATION: null,
};

/** Exported so a test can assert every key in it exists in both dictionaries. */
export const ERROR_KEYS = KEY_FOR;

export function errorMessage(t: TFn, err: unknown): string {
  const ipc = parseIpcError(err);
  if (!ipc) return String((err as Error | undefined)?.message ?? err);
  const key = KEY_FOR[ipc.code];
  return key ? t(key) : ipc.message;
}
