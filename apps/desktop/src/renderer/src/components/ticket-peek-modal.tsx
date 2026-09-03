/**
 * Read-only ticket peek (sale:peek) — opened from the movimientos drawer's
 * Documento links and reusable anywhere a docNumber is shown. Esc closes.
 *
 * Reprint lives here because this is where you land when looking for a sale
 * that already happened: the customer is back at the counter without their
 * ticket. Every reprint is stamped COPIA and does not open the drawer.
 */
import { useEffect, useState } from "react";
import type { TicketPeek } from "@arkom/core";
import { GhostButton, MoneyText, SectionLabel, useT, type TKey, useDataLabel } from "@arkom/ui";
import { useTicketPrint } from "../lib/use-ticket-print";
import { useCan } from "../lib/use-session";
import { RefundDialog } from "./refund-dialog";
import { PrintToast } from "../lib/print-toast";

const METHOD_KEYS: Record<string, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TicketPeekModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [peek, setPeek] = useState<TicketPeek | null>(null);
  const printer = useTicketPrint();
  const can = useCan();
  const [refunding, setRefunding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    window.arkom
      .invoke("sale:peek", { docId })
      .then(setPeek)
      .catch((err) => console.error("sale:peek failed", err));
  }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/25" onMouseDown={onClose}>
      <div
        className="flex max-h-[80vh] w-[380px] flex-col rounded-[3px] border border-line-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="font-mono text-[14px] font-bold tabular-nums">{peek?.docNumber ?? "…"}</div>
          {peek?.completedAtMs ? (
            <div className="font-mono font-medium text-[10px] tabular-nums text-muted">{formatDate(peek.completedAtMs)}</div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {peek ? (
            <>
              {peek.lines.map((line, i) => (
                <div key={i} className="flex items-baseline gap-2 border-b border-line py-1.5 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{dataLabel(line.description)}</div>
                    <div className="font-mono font-medium text-[10px] tabular-nums text-subtle">
                      {line.imei ? `IMEI ${line.imei} · ` : ""}
                      {line.qty} × <MoneyText cents={line.unitPriceCents} />
                    </div>
                  </div>
                  <MoneyText cents={line.totalCents} className="font-bold" />
                </div>
              ))}
              <div className="mt-2 space-y-0.5 text-[11px]">
                <div className="flex justify-between text-muted">
                  <span>{t("sale.subtotal")}</span>
                  <MoneyText cents={peek.subtotalCents} />
                </div>
                <div className="flex justify-between text-muted">
                  <span>{t("sale.iva21")}</span>
                  <MoneyText cents={peek.taxCents} />
                </div>
                <div className="flex justify-between text-[14px] font-bold">
                  <span>{t("sale.total")}</span>
                  <MoneyText cents={peek.totalCents} />
                </div>
              </div>
              <div className="mt-3">
                <SectionLabel>{t("peek.tenders")}</SectionLabel>
                {peek.tenders.map((tender, i) => (
                  <div key={i} className="flex justify-between py-0.5 text-[11px] text-ink-2">
                    <span>
                      {t(METHOD_KEYS[tender.method] ?? "pay.cash")}
                      {tender.cardReference ? (
                        <span className="ml-1 font-mono font-medium text-[10px] text-subtle">{tender.cardReference}</span>
                      ) : null}
                    </span>
                    <MoneyText cents={tender.amountCents} />
                  </div>
                ))}
                {peek.changeCents > 0 ? (
                  <div className="flex justify-between py-0.5 text-[11px] text-muted">
                    <span>{t("pay.change")}</span>
                    <MoneyText cents={peek.changeCents} />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-4 py-2">
          {/* only a completed sale has a ticket to reprint */}
          {peek?.status === "completed" ? (
            <GhostButton disabled={printer.state.busy} onClick={() => printer.print(peek.docId, true)}>
              {printer.state.busy ? t("print.printing") : t("print.reprint")}
            </GhostButton>
          ) : null}
          {/* a refund starts from the ticket, which is the thing the customer
              is holding (ADR-0019) */}
          {peek?.status === "completed" && can("sale.refund") ? (
            <GhostButton onClick={() => setRefunding(true)}>{t("refund.start")}</GhostButton>
          ) : null}
          <GhostButton onClick={onClose}>{t("peek.close")}</GhostButton>
        </div>
      </div>

      <PrintToast printer={printer} />
      {refunding && peek ? (
        <RefundDialog
          documentId={peek.docId}
          onCancel={() => setRefunding(false)}
          onDone={(message) => {
            setRefunding(false);
            setToast(message);
            /* re-read: the ticket's remaining quantities have moved, and the
               next refund must be offered the new figures */
            void window.arkom.invoke("sale:peek", { docId }).then(setPeek).catch(() => undefined);
            setTimeout(() => setToast(null), 3200);
          }}
        />
      ) : null}
      {toast ? (
        <div className="fixed bottom-4 right-4 z-[80] rounded-[3px] border border-line-strong bg-card px-3 py-2 text-[12px] shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
