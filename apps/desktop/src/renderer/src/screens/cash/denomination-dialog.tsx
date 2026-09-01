/**
 * Counting the drawer — handoff/cash.md §3b.
 *
 * One component, used by both the open and the close, so the float and the
 * closing count are never counted two different ways. It computes rather than
 * merely records: quantities × values, live, and the total it hands back is the
 * one that gets stored.
 */
import { useMemo, useState } from "react";
import {
  COIN_DENOMINATIONS_CENTS,
  NOTE_DENOMINATIONS_CENTS,
  breakdownTotalCents,
  formatCents,
  type Breakdown,
} from "@arkom/core";
import { AccentButton, GhostButton, SectionLabel, TextInput, cn, useT } from "@arkom/ui";

/** "2000" → "20,00 €", "50" → "0,50 €" — the label on the row, not money math. */
const label = (cents: number) => formatCents(cents);

function Column({
  heading,
  values,
  qty,
  onQty,
}: {
  heading: string;
  values: ReadonlyArray<number>;
  qty: Record<string, string>;
  onQty: (cents: number, raw: string) => void;
}) {
  return (
    <div className="flex-1">
      <SectionLabel>{heading}</SectionLabel>
      <div className="mt-1.5 flex flex-col gap-1">
        {values.map((cents, i) => {
          const raw = qty[String(cents)] ?? "";
          const n = Number(raw);
          const sub = raw === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.trunc(n)) * cents;
          return (
            <div key={cents} className="flex items-center gap-1.5">
              <div className="w-[62px] text-right font-mono text-[11px] font-medium tabular-nums text-ink-2">
                {label(cents)}
              </div>
              <span className="text-[11px] text-subtle">×</span>
              <TextInput
                mono
                autoFocus={i === 0}
                inputMode="numeric"
                className="w-[52px] px-1 text-center"
                value={raw}
                onChange={(e) => onQty(cents, e.target.value)}
              />
              <div
                className={cn(
                  "flex-1 text-right font-mono text-[11px] font-bold tabular-nums",
                  sub === 0 ? "text-subtle" : "text-ink",
                )}
              >
                {formatCents(sub)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DenominationDialog({
  initial,
  onCancel,
  onUse,
}: {
  initial?: Breakdown | null;
  onCancel: () => void;
  onUse: (totalCents: number, breakdown: Breakdown) => void;
}) {
  const t = useT();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, String(v)])),
  );

  /** Empty means zero, and it stays empty — a forced 0 to delete is a papercut. */
  const onQtyChange = (cents: number, raw: string) => {
    if (raw !== "" && !/^\d{0,4}$/.test(raw)) return;
    setQty((q) => ({ ...q, [String(cents)]: raw }));
  };

  const breakdown = useMemo<Breakdown>(() => {
    const out: Record<string, number> = {};
    for (const [key, raw] of Object.entries(qty)) {
      const n = Number(raw);
      if (raw !== "" && Number.isFinite(n) && n > 0) out[key] = Math.trunc(n);
    }
    return out;
  }, [qty]);

  const totalCents = useMemo(() => breakdownTotalCents(breakdown), [breakdown]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-inverse/40">
      <div className="w-[560px] rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{t("cash.denom.title")}</div>

        <div className="flex gap-5 px-3.5 py-3">
          <Column heading={t("cash.denom.notes")} values={NOTE_DENOMINATIONS_CENTS} qty={qty} onQty={onQtyChange} />
          <Column heading={t("cash.denom.coins")} values={COIN_DENOMINATIONS_CENTS} qty={qty} onQty={onQtyChange} />
        </div>

        <div className="flex items-center gap-3 border-t border-line-strong bg-surface-2 px-3.5 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{t("cash.denom.total")}</div>
          <div className="font-display text-[20px] tabular-nums">{formatCents(totalCents)}</div>
          <div className="flex-1 text-[11px] text-subtle">{t("cash.denom.hint")}</div>
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          {/* this modal is its own surface, so the blue lives here */}
          <AccentButton onClick={() => onUse(totalCents, breakdown)}>{t("cash.denom.use")}</AccentButton>
        </div>
      </div>
    </div>
  );
}
