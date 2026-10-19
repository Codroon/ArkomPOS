/**
 * Product grid — handoff 01 left column: per-group sections, 4-col cards,
 * SERIE chip on serialized products. Plain scroll (handoff 02 P1 deviation).
 *
 * Since v1.5.0 (ADR-0025) two quick tabs sit in front of the groups:
 * Favourites, which anybody pins with the star and arranges by dragging, and
 * Best sellers, which the ledger fills by itself. Typing in the search box
 * always searches the whole catalogue, whichever tab is open — a cashier who
 * types a name wants that product, not that product only if it is a favourite.
 */
import { useMemo, useState } from "react";
import { type GroupRef, type ProductRow } from "@arkom/core";
import { Chip, cn, GhostButton, MoneyText, SectionLabel, useDataLabel, useT } from "@arkom/ui";
import { useGroupName } from "../../components/group-picker";
import { navigateTo } from "../../lib/screen-bus";

/** The two tabs that are not groups. Group ids are UUIDs, so these cannot collide. */
export const FAVOURITES_TAB = "__favourites__";
export const BEST_SELLERS_TAB = "__best_sellers__";

function Card({
  product,
  shake,
  onAdd,
  pinned,
  onTogglePin,
  sold,
  drag,
}: {
  product: ProductRow;
  shake: boolean;
  onAdd: (p: ProductRow) => void;
  pinned: boolean;
  onTogglePin: (p: ProductRow, pinned: boolean) => void;
  /** units sold in the window, on the Best sellers tab */
  sold?: number;
  /** drag-to-reorder handlers, on the Favourites tab */
  drag?: {
    over: boolean;
    onDragStart: () => void;
    onDragOver: () => void;
    onDrop: () => void;
    onDragEnd: () => void;
  };
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  return (
    <div
      className={cn("relative", drag?.over && "rounded-[3px] outline outline-2 outline-ink")}
      draggable={Boolean(drag)}
      onDragStart={(e) => {
        if (!drag) return;
        e.dataTransfer.effectAllowed = "move";
        drag.onDragStart();
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDragOver();
      }}
      onDrop={(e) => {
        if (!drag) return;
        e.preventDefault();
        drag.onDrop();
      }}
      onDragEnd={() => drag?.onDragEnd()}
    >
      <button
        type="button"
        onClick={() => onAdd(product)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-[3px] border border-line bg-card p-2 pr-6 text-left hover:border-line-strong",
          shake && "arkom-shake border-line-strong",
          drag && "cursor-grab",
        )}
      >
        <div className="line-clamp-2 min-h-[28px] text-[11px] leading-snug text-ink">
          {dataLabel(product.name)}
          {product.itemType === "serialized" ? <Chip className="ml-1">{t("chip.serie")}</Chip> : null}
        </div>
        <div className="truncate font-mono font-medium text-[9px] tabular-nums text-subtle">{product.barcode ?? ""}</div>
        <div className="flex items-baseline justify-between gap-1">
          <MoneyText cents={product.priceCents ?? 0} className="text-[12px] font-bold" />
          {sold !== undefined ? (
            <span className="truncate text-[10px] text-subtle">{t("sale.soldN", { n: String(sold) })}</span>
          ) : null}
        </div>
      </button>
      {/* a sibling of the card, not inside it: a button in a button is invalid,
          and pinning must never add the product to the ticket */}
      <button
        type="button"
        aria-pressed={pinned}
        title={pinned ? t("sale.unpin") : t("sale.pin")}
        aria-label={pinned ? t("sale.unpin") : t("sale.pin")}
        onClick={() => onTogglePin(product, !pinned)}
        className={cn(
          "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-[3px] text-[13px] leading-none",
          pinned ? "text-ink" : "text-subtle hover:text-ink",
        )}
      >
        {pinned ? "★" : "☆"}
      </button>
    </div>
  );
}

export function ProductGrid({
  products,
  groups,
  activeGroup,
  search,
  shakeProductId,
  onAdd,
  favourites,
  bestSellers,
  bestSellerDays,
  onTogglePin,
  onReorder,
}: {
  products: ProductRow[];
  groups: GroupRef[];
  activeGroup: string; // "" = all, or FAVOURITES_TAB / BEST_SELLERS_TAB, or a group id
  search: string;
  /** the card that just refused to be added (out of stock) — shakes once */
  shakeProductId: string | null;
  onAdd: (p: ProductRow) => void;
  /** pinned product ids, in the shop's order */
  favourites: string[];
  bestSellers: { productId: string; qty: number }[];
  bestSellerDays: number;
  onTogglePin: (p: ProductRow, pinned: boolean) => void;
  onReorder: (productIds: string[]) => void;
}) {
  const t = useT();
  const groupName = useGroupName();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const pinnedSet = useMemo(() => new Set(favourites), [favourites]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const searching = search.trim().length >= 2;
  const quickTab = !searching && (activeGroup === FAVOURITES_TAB || activeGroup === BEST_SELLERS_TAB);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const group = activeGroup === FAVOURITES_TAB || activeGroup === BEST_SELLERS_TAB ? "" : activeGroup;
    return products.filter((p) => {
      if (!searching && group && p.groupId !== group) return false;
      if (needle.length >= 2 && !p.name.toLowerCase().includes(needle) && !(p.barcode ?? "").includes(needle)) {
        return false;
      }
      return true;
    });
  }, [products, activeGroup, search, searching]);

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

  const card = (p: ProductRow, extra: { sold?: number; drag?: Parameters<typeof Card>[0]["drag"] } = {}) => (
    <Card
      key={p.id}
      product={p}
      shake={p.id === shakeProductId}
      onAdd={onAdd}
      pinned={pinnedSet.has(p.id)}
      onTogglePin={onTogglePin}
      {...extra}
    />
  );

  /* ------------------------------------------------------- the quick tabs */
  if (quickTab) {
    const favouritesTab = activeGroup === FAVOURITES_TAB;
    /* only what this till can sell: a pin on an archived product stays pinned
       for the shop, and simply is not offered here */
    const items = favouritesTab
      ? favourites.flatMap((id) => byId.get(id) ?? [])
      : bestSellers.flatMap((b) => {
          const p = byId.get(b.productId);
          return p ? [{ p, qty: b.qty }] : [];
        });

    const moveBefore = (moving: string, target: string) => {
      if (moving === target) return;
      const order = favourites.filter((id) => id !== moving);
      order.splice(order.indexOf(target), 0, moving);
      onReorder(order);
    };

    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-1.5 text-[11px] text-subtle">
          {favouritesTab
            ? items.length > 0
              ? t("sale.favouritesHint")
              : t("sale.favouritesEmpty")
            : items.length > 0
              ? t("sale.bestSellersHint", { days: String(bestSellerDays) })
              : t("sale.bestSellersEmpty", { days: String(bestSellerDays) })}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {favouritesTab
            ? (items as ProductRow[]).map((p) =>
                card(p, {
                  drag: {
                    over: dropOn === p.id && dragging !== p.id,
                    onDragStart: () => setDragging(p.id),
                    onDragOver: () => setDropOn(p.id),
                    onDrop: () => {
                      if (dragging) moveBefore(dragging, p.id);
                      setDragging(null);
                      setDropOn(null);
                    },
                    onDragEnd: () => {
                      setDragging(null);
                      setDropOn(null);
                    },
                  },
                }),
              )
            : (items as { p: ProductRow; qty: number }[]).map(({ p, qty }) => card(p, { sold: qty }))}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------- the groups */
  const sections = (activeGroup && !searching && activeGroup !== FAVOURITES_TAB && activeGroup !== BEST_SELLERS_TAB
    ? groups.filter((g) => g.id === activeGroup)
    : groups
  )
    .map((group) => ({ group, items: visible.filter((p) => p.groupId === group.id) }))
    .filter((s) => s.items.length > 0);
  const ungrouped = visible.filter((p) => !p.groupId);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {sections.map(({ group, items }) => (
        <div key={group.id} className="mb-4">
          <SectionLabel className="mb-1.5">
            {groupName(group)} <span className="font-normal text-subtle">({items.length})</span>
          </SectionLabel>
          <div className="grid grid-cols-4 gap-2">{items.map((p) => card(p))}</div>
        </div>
      ))}
      {ungrouped.length > 0 ? (
        <div className={cn("grid grid-cols-4 gap-2", sections.length > 0 && "mt-2")}>
          {ungrouped.map((p) => card(p))}
        </div>
      ) : null}
    </div>
  );
}
