/**
 * Product grid — handoff 01 left column: per-group sections, 4-col cards,
 * SERIE chip on serialized products. Plain scroll (handoff 02 P1 deviation).
 */
import { useMemo } from "react";
import { type EntityRef, type ProductRow } from "@arkom/core";
import { Chip, cn, GhostButton, MoneyText, SectionLabel, useDataLabel, useT } from "@arkom/ui";
import { navigateTo } from "../../lib/screen-bus";

function Card({
  product,
  shake,
  onAdd,
}: {
  product: ProductRow;
  shake: boolean;
  onAdd: (p: ProductRow) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      className={cn(
        "flex flex-col gap-1 rounded-[3px] border border-line bg-card p-2 text-left hover:border-line-strong",
        shake && "arkom-shake border-line-strong",
      )}
    >
      <div className="line-clamp-2 min-h-[28px] text-[11px] leading-snug text-ink">
        {dataLabel(product.name)}
        {product.itemType === "serialized" ? <Chip className="ml-1">{t("chip.serie")}</Chip> : null}
      </div>
      <div className="truncate font-mono font-medium text-[9px] tabular-nums text-subtle">{product.barcode ?? ""}</div>
      <MoneyText cents={product.priceCents ?? 0} className="text-[12px] font-bold" />
    </button>
  );
}

export function ProductGrid({
  products,
  groups,
  activeGroup,
  search,
  shakeProductId,
  onAdd,
}: {
  products: ProductRow[];
  groups: EntityRef[];
  activeGroup: string; // "" = all
  search: string;
  /** the card that just refused to be added (out of stock) — shakes once */
  shakeProductId: string | null;
  onAdd: (p: ProductRow) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeGroup && p.groupId !== activeGroup) return false;
      if (needle.length >= 2 && !p.name.toLowerCase().includes(needle) && !(p.barcode ?? "").includes(needle)) {
        return false;
      }
      return true;
    });
  }, [products, activeGroup, search]);

  if (products.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="text-[12px] text-muted">{t("sale.emptyCatalog")}</div>
          <GhostButton className="mt-2" onClick={() => navigateTo("catalogo")}>
            {t("sale.goToCatalog")}
          </GhostButton>
        </div>
      </div>
    );
  }

  const sections = (activeGroup ? groups.filter((g) => g.id === activeGroup) : groups)
    .map((group) => ({ group, items: visible.filter((p) => p.groupId === group.id) }))
    .filter((s) => s.items.length > 0);
  const ungrouped = visible.filter((p) => !p.groupId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {sections.map(({ group, items }) => (
        <div key={group.id} className="mb-4">
          <SectionLabel className="mb-1.5">
            {dataLabel(group.name)} <span className="font-normal text-subtle">({items.length})</span>
          </SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {items.map((p) => (
              <Card key={p.id} product={p} shake={p.id === shakeProductId} onAdd={onAdd} />
            ))}
          </div>
        </div>
      ))}
      {ungrouped.length > 0 ? (
        <div className={cn("grid grid-cols-4 gap-2", sections.length > 0 && "mt-2")}>
          {ungrouped.map((p) => (
            <Card key={p.id} product={p} shake={p.id === shakeProductId} onAdd={onAdd} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
