/**
 * Cierre — handoff/cash.md §2b, and the confirm dialog in §3d.
 *
 * The expected figure is shown BEFORE the count is typed. The alternative — hide
 * it until they commit — is the classic anti-collusion design, and it is wrong
 * for a two-person shop where the owner is one of the two: hiding it would mean
 * the cashier cannot notice a 400 € discrepancy before counting three times. The
 * control here is the approval and the immutable record, not blind counting.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  centsToInput,
  formatCents,
  needsVarianceApproval,
  parseMoneyInput,
  varianceCents,
  type Breakdown,
  type ShiftTotalsPayload,
} from "@arkom/core";
import { AccentButton, Chip, Field, GhostButton, SectionLabel, TextInput, cn, useT, type TKey } from "@arkom/ui";

import { errorMessage } from "../../lib/errors";
import { useApprovalFlow } from "../../lib/use-approval";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { DenominationDialog } from "./denomination-dialog";

/** The Z prints Spanish always; the screen follows the staff toggle (ADR-0011). */
const METHOD_KEYS: Record<string, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
  store_credit: "pay.storeCredit",
  deposit: "rep.agreement.deposit",
};


function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cn("font-mono tabular-nums", bold ? "text-[13px] font-bold" : "text-[12px] font-medium")}>{value}</div>
    </div>
  );
}

export function ClosePanel({
  reloadKey,
  onClosed,
}: {
  /** bumped whenever a movement lands, so the expected figure is never stale */
  reloadKey: number;
  onClosed: (closed: { shiftId: string; zDocNumber: string }) => void;
}) {
  const t = useT();
  const approval = useApprovalFlow();
  const printer = useTicketPrint();

  const [totals, setTotals] = useState<ShiftTotalsPayload | null>(null);
  const [counted, setCounted] = useState("");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [reason, setReason] = useState("");
  const [tolerance, setTolerance] = useState(300);
  const [counting, setCounting] = useState(false);
  const [detail, setDetail] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The X, live. Re-read whenever the panel mounts: a sale two seconds ago has
     to be in the figure the cashier is about to count against. */
  const load = useCallback(() => {
    window.arkom
      .invoke("cash:preview", {})
      .then((res) => setTotals(res.totals))
      .catch((err) => console.error("cash:preview failed", err));
  }, []);

  /* Re-read when a movement lands. A cashier who pays 50 € out and then counts
     against a figure computed before it would come up exactly 50 € over — the
     kind of "discrepancy" that teaches people the tolerance is noise. */
  useEffect(() => {
    load();
  }, [load, reloadKey]);

  useEffect(() => {
    window.arkom
      .invoke("settings:get")
      .then((s) => setTolerance(s.cashVarianceToleranceCents))
      .catch((err) => console.error("settings:get failed", err));
  }, []);

  const countedCents = useMemo(() => parseMoneyInput(counted), [counted]);
  const expected = totals?.expectedCashCents ?? 0;
  const variance = countedCents === null ? null : varianceCents(countedCents, expected);
  const needsReason = variance !== null && variance !== 0;
  const needsApproval = variance !== null && needsVarianceApproval(variance, tolerance);
  const canClose = countedCents !== null && (!needsReason || reason.trim() !== "") && !busy;

  const submit = async () => {
    if (countedCents === null || !canClose) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { countedCents, breakdown, reason: reason.trim() || null };
      const res = await approval.run(
        (auth) => window.arkom.invoke("cash:close", payload, auth),
        "cash.close_over_tolerance",
        {
          title: t("cash.close.title"),
          details: [
            { label: t("cash.close.expected"), value: formatCents(expected) },
            { label: t("cash.close.counted"), value: formatCents(countedCents) },
            { label: t("cash.close.variance"), value: formatCents(variance ?? 0) },
          ],
        },
      );
      setConfirming(false);
      /* by its ID, not "the open shift": this one has just stopped being open,
         and asking for the open shift now finds none */
      printer.printShift(res.shiftId, "z");
      onClosed({ shiftId: res.shiftId, zDocNumber: res.zDocNumber });
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  };

  if (counting) {
    return (
      <DenominationDialog
        initial={breakdown}
        onCancel={() => setCounting(false)}
        onUse={(totalCents, next) => {
          setCounted(centsToInput(totalCents));
          setBreakdown(next);
          setCounting(false);
        }}
      />
    );
  }

  return (
    <div className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SectionLabel>{t("cash.close.section")}</SectionLabel>
        <Chip variant="info">{t("cash.close.preview")}</Chip>
      </div>

      <div className="mt-1.5">
        <Row label={t("cash.close.expected")} value={formatCents(expected)} bold />

        <div className="mt-1.5 flex items-center gap-2">
          <div className="flex-1 text-[11px] text-muted">{t("cash.close.counted")}</div>
          <TextInput
            mono
            inputMode="decimal"
            className="w-[110px] text-right"
            value={counted}
            onChange={(e) => {
              setCounted(e.target.value);
              setBreakdown(null); // typing over a counted figure retires its breakdown
            }}
          />
          <GhostButton onClick={() => setCounting(true)}>{t("cash.count")}</GhostButton>
        </div>

        {variance !== null ? (
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <div className="text-[11px] text-muted">{t("cash.close.variance")}</div>
            <div className="flex items-baseline gap-2">
              {variance !== 0 ? (
                <span className={cn("text-[10px] font-bold", variance < 0 ? "text-danger-ink" : "text-warning-ink")}>
                  {t(variance < 0 ? "cash.close.short" : "cash.close.over", {
                    amount: formatCents(Math.abs(variance)),
                  })}
                </span>
              ) : null}
              <span
                className={cn(
                  "font-mono text-[13px] font-bold tabular-nums",
                  variance === 0 ? "text-muted" : variance < 0 ? "text-danger-ink" : "text-warning-ink",
                )}
              >
                {formatCents(variance)}
              </span>
            </div>
          </div>
        ) : null}

        {needsReason ? (
          <Field className="mt-1.5" label={t("cash.close.reason")} error={error}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setDetail((d) => !d)}
        className="mt-2 w-full border-t border-line pt-1.5 text-left text-[11px] text-ink-2 hover:text-ink"
      >
        {detail ? "▾" : "▸"} {t("cash.close.detail")}
      </button>
      {detail && totals ? <ZFigures totals={totals} /> : null}

      <div className="mt-2 flex flex-col gap-1 text-[11px] leading-snug">
        {needsApproval ? (
          <div className="text-warning-ink">{t("cash.close.needsApproval", { amount: formatCents(tolerance) })}</div>
        ) : null}
        {totals && totals.parkedCount > 0 ? (
          <div className="text-muted">
            {totals.parkedCount === 1
              ? t("cash.close.parkedOne")
              : t("cash.close.parked", { n: totals.parkedCount })}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <GhostButton onClick={() => printer.printShift(undefined, "x")}>{t("cash.close.printX")}</GhostButton>
        <AccentButton disabled={!canClose} onClick={() => setConfirming(true)}>
          {t("cash.close.button")}
        </AccentButton>
      </div>

      {confirming && variance !== null && countedCents !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
          <div className="w-[420px] rounded-[3px] border border-line-strong bg-card shadow-lg">
            <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{t("cash.close.title")}</div>
            <div className="px-3.5 py-3">
              {/* a confirmation, not a form: everything was typed in the panel,
                  and re-typing a count is how the two figures come to differ */}
              <Row label={t("cash.close.expected")} value={formatCents(expected)} />
              <Row label={t("cash.close.counted")} value={formatCents(countedCents)} />
              <Row label={t("cash.close.variance")} value={formatCents(variance)} bold />
              {reason.trim() ? <div className="mt-1.5 text-[11px] text-ink-2">{reason.trim()}</div> : null}
              {needsApproval ? (
                <div className="mt-2 text-[11px] leading-snug text-warning-ink">
                  {t("cash.close.needsApproval", { amount: formatCents(tolerance) })}
                </div>
              ) : null}
              {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
              <GhostButton onClick={() => setConfirming(false)}>{t("common.cancel")}</GhostButton>
              <AccentButton disabled={busy} onClick={() => void submit()}>
                {t("cash.close.confirm")}
              </AccentButton>
            </div>
          </div>
        </div>
      ) : null}
      {approval.modal}
    </div>
  );
}

/** The full Z body, live — the same numbers a close would freeze right now. */
function ZFigures({ totals }: { totals: ShiftTotalsPayload }) {
  const t = useT();
  return (
    <div className="mt-1.5 border-t border-line pt-1.5">
      <Row label={t("cash.z.sales")} value={formatCents(totals.netSalesCents)} />
      <Row label={t("cash.z.vat")} value={formatCents(totals.taxCents)} />
      {totals.usedSalesCents !== 0 ? <Row label={t("cash.z.used")} value={formatCents(totals.usedSalesCents)} /> : null}
      <Row label={t("cash.z.grossSales")} value={formatCents(totals.grossSalesCents)} bold />

      <div className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{t("cash.z.byMethod")}</div>
      {totals.byMethod.map((row) => (
        <Row key={row.method} label={t(METHOD_KEYS[row.method] ?? "common.dash")} value={formatCents(row.netCents)} />
      ))}
    </div>
  );
}
