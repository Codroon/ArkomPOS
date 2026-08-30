/**
 * Piezas por pedir — handoff/repairs.md §4.
 *
 * The owner's morning list: every open ordered line across every ticket, oldest
 * first, because the oldest is the one costing the shop a customer. Answering
 * "what do I need to order this morning" by opening thirty tickets is how
 * someone waits a week for a screen nobody remembered to buy.
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, type OrderedPartRow } from "@arkom/core";
import { GhostButton, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { ReceivePartDialog } from "./repair-dialogs";
import { OverdueChip, formatDate } from "./status-chip";

export function PartsToOrder({
  onOpenTicket,
  onChanged,
  refreshKey,
}: {
  onOpenTicket: (ticketId: string) => void;
  onChanged: (message: string) => void;
  refreshKey: number;
}) {
  const t = useT();
  const [rows, setRows] = useState<OrderedPartRow[] | null>(null);
  const [receiving, setReceiving] = useState<OrderedPartRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.arkom.invoke("repair:partsToOrder");
      // oldest first: the repo already sorts by ordered_at, and the days column
      // is the one a buyer scans down
      setRows(result.rows);
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
      setRows([]);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {error ? <div className="px-4 py-3 text-[12px] text-danger-ink">{error}</div> : null}
      {rows === null ? null : rows.length === 0 ? (
        // a good morning, and the screen should say so rather than show a grid
        <div className="px-4 py-6 text-[12px] text-subtle">{t("rep.parts.empty")}</div>
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-strong text-left text-[10px] font-bold tracking-[.08em] text-subtle">
              <th className="px-4 py-1.5">{t("rep.parts.part")}</th>
              <th className="px-2 py-1.5">{t("rep.parts.ticket")}</th>
              <th className="px-2 py-1.5">{t("rep.list.customer")}</th>
              <th className="px-2 py-1.5">{t("rep.list.promised")}</th>
              <th className="px-2 py-1.5 text-right">{t("rep.parts.expected")}</th>
              <th className="px-2 py-1.5">{t("rep.parts.supplier")}</th>
              <th className="px-2 py-1.5 text-right">{t("rep.parts.waiting")}</th>
              <th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const overdue = row.promisedAt !== null && row.promisedAt < Date.now();
              return (
                <tr key={row.lineId} className="border-b border-line hover:bg-hover">
                  <td className="px-4 py-1.5">
                    {row.qty > 1 ? `${row.qty} × ` : ""}
                    {row.description}
                    <div className="text-[10px] text-subtle">{row.deviceDescription}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      className="font-mono underline hover:text-accent-ink"
                      onClick={() => onOpenTicket(row.ticketId)}
                    >
                      {row.docNumber}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">{row.customerName}</td>
                  <td className="px-2 py-1.5">
                    <span className="mr-1.5 font-mono tabular-nums">
                      {row.promisedAt === null ? "—" : formatDate(row.promisedAt)}
                    </span>
                    {overdue ? <OverdueChip /> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {row.expectedCostCents === null ? "—" : formatCents(row.expectedCostCents)}
                  </td>
                  <td className="px-2 py-1.5 text-ink-2">{row.supplierText ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{row.daysWaiting}</td>
                  <td className="px-4 py-1.5 text-right">
                    <GhostButton onClick={() => setReceiving(row)}>{t("rep.parts.receive")}</GhostButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {receiving ? (
        <ReceivePartDialog
          lines={[
            {
              id: receiving.lineId,
              kind: "part_on_order",
              productId: null,
              description: receiving.description,
              qty: receiving.qty,
              unitCostCents: null,
              chargeCents: 0,
              supplierText: receiving.supplierText,
              expectedCostCents: receiving.expectedCostCents,
              orderedAt: receiving.orderedAt,
              receivedAt: null,
            },
          ]}
          onCancel={() => setReceiving(null)}
          onConfirm={async (input) => {
            try {
              await window.arkom.invoke("repair:receivePart", { ticketId: receiving.ticketId, ...input });
              // the toast says BOTH halves happened, because both did
              onChanged(t("rep.parts.received", { doc: receiving.docNumber }));
              setReceiving(null);
              void refresh();
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}
    </div>
  );
}
