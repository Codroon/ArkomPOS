/** Map typed IPC errors to locale strings; free-form VALIDATION detail stays as sent (ADR-0011). */
import { parseIpcError, type IpcError } from "@arkom/core";
import type { TFn } from "@arkom/ui";

/** The typed envelope behind a bridge rejection, or null for an untyped failure. */
export function ipcOf(err: unknown): IpcError | null {
  return parseIpcError(err);
}

export function errorMessage(t: TFn, err: unknown): string {
  const ipc = parseIpcError(err);
  if (!ipc) return String((err as Error | undefined)?.message ?? err);
  switch (ipc.code) {
    case "NEGATIVE_STOCK":
      return t("err.negativeStock");
    case "UNIT_NOT_AVAILABLE":
      return t("err.unitNotAvailable");
    case "TENDER_MISMATCH":
      return t("err.tenderMismatch");
    case "DUPLICATE_NAME":
      return t("err.duplicateName");
    case "DUPLICATE_BARCODE":
      return t("err.duplicateBarcode");
    case "DUPLICATE_IMEI":
      return t("err.duplicateImei");
    default:
      return ipc.message;
  }
}
