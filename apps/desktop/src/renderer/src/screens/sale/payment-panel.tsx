/**
 * Payment panel — handoff 01: four tender tiles, amounts prefilled with the
 * remaining due, running Pendiente/Cambio from core's tenderSummary (shared
 * math, server revalidates at completion), card reference field, Cobrar (F4)
 * with single-submit; completed state with the allocated number.
 */
import { centsToInput, parseMoneyInput, tenderSummary, uuidv7, type CompletedSale, type SaleState, type TenderDraft, type TenderMethod } from "@arkom/core";
import { cn, Field, GhostButton, LockedButton, MoneyText, PrimaryButton, TextInput, useT, type TKey } from "@arkom/ui";

export interface TenderEntry {
  key: string;
  method: TenderMethod;
  amountInput: string;
  cardReference: string;
}

export function newTenderEntry(method: TenderMethod, remainingCents: number): TenderEntry {
  return { key: uuidv7(), method, amountInput: centsToInput(Math.max(0, remainingCents)), cardReference: "" };
}

export function parseTenders(entries: TenderEntry[]): TenderDraft[] | null {
  const out: TenderDraft[] = [];
  for (const entry of entries) {
    const cents = parseMoneyInput(entry.amountInput);
    if (cents === null || cents <= 0) return null;
    out.push({ method: entry.method, amountCents: cents, cardReference: entry.cardReference || null });
  }
  return out;
}

const METHOD_KEYS: Record<TenderMethod, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
};
const METHODS: TenderMethod[] = ["cash", "card", "bizum", "transfer"];

export function PaymentPanel({
  sale,
  entries,
  charging,
  onChange,
  onCharge,
}: {
  sale: SaleState | null;
  entries: TenderEntry[];
  charging: boolean;
  onChange: (entries: TenderEntry[]) => void;
  onCharge: () => void;
}) {
  const t = useT();
  const total = sale?.totalCents ?? 0;
  const parsed = parseTenders(entries);
  const summary = parsed ? tenderSummary(total, parsed) : null;
  const remaining = summary ? summary.remainingCents : total;

  const cardRefsOk = entries.every((e) => e.method !== "card" || e.cardReference.trim().length >= 4);
  const canCharge =
    !!sale && sale.lines.length > 0 && !!parsed && !!summary && summary.remainingCents === 0 && !summary.nonCashExcess && cardRefsOk && !charging;

  return (
    <div className={cn("border-t border-border-strong bg-panel px-3 py-2.5", charging && "pointer-events-none opacity-70")}>
      <div className="grid grid-cols-4 gap-1.5">
        {METHODS.map((method) => (
          <button
            key={method}
            type="button"
            onClick={() => onChange([...entries, newTenderEntry(method, remaining)])}
            className="rounded-[3px] border border-border-input bg-card px-1 py-2 text-[11px] font-bold text-ink-2 hover:border-ink-3 hover:text-ink"
          >
            {t(METHOD_KEYS[method])}
          </button>
        ))}
      </div>

      {entries.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {entries.map((entry) => (
            <div key={entry.key} className="rounded-[3px] border border-border bg-card p-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-[86px] text-[11px] font-bold text-ink-2">{t(METHOD_KEYS[entry.method])}</span>
                <TextInput
                  mono
                  className="h-6 flex-1"
                  value={entry.amountInput}
                  onChange={(e) =>
                    onChange(entries.map((x) => (x.key === entry.key ? { ...x, amountInput: e.target.value } : x)))
                  }
                  onBlur={() => {
                    const cents = parseMoneyInput(entry.amountInput);
                    if (cents !== null) {
                      onChange(entries.map((x) => (x.key === entry.key ? { ...x, amountInput: centsToInput(cents) } : x)));
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={t("pay.removeTender")}
                  className="px-1 text-[12px] text-muted hover:text-ink"
                  onClick={() => onChange(entries.filter((x) => x.key !== entry.key))}
                >
                  ✕
                </button>
              </div>
              {entry.method === "card" ? (
                <Field
                  label={t("pay.cardRef")}
                  required
                  className="mt-1.5"
                  error={entry.cardReference.trim().length > 0 && entry.cardReference.trim().length < 4 ? t("pay.cardRefHint") : null}
                >
                  <TextInput
                    mono
                    requiredStyle
                    className="h-6"
                    value={entry.cardReference}
                    onChange={(e) =>
                      onChange(entries.map((x) => (x.key === entry.key ? { ...x, cardReference: e.target.value } : x)))
                    }
                  />
                </Field>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex justify-between font-mono text-[12px] tabular-nums">
        {summary && summary.changeCents > 0 ? (
          <>
            <span className="font-sans font-bold text-ink">{t("pay.change")}</span>
            <MoneyText cents={summary.changeCents} className="font-bold" />
          </>
        ) : (
          <>
            <span className="font-sans text-muted">{t("pay.pending")}</span>
            <MoneyText cents={remaining} className={remaining > 0 ? "text-ink-2" : "text-faint"} />
          </>
        )}
      </div>
      {summary?.nonCashExcess ? <div className="mt-1 text-[11px] text-ink-2">{t("err.tenderMismatch")}</div> : null}

      <PrimaryButton className="mt-2 h-9 w-full text-[13px]" disabled={!canCharge} onClick={onCharge}>
        {charging ? t("pay.charging") : t("pay.charge")}
      </PrimaryButton>
    </div>
  );
}

export function CompletedPanel({ completed, onNew }: { completed: CompletedSale; onNew: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
      <div className="text-[12px] font-bold uppercase tracking-[.1em] text-muted">{t("done.title")}</div>
      <div className="font-mono text-[28px] font-bold tabular-nums">{completed.docNumber}</div>
      <MoneyText cents={completed.totalCents} className="text-[16px] font-bold" />
      {completed.changeCents > 0 ? (
        <div className="flex items-baseline gap-2 font-mono text-[14px] tabular-nums">
          <span className="font-sans text-[11px] text-muted">{t("pay.change")}</span>
          <MoneyText cents={completed.changeCents} className="font-bold" />
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <LockedButton>{t("done.print")}</LockedButton>
        <PrimaryButton onClick={onNew}>{t("done.new")}</PrimaryButton>
      </div>
      <div className="text-[10px] text-faint">{t("done.autoHint")}</div>
    </div>
  );
}
