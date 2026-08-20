/**
 * Read-only ticket peek (sale:peek) — opened from the movimientos drawer's
 * Documento links and reusable anywhere a docNumber is shown. Esc closes.
 */
import { useEffect, useState } from "react";
import type { TicketPeek } from "@arkom/core";
import { GhostButton, MoneyText, SectionLabel, useT, type TKey } from "@arkom/ui";

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
  const [peek, setPeek] = useState<TicketPeek | null>(null);

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
        className="flex max-h-[80vh] w-[380px] flex-col rounded-[3px] border border-border-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 border-b border-border-strong bg-panel-2 px-4 py-2.5">
          <div className="font-mono text-[14px] font-bold tabular-nums">{peek?.docNumber ?? "…"}</div>
          {peek?.completedAtMs ? (
            <div className="font-mono text-[10px] tabular-nums text-muted">{formatDate(peek.completedAtMs)}</div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {peek ? (
            <>
              {peek.lines.map((line, i) => (
                <div key={i} className="flex items-baseline gap-2 border-b border-border-light py-1.5 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{line.description}</div>
                    <div className="font-mono text-[10px] tabular-nums text-faint">
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
                        <span className="ml-1 font-mono text-[10px] text-faint">{tender.cardReference}</span>
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

        <div className="flex justify-end border-t border-border bg-panel-2 px-4 py-2">
          <GhostButton onClick={onClose}>{t("peek.close")}</GhostButton>
        </div>
      </div>
    </div>
  );
}
