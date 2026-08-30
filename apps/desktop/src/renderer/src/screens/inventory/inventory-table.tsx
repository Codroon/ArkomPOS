/**
 * Stock table — handoff 03. Quantities display-only (req 5.1); Estado chip
 * from core's isLowStock; serialized rows show the SERIE chip and their
 * valuation is Σ unit costs (computed server-side).
 */
import { isLowStock, type InventoryRow } from "@arkom/core";
import { Chip, cn, MoneyText, useT, type TKey, useDataLabel } from "@arkom/ui";

function Th({ labelKey, align = "left" }: { labelKey: TKey; align?: "left" | "right" }) {
  const t = useT();
  return (
    <th
      className={cn(
        "sticky top-0 z-10 border-b border-line-strong bg-surface-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-muted",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {t(labelKey)}
    </th>
  );
}

export function InventoryTable({
  rows,
  loading,
  flashIds,
  onSelect,
}: {
  rows: InventoryRow[];
  loading: boolean;
  flashIds: ReadonlySet<string>;
  onSelect: (row: InventoryRow) => void;
}) {
  const dataLabel = useDataLabel();
  const t = useT();
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr>
          <Th labelKey="inv.col.item" />
          <Th labelKey="inv.col.qty" align="right" />
          <Th labelKey="inv.col.reorder" align="right" />
          <Th labelKey="inv.col.status" />
          <Th labelKey="inv.col.unitCost" align="right" />
          <Th labelKey="inv.col.valuation" align="right" />
        </tr>
      </thead>
      <tbody>
        {loading
          ? [0, 1, 2].map((i) => (
              <tr key={i} className="border-b border-line">
                <td colSpan={6} className="px-3 py-2">
                  <div className="h-4 animate-pulse rounded-[2px] bg-surface-2" />
                </td>
              </tr>
            ))
          : rows.map((row) => {
              const low = isLowStock(row);
              return (
                <tr
                  key={row.productId}
                  onClick={() => onSelect(row)}
                  className={cn(
                    "cursor-pointer border-b border-line transition-colors duration-500",
                    flashIds.has(row.productId) ? "bg-surface-2" : "bg-card hover:bg-hover",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <span className={row.active ? "text-ink" : "text-subtle"}>{dataLabel(row.name)}</span>
                    {row.itemType === "serialized" ? <Chip className="ml-1.5">{t("chip.serie")}</Chip> : null}
                    <div className="font-mono font-medium text-[10px] tabular-nums text-subtle">
                      {row.barcode ?? t("common.dash")}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-[13px] font-bold tabular-nums">
                    {row.onHand}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-medium tabular-nums text-muted">
                    {row.reorderPoint}
                  </td>
                  <td className="px-3 py-1.5">
                    {low ? (
                      <Chip variant="warning">{t("chip.bajoMinimo")}</Chip>
                    ) : (
                      <span className="text-[11px] text-subtle">{t("inv.ok")}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted">
                    {row.costCents == null ? t("common.dash") : <MoneyText cents={row.costCents} />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <MoneyText cents={row.valuationCents} />
                  </td>
                </tr>
              );
            })}
      </tbody>
    </table>
  );
}
