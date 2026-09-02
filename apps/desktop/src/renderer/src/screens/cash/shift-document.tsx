/**
 * The Z and the X, on screen — ADR-0015 amendment.
 *
 * Both used to exist only as paper: pressing X printed one, and closing a shift
 * printed a Z whether anybody wanted it or not. A shop that wants to look at its
 * own day should not have to spend a roll of thermal paper to do it, and a till
 * that prints without being asked is a till somebody eventually stops reading.
 *
 * So this is the document, laid out to be read on a screen, in the app's
 * language. Print and Save PDF are actions on it. The thermal print keeps the
 * receipt format — 42 columns and a cut — because that is what the printer is.
 *
 * COPIA follows the same rule as every other document in the app: the paper
 * pulled at the moment of the event is the original, anything pulled later off a
 * list is stamped. Here that means the Z opened by closing the shift prints an
 * original ONCE; a Z reopened from the history is always a copy, and an X is
 * never either — it has no number to duplicate.
 */
import { useState } from "react";
import { formatCents, type ShiftState, type ShiftTotalsPayload } from "@arkom/core";
import { AccentButton, GhostButton, SectionLabel, cn, useLocale, useT, type TKey } from "@arkom/ui";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { PrintToast } from "../../lib/print-toast";

const METHOD_KEYS: Record<string, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
  store_credit: "pay.storeCredit",
  deposit: "rep.agreement.deposit",
};

const REASON_KEYS: Record<string, TKey> = {
  repair_deposit: "cash.reason.repair_deposit",
  repair_deposit_applied: "cash.reason.repair_deposit_applied",
  repair_deposit_refund: "cash.reason.repair_deposit_refund",
  used_purchase_payout: "cash.reason.used_purchase_payout",
  paid_in: "cash.reason.paid_in",
  paid_out: "cash.reason.paid_out",
};

const DOC_TYPE_KEYS: Record<string, TKey> = {
  ticket: "zdoc.docType.ticket",
  purchase: "zdoc.docType.purchase",
  repair: "zdoc.docType.repair",
};

function stamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Line({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "danger" | "warning" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <div className={cn("text-[12px]", bold ? "font-semibold text-ink" : "text-ink-2")}>{label}</div>
      <div
        className={cn(
          "font-mono tabular-nums",
          bold ? "text-[13px] font-bold" : "text-[12px] font-medium",
          tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : "",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-2">
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export function ShiftDocument({
  kind,
  shift,
  totals,
  terminalName,
  onClose,
  isOriginal = false,
  extraAction,
}: {
  kind: "z" | "x";
  shift: ShiftState;
  totals: ShiftTotalsPayload;
  terminalName: string;
  onClose: () => void;
  /** true only for the Z reached by closing the shift, and only until it prints */
  isOriginal?: boolean;
  /** "Open a new shift" after a close; absent for an X or a past Z */
  extraAction?: React.ReactNode;
}) {
  const t = useT();
  const [locale] = useLocale();
  const printer = useTicketPrint();
  /* the original is spent by the first print, whichever button spends it */
  const [spent, setSpent] = useState(false);

  const isZ = kind === "z";
  const variance = shift.varianceCents;

  const print = (target: "auto" | "pdf") => {
    printer.printShift(shift.id, kind, /* copy */ isZ && !(isOriginal && !spent), target, locale);
    setSpent(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{isZ ? t("zdoc.zTitle") : t("zdoc.xTitle")}</div>
        <div className="font-mono text-[12px] font-bold tabular-nums">
          {isZ ? (shift.zDocNumber ?? "—") : t("cash.close.preview")}
        </div>
        <div className="text-[11px] text-subtle">
          {terminalName} · {stamp(shift.openedAtMs)}
        </div>
        <div className="flex-1" />
        <GhostButton onClick={() => print("auto")}>{t("zdoc.print")}</GhostButton>
        <GhostButton onClick={() => print("pdf")}>{t("zdoc.savePdf")}</GhostButton>
        {extraAction ?? <AccentButton onClick={onClose}>{t("zdoc.close")}</AccentButton>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-[560px] flex-col gap-3 rounded-[3px] border border-line-strong bg-card px-5 py-4">
          <div>
            <Line label={t("zdoc.opened")} value={`${stamp(shift.openedAtMs)} · ${shift.openedByName ?? "—"}`} />
            {isZ ? (
              <Line label={t("zdoc.closed")} value={`${stamp(shift.closedAtMs)} · ${shift.closedByName ?? "—"}`} />
            ) : null}
          </div>

          {totals.series.length > 0 ? (
            <Block title={t("zdoc.documents")}>
              {totals.series.map((run) => (
                <Line
                  key={run.docType}
                  label={`${t(DOC_TYPE_KEYS[run.docType] ?? "common.dash")} · ${run.count}`}
                  value={run.firstNumber === run.lastNumber ? (run.firstNumber ?? "—") : `${run.firstNumber} → ${run.lastNumber}`}
                />
              ))}
            </Block>
          ) : null}

          <Block title={t("zdoc.sales")}>
            <Line label={t("rep2.sales.net")} value={formatCents(totals.netSalesCents)} />
            <Line label={t("rep2.sales.vat")} value={formatCents(totals.taxCents)} />
            {totals.usedSalesCents !== 0 ? (
              <Line label={t("rep2.sales.used")} value={formatCents(totals.usedSalesCents)} />
            ) : null}
            <Line label={t("zdoc.salesTotal")} value={formatCents(totals.grossSalesCents)} bold />
          </Block>

          <Block title={t("zdoc.tenders")}>
            {totals.tendersByMethod.map((row) => (
              <Line key={row.method} label={t(METHOD_KEYS[row.method] ?? "common.dash")} value={formatCents(row.amountCents)} />
            ))}
            <Line label={t("zdoc.tendersTotal")} value={formatCents(totals.tendersTotalCents)} bold />
            {/* should never render; it is here so a bug announces itself rather
                than showing two numbers and leaving the reader to spot it */}
            {totals.tenderImbalanceCents !== 0 ? (
              <Line label={t("zdoc.imbalance")} value={formatCents(totals.tenderImbalanceCents)} bold tone="danger" />
            ) : null}
          </Block>

          {totals.movementsByReason.length > 0 ? (
            <Block title={t("zdoc.movements")}>
              {totals.movementsByReason.map((row) => (
                <Line
                  key={row.reason}
                  label={`${t(REASON_KEYS[row.reason] ?? "common.dash")} · ${row.count}`}
                  value={formatCents(row.amountCents)}
                />
              ))}
            </Block>
          ) : null}

          {totals.byMethod.length > 0 ? (
            <Block title={t("zdoc.byMethod")}>
              {totals.byMethod.map((row) => (
                <div key={row.method} className="mb-1">
                  <div className="text-[12px] font-semibold">{t(METHOD_KEYS[row.method] ?? "common.dash")}</div>
                  <div className="pl-3">
                    <Line label={t("zdoc.in")} value={formatCents(row.inCents)} />
                    <Line label={t("zdoc.out")} value={formatCents(row.outCents)} />
                    <Line label={t("zdoc.net")} value={formatCents(row.netCents)} bold />
                  </div>
                </div>
              ))}
            </Block>
          ) : null}

          <Block title={t("zdoc.counts")}>
            <Line label={t("zdoc.usedPurchases")} value={String(totals.usedPurchaseCount)} />
            <Line label={t("zdoc.repairsCollected")} value={String(totals.repairsCollectedCount)} />
            <Line label={t("zdoc.parked")} value={String(totals.parkedCount)} />
          </Block>

          <Block title={t("cash.close.section")}>
            <Line label={t("cash.float")} value={formatCents(totals.openingFloatCents)} />
            <Line label={t("cash.close.expected")} value={formatCents(totals.expectedCashCents)} bold />
            {isZ && shift.countedCashCents !== null ? (
              <>
                <Line label={t("cash.close.counted")} value={formatCents(shift.countedCashCents)} />
                <Line
                  label={t("cash.close.variance")}
                  value={formatCents(variance ?? 0)}
                  bold
                  tone={(variance ?? 0) === 0 ? undefined : (variance ?? 0) < 0 ? "danger" : "warning"}
                />
                {variance !== null && variance !== 0 ? (
                  <div className="mt-1 text-[11px] font-bold text-ink-2">
                    {t(variance < 0 ? "cash.close.short" : "cash.close.over", {
                      amount: formatCents(Math.abs(variance)),
                    })}
                  </div>
                ) : null}
                {shift.varianceReason ? (
                  <div className="mt-1 text-[11px] text-ink-2">
                    {t("cash.close.reason")}: {shift.varianceReason}
                  </div>
                ) : null}
                {shift.approvedByName ? (
                  <div className="text-[11px] text-ink-2">
                    {t("cash.history.approved")}: {shift.approvedByName}
                  </div>
                ) : null}
              </>
            ) : null}
          </Block>

          {!isZ ? <div className="border-t border-line pt-2 text-[11px] text-muted">{t("zdoc.xFooter")}</div> : null}
        </div>
      </div>

      <PrintToast printer={printer} />
    </div>
  );
}
