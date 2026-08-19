/**
 * Movimientos drawer (right, 420px) — handoff 03 / req 5.4. Newest first,
 * infinite scroll over inventory:movements' keyset cursor. Documento renders
 * "—" until Venta exists; Usuario "—" until auth (ADR-0010). Esc closes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { InventoryRow, MovementRow } from "@arkom/core";
import { Chip, cn, MoneyText, useT, type TKey } from "@arkom/ui";

const TYPE_KEYS: Record<string, TKey> = {
  purchase_in: "mov.entrada",
  sale_out: "mov.venta",
  adjustment: "mov.ajuste",
};

function formatShort(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function MovementsDrawer({ product, onClose }: { product: InventoryRow; onClose: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
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
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loading || done) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) loadPage(cursor);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/10" onMouseDown={onClose}>
      <div
        className="flex h-full w-[420px] flex-col border-l border-border-strong bg-panel shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2 border-b border-border-strong bg-panel-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{product.name}</div>
          <div className="font-mono text-[11px] tabular-nums text-muted">
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
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {(["drawer.col.date", "drawer.col.type", "drawer.col.qty", "drawer.col.cost", "drawer.col.doc", "drawer.col.user"] as TKey[]).map(
                    (key, i) => (
                      <th
                        key={key}
                        className={cn(
                          "sticky top-0 border-b border-border-strong bg-panel-2 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-muted",
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
                    <tr key={m.id} className="border-b border-border-light bg-card">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted">
                        {formatShort(m.createdAtMs)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Chip>{typeKey ? t(typeKey) : m.movementType.toUpperCase()}</Chip>
                        {m.imei ? (
                          <div className="mt-0.5 font-mono text-[9px] tabular-nums text-faint">{m.imei}</div>
                        ) : null}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right font-mono tabular-nums",
                          m.qty > 0 ? "font-bold text-ink" : "text-ink-2",
                        )}
                      >
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted">
                        {m.unitCostCents == null ? t("common.dash") : <MoneyText cents={m.unitCostCents} />}
                      </td>
                      <td className="px-2 py-1.5 font-mono tabular-nums text-ink-3">
                        {m.documentNumber ?? t("common.dash")}
                      </td>
                      <td className="px-2 py-1.5 text-faint">{m.userId ?? t("common.dash")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {loading ? <div className="p-3 text-center text-[11px] text-faint">…</div> : null}
        </div>

        <div className="border-t border-border bg-panel-2 px-4 py-2 text-[10px] text-faint">
          {t("drawer.footerNote")}
        </div>
      </div>
    </div>
  );
}
