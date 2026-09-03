/**
 * "Can this till issue a document?" — asked once, answered everywhere.
 *
 * Since v0.18.1 the acts that hand a person paper — a sale, a refund, a repair
 * hand-back, a repair intake, buying a used phone — are refused in main when
 * Ajustes names no printer. That refusal is the rule and it cannot be argued
 * with from here.
 *
 * This is the courtesy in front of it. A cashier who fills in a whole intake
 * form, photographs a phone from four angles and then meets a red message has
 * been failed by the screen, not by the printer. So every screen that can be
 * refused says so up front and greys its own button.
 *
 * One cache and one refresh, the same shape as the group and technician
 * pickers, so configuring a printer in Ajustes reaches the other screens
 * without a remount.
 */
import { useEffect, useState } from "react";
import { MetaContextResponseSchema } from "@arkom/core";
import { Chip, useT } from "@arkom/ui";

/** null = not asked yet; screens treat it as "probably fine" until it answers. */
let cache: boolean | null = null;
const listeners = new Set<(ready: boolean) => void>();

export async function refreshPrinterReady(): Promise<boolean> {
  try {
    const meta = MetaContextResponseSchema.parse(await window.arkom.invoke("meta:context"));
    cache = meta.printerConfigured;
  } catch (err) {
    /* the question is unanswerable, so do not stand in anybody's way: main
       still refuses if it must, and that path is already handled */
    console.error("meta:context failed", err);
    cache = cache ?? true;
  }
  for (const fn of listeners) fn(cache);
  return cache;
}

/**
 * Whether the till can issue a document. Optimistic before the first answer —
 * a screen must not grey its own button on a question it has not asked yet.
 */
export function usePrinterReady(): boolean {
  const [ready, setReady] = useState(cache ?? true);
  useEffect(() => {
    listeners.add(setReady);
    if (cache === null) void refreshPrinterReady();
    else setReady(cache);
    return () => {
      listeners.delete(setReady);
    };
  }, []);
  return ready;
}

/**
 * The line a screen shows instead of letting somebody work for nothing.
 *
 * Warning, not danger: nothing has gone wrong yet, and the thing to do about it
 * is five seconds away in Ajustes.
 */
export function PrinterRequiredNotice({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      className={`flex flex-none items-center gap-2 border-b border-warning-ink/25 bg-warning-bg px-4 py-1.5 text-[11px] text-warning-ink ${className ?? ""}`}
    >
      <Chip variant="warning">{t("set.printerMissing")}</Chip>
      <span>{t("err.printerRequired")}</span>
    </div>
  );
}
