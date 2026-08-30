/**
 * Movimientos drawer (right, 420px) — handoff 03 / req 5.4. Newest first,
 * infinite scroll over inventory:movements' keyset cursor. Documento links
 * open the read-only ticket peek; Usuario "—" until auth (ADR-0010).
 * Fixed-layout table so 420px never overflows horizontally. Esc closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { InventoryRow, MovementRow } from "@arkom/core";
import { Chip, cn, MoneyText, useT, type ChipVariant, type TKey, useDataLabel } from "@arkom/ui";
import { TicketPeekModal } from "../../components/ticket-peek-modal";
import { PurchasePeekModal } from "../../components/purchase-peek-modal";

const TYPE_KEYS: Record<string, TKey> = {
  purchase_in: "mov.entrada",
  sale_out: "mov.venta",
  adjustment: "mov.ajuste",
};

/** stock arriving reads as success, leaving as neutral, corrections as warning */
const TYPE_VARIANTS: Record<string, ChipVariant> = {
  purchase_in: "success",
  sale_out: "neutral",
  adjustment: "warning",
};

function formatShort(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MovementsDrawer({ product, onClose }: { product: InventoryRow; onClose: () => void }) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  /* which document the link opened, and what kind — a purchase document is not
     a ticket and does not render as one */
  const [peek, setPeek] = useState<{ id: string; type: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(
    (after: string | null) => {
      setLoading(true);
      window.arkom
        .invoke("inventory:movements", { productId: product.productId, cursor: after })
        .then((res) => {
          setRows((prev) => (after ? [...prev, ...res.rows] : res.rows));
          setCursor(res.nextCursor);
          setDone(res.nextCursor === null);
        })
        .catch((err) => console.error("inventory:movements failed", err))
        .finally(() => setLoading(false));
    },
    [product.productId],
  );

  useEffect(() => {
    setRows([]);
    setCursor(null);
    setDone(false);
    loadPage(null);
  }, [loadPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !peek) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, peek]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loading || done) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadPage(cursor);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/10" onMouseDown={onClose}>
      <div
        className="flex h-full w-[420px] flex-col border-l border-line-strong bg-surface shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{dataLabel(product.name)}</div>
          <div className="font-mono font-medium text-[11px] tabular-nums text-muted">
            {t("drawer.onHand", { n: product.onHand })}
          </div>
          <div className="flex-1" />
          <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 && !loading ? (
            <div className="p-6 text-center text-[12px] text-muted">{t("drawer.empty")}</div>
          ) : (
            <table className="w-full table-fixed border-collapse text-[11px]">
              <colgroup>
                <col className="w-[66px]" />
                <col />
                <col className="w-[46px]" />
                <col className="w-[64px]" />
                <col className="w-[84px]" />
                <col className="w-[54px]" />
              </colgroup>
              <thead>
                <tr>
                  {(["drawer.col.date", "drawer.col.type", "drawer.col.qty", "drawer.col.cost", "drawer.col.doc", "drawer.col.user"] as TKey[]).map(
                    (key, i) => (
                      <th
                        key={key}
                        className={cn(
                          "sticky top-0 overflow-hidden border-b border-line-strong bg-surface-2 px-1.5 py-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-muted",
                          i >= 2 && i <= 3 ? "text-right" : "text-left",
                        )}
                      >
                        {t(key)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const typeKey = TYPE_KEYS[m.movementType];
                  return (
                    <tr key={m.id} className="border-b border-line bg-card align-top">
                      <td className="whitespace-nowrap px-1.5 py-1.5 font-mono font-medium text-[10px] tabular-nums text-muted">
                        {formatShort(m.createdAtMs)}
                      </td>
                      <td className="px-1.5 py-1.5">
                        <Chip variant={TYPE_VARIANTS[m.movementType] ?? "neutral"}>
                          {typeKey ? t(typeKey) : m.movementType.toUpperCase()}
                        </Chip>
                        {m.imei ? (
                          <div className="mt-0.5 truncate font-mono font-medium text-[9px] tabular-nums text-subtle">{m.imei}</div>
                        ) : null}
                      </td>
                      <td
                        className={cn(
                          "px-1.5 py-1.5 text-right font-mono font-medium tabular-nums",
                          m.qty > 0 ? "font-bold text-ink" : "text-ink-2",
                        )}
                      >
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 text-right text-[10px] text-muted">
                        {m.unitCostCents == null ? t("common.dash") : <MoneyText cents={m.unitCostCents} />}
                      </td>
                      <td className="truncate px-1.5 py-1.5 font-mono font-medium text-[10px] tabular-nums">
                        {m.documentId && m.documentNumber ? (
                          <button
                            type="button"
                            className="text-ink-2 underline hover:text-ink"
                            onClick={() => setPeek({ id: m.documentId!, type: m.documentType })}
                          >
                            {m.documentNumber}
                          </button>
                        ) : (
                          <span className="text-muted">{t("common.dash")}</span>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-subtle">{m.userId ?? t("common.dash")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {loading ? <div className="p-3 text-center text-[11px] text-subtle">…</div> : null}
        </div>

        <div className="border-t border-line bg-surface-2 px-4 py-2 text-[10px] text-subtle">
          {t("drawer.footerNote")}
        </div>
      </div>
      {peek?.type === "purchase" ? (
        <PurchasePeekModal documentId={peek.id} onClose={() => setPeek(null)} />
      ) : peek ? (
        <TicketPeekModal docId={peek.id} onClose={() => setPeek(null)} />
      ) : null}
    </div>
  );
}
