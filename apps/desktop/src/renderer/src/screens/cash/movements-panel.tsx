/**
 * Movimientos de efectivo — handoff/cash.md §2c.
 *
 * The first question every user asks of this panel is why today's sales are not
 * in it, so the heading answers it before they ask: takings live on the tickets
 * and are read from there (ADR-0015 §3).
 *
 * Automatic rows have no edit affordance at all — not a disabled one. They are
 * facts recorded by another module, and the only thing to do with one here is
 * open the document it belongs to.
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, type CashMovementRow, type CashMovementsResponse } from "@arkom/core";
import { Chip, GhostButton, SectionLabel, cn, useT, type TKey } from "@arkom/ui";
import { useCan } from "../../lib/use-session";
import { ManualMovementDialog } from "./manual-movement-dialog";

const REASON_KEYS: Record<string, TKey> = {
  repair_deposit: "cash.reason.repair_deposit",
  repair_deposit_applied: "cash.reason.repair_deposit_applied",
  repair_deposit_refund: "cash.reason.repair_deposit_refund",
  used_purchase_payout: "cash.reason.used_purchase_payout",
  paid_in: "cash.reason.paid_in",
  paid_out: "cash.reason.paid_out",
};

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function MovementsPanel({
  onPeekDocument,
  onChanged,
}: {
  onPeekDocument?: (documentId: string) => void;
  onChanged?: () => void;
}) {
  const t = useT();
  const can = useCan();
  const [data, setData] = useState<CashMovementsResponse>({ rows: [], inCents: 0, outCents: 0, netCents: 0 });
  const [dialog, setDialog] = useState<"in" | "out" | null>(null);

  const load = useCallback(() => {
    window.arkom
      .invoke("cash:movements", {})
      .then(setData)
      .catch((err) => console.error("cash:movements failed", err));
  }, []);

  useEffect(() => load(), [load]);

  const showAppliedNote = data.rows.some((row) => !row.movesCash);

  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-[3px] border border-line-strong bg-card">
      <div className="flex flex-none items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <SectionLabel>{t("cash.mov.section")}</SectionLabel>
          <div className="mt-0.5 text-[11px] text-subtle">{t("cash.mov.note")}</div>
        </div>
        <div className="flex-1" />
        {can("cash.movement") ? (
          <>
            <GhostButton onClick={() => setDialog("in")}>{t("cash.mov.paidIn")}</GhostButton>
            <GhostButton onClick={() => setDialog("out")}>{t("cash.mov.paidOut")}</GhostButton>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
            <tr>
              <th className="px-3 py-1.5 text-left font-bold">{t("cash.mov.time")}</th>
              <th className="px-3 py-1.5 text-left font-bold">{t("cash.mov.type")}</th>
              <th className="px-3 py-1.5 text-left font-bold">{t("cash.mov.concept")}</th>
              <th className="px-3 py-1.5 text-left font-bold">{t("cash.mov.user")}</th>
              <th className="px-3 py-1.5 text-right font-bold">{t("cash.mov.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-muted">
                  {t("cash.mov.empty")}
                </td>
              </tr>
            ) : (
              data.rows.map((row) => <MovementRow key={row.id} row={row} onPeek={onPeekDocument} />)
            )}
          </tbody>
        </table>
        {showAppliedNote ? (
          <div className="px-3 py-2 text-[10px] text-subtle">° {t("cash.mov.appliedNote")}</div>
        ) : null}
      </div>

      <div className="flex flex-none items-center gap-4 border-t border-line-strong bg-surface-2 px-3 py-1.5 text-[11px]">
        <span className="text-muted">{t("cash.mov.in")}</span>
        <span className="font-mono font-bold tabular-nums">{formatCents(data.inCents)}</span>
        <span className="text-muted">{t("cash.mov.out")}</span>
        {/* the same minus formatCents uses, so the strip and the rows agree */}
        <span className="font-mono font-bold tabular-nums text-danger-ink">{formatCents(-data.outCents)}</span>
        <div className="flex-1" />
        <span className="text-muted">{t("cash.mov.net")}</span>
        <span className="font-mono font-bold tabular-nums">{formatCents(data.netCents)}</span>
      </div>

      {dialog ? (
        <ManualMovementDialog
          direction={dialog}
          onCancel={() => setDialog(null)}
          onDone={(next) => {
            setData(next);
            setDialog(null);
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}

function MovementRow({ row, onPeek }: { row: CashMovementRow; onPeek?: (documentId: string) => void }) {
  const t = useT();
  const clickable = row.documentId !== null && onPeek !== undefined;

  return (
    <tr
      className={cn("border-b border-line last:border-b-0", clickable && "cursor-pointer hover:bg-hover", !row.movesCash && "text-subtle")}
      onClick={clickable ? () => onPeek!(row.documentId!) : undefined}
    >
      <td className="px-3 py-1.5 font-mono tabular-nums">{hhmm(row.atMs)}</td>
      <td className="px-3 py-1.5">
        <Chip variant={row.movesCash ? "neutral" : "info"}>{t(REASON_KEYS[row.reason] ?? "common.dash")}</Chip>
      </td>
      <td className="px-3 py-1.5">
        {row.concept ?? row.docNumber ?? t("common.dash")}
        {!row.movesCash ? <span className="ml-1 text-[10px]">°</span> : null}
      </td>
      <td className="px-3 py-1.5">{row.userName ?? t("common.dash")}</td>
      <td
        className={cn(
          "px-3 py-1.5 text-right font-mono font-bold tabular-nums",
          !row.movesCash ? "text-subtle line-through" : row.amountCents < 0 ? "text-danger-ink" : "text-ink",
        )}
      >
        {formatCents(row.amountCents)}
      </td>
    </tr>
  );
}
