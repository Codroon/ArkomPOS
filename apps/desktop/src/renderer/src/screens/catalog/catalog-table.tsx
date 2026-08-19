/**
 * Catalog list table — handoff 02 "Table". Sticky header, per-cell FALTA
 * chips on missing fields (req 3.3), read-only Stock from product_stock.
 */
import { missingFields, type MissingField, type ProductRow } from "@arkom/core";
import { Chip, cn, MoneyText } from "@arkom/ui";

export type SortKey = "name" | "priceCents" | "onHand";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

const TYPE_LABELS: Record<string, string> = {
  stocked: "STOCK",
  serialized: "SERIE", // 00-foundations ES label table
};

function MissingCell() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-faint">—</span>
      <Chip variant="warn">FALTA</Chip>
    </span>
  );
}

function Th({
  children,
  align = "left",
  sortKey,
  sort,
  onSort,
}: {
  children: string;
  align?: "left" | "right";
  sortKey?: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey && sort.key === sortKey;
  const label = (
    <>
      {children}
      {active ? <span className="ml-1 text-faint">{sort.dir === 1 ? "▲" : "▼"}</span> : null}
    </>
  );
  return (
    <th
      className={cn(
        "sticky top-0 z-10 border-b border-border-strong bg-panel-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-muted",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {sortKey ? (
        <button type="button" className="uppercase tracking-[.1em] hover:text-ink" onClick={() => onSort(sortKey)}>
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function CatalogTable({
  rows,
  selectedId,
  onSelect,
  sort,
  onSort,
}: {
  rows: ProductRow[];
  selectedId: string | null;
  onSelect: (row: ProductRow) => void;
  sort: Sort;
  onSort: (key: SortKey) => void;
}) {
  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr>
          <Th sort={sort} onSort={onSort}>Código</Th>
          <Th sort={sort} onSort={onSort} sortKey="name">Nombre</Th>
          <Th sort={sort} onSort={onSort}>Grupo</Th>
          <Th sort={sort} onSort={onSort}>Tipo</Th>
          <Th sort={sort} onSort={onSort} align="right">Coste</Th>
          <Th sort={sort} onSort={onSort} sortKey="priceCents" align="right">PVP</Th>
          <Th sort={sort} onSort={onSort} align="right">IVA</Th>
          <Th sort={sort} onSort={onSort} sortKey="onHand" align="right">Stock</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const missing = new Set<MissingField>(missingFields(row));
          const isSelected = row.id === selectedId;
          return (
            <tr
              key={row.id}
              onClick={() => onSelect(row)}
              className={cn(
                "cursor-pointer border-b border-border-light",
                isSelected ? "bg-row-selected" : missing.size > 0 ? "bg-row-missing" : "bg-card",
                !isSelected && "hover:bg-nav-hover",
              )}
            >
              <td className="px-3 py-1.5 font-mono text-[11px] tabular-nums text-faint">
                {missing.has("barcode") ? <MissingCell /> : row.barcode}
              </td>
              <td className={cn("px-3 py-1.5", row.active ? "text-ink" : "text-faint")}>
                {row.name}
                {!row.active ? <Chip className="ml-1.5">INACTIVO</Chip> : null}
              </td>
              <td className="px-3 py-1.5 text-ink-3">
                {missing.has("group") ? <MissingCell /> : row.groupName}
              </td>
              <td className="px-3 py-1.5">
                <Chip>{TYPE_LABELS[row.itemType] ?? row.itemType.toUpperCase()}</Chip>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted">
                {missing.has("cost") ? <MissingCell /> : <MoneyText cents={row.costCents!} />}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-bold">
                {missing.has("price") ? <MissingCell /> : <MoneyText cents={row.priceCents!} />}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                {missing.has("tax") ? <MissingCell /> : `${(row.taxRateBp ?? 0) / 100}%`}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{row.onHand}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
