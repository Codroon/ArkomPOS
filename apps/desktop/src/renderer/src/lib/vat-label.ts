/**
 * "IVA 21%" from the rate the lines actually carry — the snapshot, never a
 * constant (ADR-0007 A1). "IVA" alone when nothing on the ticket was taxed,
 * which is what a ticket of margin-scheme lines looks like.
 */
import type { TFn } from "@arkom/ui";

export function vatLabelFor(t: TFn, lines: ReadonlyArray<{ taxRateBp?: number | null }> | undefined): string {
  const top = (lines ?? []).reduce((max, l) => Math.max(max, l.taxRateBp ?? 0), 0);
  return top > 0 ? t("sale.vat", { pct: top / 100 }) : t("sale.vatPlain");
}
