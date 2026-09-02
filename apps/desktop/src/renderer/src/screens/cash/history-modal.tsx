/**
 * Turnos anteriores — handoff/cash.md §4.
 *
 * Read-only, and there is no affordance suggesting otherwise: a closed shift
 * cannot be reopened, edited or deleted (ADR-0015 §8). A miscount found tomorrow
 * is a movement in tomorrow's shift, not a correction to yesterday's Z.
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, type ShiftListRow } from "@arkom/core";
import { GhostButton, cn, useT } from "@arkom/ui";
import { useShift } from "../../lib/use-shift";
import { errorMessage } from "../../lib/errors";

function stamp(ms: number | null): string {
  if (ms === null) return "—";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function HistoryModal({ onClose, onOpen }: { onClose: () => void; onOpen: (shiftId: string) => void }) {
  const t = useT();
  const [rows, setRows] = useState<ShiftListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { version: shiftVersion } = useShift();

  /**
   * Load, and say so when it fails.
   *
   * The first version fetched once on mount and rendered an empty table if the
   * call threw — which is what a locked session does. "No shifts" and "we could
   * not ask" look identical and mean opposite things, so the failure now says
   * so and offers the retry.
   *
   * It also re-reads on `shiftVersion`, which changes when the session unlocks
   * and the shift is re-read: a modal opened while locked fills itself in
   * afterwards instead of sitting empty until somebody closes and reopens it.
   */
  const load = useCallback(() => {
    setError(null);
    window.arkom
      .invoke("cash:history", { limit: 50 })
      .then((res) => setRows(res.rows.filter((row) => row.closedAtMs !== null)))
      .catch((err) => {
        console.error("cash:history failed", err);
        setRows(null);
        setError(errorMessage(t, err));
      });
  }, [t]);

  useEffect(() => load(), [load, shiftVersion]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-[880px] overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-line px-3.5 py-2.5">
          <div className="text-[13px] font-bold">{t("cash.history.title")}</div>
          <div className="flex-1" />
          <GhostButton onClick={onClose}>{t("common.cancel")}</GhostButton>
        </div>

        <div className="max-h-[68vh] overflow-y-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-bold">Z</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("cash.history.opened")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("cash.history.closed")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("cash.history.expected")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("cash.history.counted")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("cash.history.variance")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("cash.history.approved")}</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {error !== null ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center">
                    <div className="text-[12px] text-danger-ink">{error}</div>
                    <GhostButton className="mt-2" onClick={load}>
                      {t("common.retry")}
                    </GhostButton>
                  </td>
                </tr>
              ) : rows !== null && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[12px] text-muted">
                    {t("cash.history.empty")}
                  </td>
                </tr>
              ) : (
                (rows ?? []).map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
                    onClick={() => onOpen(row.id)}
                  >
                    <td className="px-3 py-1.5 font-mono font-medium tabular-nums">{row.zDocNumber ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {stamp(row.openedAtMs)} · {row.openedByName ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {stamp(row.closedAtMs)} · {row.closedByName ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {row.expectedCashCents === null ? "—" : formatCents(row.expectedCashCents)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {row.countedCashCents === null ? "—" : formatCents(row.countedCashCents)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right font-mono font-bold tabular-nums",
                        (row.varianceCents ?? 0) === 0
                          ? "text-muted"
                          : (row.varianceCents ?? 0) < 0
                            ? "text-danger-ink"
                            : "text-warning-ink",
                      )}
                    >
                      {row.varianceCents === null ? "—" : formatCents(row.varianceCents)}
                    </td>
                    <td className="px-3 py-1.5">{row.approvedByName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      {/* the row opens the stored snapshot as a document;
                          printing is a button on THAT, and optional */}
                      <GhostButton onClick={() => onOpen(row.id)}>{t("zdoc.zTitle")}</GhostButton>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
