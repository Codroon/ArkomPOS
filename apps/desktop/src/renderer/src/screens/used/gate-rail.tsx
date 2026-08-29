/**
 * The gate rail — handoff/used-devices.md §1 "The gate rail".
 *
 * Three stacked cards, and the order is the control: card 2 and 3 are visibly
 * inert until card 1 passes. The gate is not a validation nicety — it is the
 * moment a shop decides whether to hand over cash for a phone that might be
 * stolen or locked, so the screen refuses to talk about money until someone has
 * said, in writing, that they physically checked the device.
 *
 * Main refuses the same thing independently (spec V4). This rail is the
 * courtesy; the handler is the control.
 */
import { formatCents, type UsedCheckImeiResponse } from "@arkom/core";
import { Field, GhostButton, SectionLabel, TextInput, cn, useT } from "@arkom/ui";
import type { BuyDraft } from "./model";
import { buyPriceCents } from "./model";

export type GateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "result"; result: UsedCheckImeiResponse };

export function GateRail({
  draft,
  gate,
  confirmed,
  onConfirmedChange,
  onPatch,
  onGenerateBarcode,
  barcodeError,
}: {
  draft: BuyDraft;
  gate: GateState;
  confirmed: boolean;
  onConfirmedChange: (next: boolean) => void;
  onPatch: (patch: Partial<BuyDraft>) => void;
  onGenerateBarcode: () => void;
  barcodeError: string | null;
}) {
  const t = useT();

  const result = gate.phase === "result" ? gate.result : null;
  const imeiOk = result?.ok === true;
  const passed = imeiOk && confirmed;
  const priceCents = buyPriceCents(draft);

  return (
    <div className="flex w-[340px] flex-none flex-col gap-3">
      {/* 1 · the IMEI check */}
      <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
        <SectionLabel>{t("used.gate.section")}</SectionLabel>

        <div className="mt-1.5 font-mono text-[17px] font-bold tabular-nums tracking-[.02em]">
          {draft.imei.trim() || <span className="text-subtle">{t("common.dash")}</span>}
        </div>

        <div className="mt-1 min-h-[16px] text-[11px]">
          {gate.phase === "idle" ? (
            <span className="text-subtle">{t("used.gate.waiting")}</span>
          ) : gate.phase === "checking" ? (
            <span className="text-muted">{t("used.gate.checking")}</span>
          ) : result?.rejection === "format" ? (
            <span className="text-danger-ink">{t("used.gate.formatBad")}</span>
          ) : result?.rejection ? (
            <span className="text-danger-ink">
              {t("used.gate.duplicate")}{" "}
              {result.existing
                ? result.rejection === "duplicate_unit"
                  ? t("used.gate.duplicateUnit", { label: result.existing.label })
                  : t("used.gate.duplicatePurchase", { label: result.existing.label })
                : null}
            </span>
          ) : (
            <span className="text-success-ink">{t("used.gate.formatOk")}</span>
          )}
        </div>

        {/* the confirmation IS the gate — a valid IMEI on its own opens nothing */}
        <label
          className={cn(
            "mt-2 flex cursor-pointer items-start gap-2 rounded-[3px] border px-2 py-2",
            imeiOk ? "border-line-strong bg-surface" : "cursor-default border-line bg-surface-2 opacity-60",
          )}
        >
          <input
            type="checkbox"
            className="mt-[2px] h-3.5 w-3.5 flex-none accent-ink"
            disabled={!imeiOk}
            checked={confirmed}
            onChange={(e) => onConfirmedChange(e.target.checked)}
          />
          <span className="text-[11px] leading-snug text-ink-2">{t("used.gate.confirm")}</span>
        </label>

        {/* the wireframe implied a GSMA lookup; we ship none, so the screen says so */}
        <div className="mt-2 rounded-[2px] border border-warning-ink/25 bg-warning-bg px-2 py-1.5 text-[10px] leading-snug text-warning-ink">
          {t("used.gate.offline")}
        </div>

        {passed ? <div className="mt-1.5 text-[11px] text-success-ink">{t("used.gate.passed")}</div> : null}
      </section>

      {/* 2 · price */}
      <section
        className={cn(
          "rounded-[3px] border px-3 py-2.5",
          passed ? "border-line-strong bg-card" : "border-line bg-surface-2",
        )}
      >
        <SectionLabel>{t("used.price.section")}</SectionLabel>
        {passed ? (
          <>
            <div className="mt-1 text-[11px] text-subtle">{t("used.price.noRate")}</div>
            <Field className="mt-1.5" label={t("used.price.buyPrice")} required>
              <TextInput
                mono
                requiredStyle
                className="h-9 text-[18px] font-bold"
                inputMode="decimal"
                value={draft.buyPriceInput}
                onChange={(e) => onPatch({ buyPriceInput: e.target.value })}
                placeholder="0,00"
              />
            </Field>
          </>
        ) : (
          <div className="mt-1 text-[11px] text-subtle">{t("used.price.locked")}</div>
        )}
      </section>

      {/* 3 · payout */}
      <section
        className={cn(
          "rounded-[3px] border px-3 py-2.5",
          passed ? "border-line-strong bg-card" : "border-line bg-surface-2",
        )}
      >
        <SectionLabel>{t("used.payout.section")}</SectionLabel>
        {passed ? (
          <>
            <div className="mt-1.5 flex overflow-hidden rounded-[3px] border border-line-strong">
              {(
                [
                  ["cash", t("used.payout.cash")],
                  ["transfer", t("used.payout.transfer")],
                  ["store_credit", t("used.payout.credit")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onPatch({ payout: value })}
                  className={cn(
                    "flex-1 border-r border-line px-1 py-1 text-[11px] last:border-r-0",
                    draft.payout === value
                      ? "bg-ink font-semibold text-inverse-ink"
                      : "bg-card text-ink-2 hover:bg-hover",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {draft.payout === "transfer" ? (
              <Field className="mt-2" label={t("used.payout.reference")} required>
                <TextInput
                  mono
                  requiredStyle
                  value={draft.payoutReference}
                  onChange={(e) => onPatch({ payoutReference: e.target.value })}
                />
              </Field>
            ) : null}

            <div className="mt-1.5 text-[10px] leading-snug text-subtle">
              {draft.payout === "store_credit"
                ? t("used.payout.creditNote", {
                    amount: priceCents === null ? t("common.dash") : formatCents(priceCents),
                  })
                : draft.payout === "cash"
                  ? t("used.payout.cashNote")
                  : ""}
            </div>
          </>
        ) : (
          <div className="mt-1 text-[11px] text-subtle">{t("used.price.locked")}</div>
        )}
      </section>

      {/* barcode — under the payment card, per the handoff */}
      <section
        className={cn(
          "rounded-[3px] border px-3 py-2.5",
          passed ? "border-line-strong bg-card" : "border-line bg-surface-2",
        )}
      >
        <SectionLabel>{t("used.barcode.section")}</SectionLabel>
        <div className="mt-1.5 flex gap-1.5">
          <TextInput
            mono
            disabled={!passed}
            value={draft.barcode}
            onChange={(e) => onPatch({ barcode: e.target.value })}
            placeholder={t("used.barcode.placeholder")}
          />
          <GhostButton className="flex-none" disabled={!passed} onClick={onGenerateBarcode}>
            {t("used.barcode.generate")}
          </GhostButton>
        </div>
        {barcodeError ? (
          <div className="mt-1 text-[11px] text-danger-ink">{barcodeError}</div>
        ) : (
          <div className="mt-1 text-[10px] text-subtle">{t("used.barcode.hint")}</div>
        )}
      </section>
    </div>
  );
}
