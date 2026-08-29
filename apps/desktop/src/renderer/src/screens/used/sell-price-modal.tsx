/**
 * The selling-price modal — handoff/used-devices.md §1.
 *
 * Opened by *Enviar a inventario*, before anything is written. Sending a phone
 * to the shelf and pricing it are the same decision, so the till asks once
 * rather than creating a sellable device with no price and hoping somebody
 * comes back to it.
 *
 * The prefill is cost × (1 + margin), rounded UP to 5 cents, and the margin is
 * named underneath — a number the cashier can overwrite is only trustworthy if
 * they can see where it came from.
 */
import { useEffect, useRef, useState } from "react";
import { centsToInput, formatCents, parseMoneyInput, suggestedSellPriceCents } from "@arkom/core";
import { AccentButton, Field, GhostButton, SectionLabel, TextInput, useT } from "@arkom/ui";

export function SellPriceModal({
  buyPriceCents,
  refurbCostCents,
  marginPct,
  busy,
  onCancel,
  onConfirm,
}: {
  buyPriceCents: number;
  refurbCostCents: number;
  marginPct: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (sellPriceCents: number) => void;
}) {
  const t = useT();
  const costCents = buyPriceCents + refurbCostCents;
  const suggested = suggestedSellPriceCents(costCents, marginPct);
  const [input, setInput] = useState(() => centsToInput(suggested));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const cents = parseMoneyInput(input);
  const valid = cents !== null && cents > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40">
      <div className="w-[380px] rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="border-b border-line-strong bg-surface-2 px-4 py-2.5 text-[13px] font-bold">
          {t("used.sell.title")}
        </div>

        <div className="px-4 py-3">
          <div className="rounded-[3px] border border-line bg-surface px-3 py-2 text-[11px]">
            <Row label={t("used.sell.buyPrice")} value={formatCents(buyPriceCents)} />
            {refurbCostCents > 0 ? (
              <Row label={t("used.sell.refurb")} value={formatCents(refurbCostCents)} />
            ) : null}
            <Row label={t("used.sell.cost")} value={formatCents(costCents)} bold />
          </div>

          <Field
            className="mt-3"
            label={t("used.sell.price")}
            required
            hint={t("used.sell.marginHint", { pct: marginPct })}
          >
            <TextInput
              ref={inputRef}
              mono
              requiredStyle
              className="h-9 text-[18px] font-bold"
              inputMode="decimal"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !busy) onConfirm(cents);
              }}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <GhostButton disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </GhostButton>
          {/* the modal's one blue element */}
          <AccentButton disabled={!valid || busy} onClick={() => valid && onConfirm(cents)}>
            {busy ? t("common.saving") : t("used.sell.confirm")}
          </AccentButton>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-px">
      <SectionLabel>{label}</SectionLabel>
      <span className={`font-mono tabular-nums ${bold ? "text-[12px] font-bold text-ink" : "text-[11px] text-ink-2"}`}>
        {value}
      </span>
    </div>
  );
}
