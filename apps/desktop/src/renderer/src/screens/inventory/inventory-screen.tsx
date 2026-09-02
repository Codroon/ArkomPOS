/**
 * Inventario — handoff 03. Header: live total valuation (at cost), below-min
 * chip (click applies the filter) and the "+ Entrada de stock" button (F6);
 * stock table (display-only quantities, req 5.1); movimientos drawer on row
 * click (5.4); receiving happens in its own drawer (req 6).
 * One unfiltered fetch feeds header AND table; filters apply client-side via
 * core helpers at P1 catalog scale (the §4 server filters remain for Venta).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLowStock, type InventoryRow } from "@arkom/core";
import { cn, GhostButton, MoneyText, PrimaryButton, SearchInput, Toast, useT } from "@arkom/ui";
import { GroupOptions } from "../../components/group-picker";
import { openCatalogWithBarcode } from "../../lib/screen-bus";
import { EntradaDrawer } from "./entrada-drawer";
import { InventoryTable } from "./inventory-table";
import { MovementsDrawer } from "./movements-drawer";

interface Filters {
  groupId: string;
  itemType: "" | "stocked" | "serialized";
  lowStockOnly: boolean;
}

export function InventoryScreen() {
  const t = useT();
  const [allRows, setAllRows] = useState<InventoryRow[] | null>(null); // null = loading
  const [searchText, setSearchText] = useState("");
  const [filters, setFilters] = useState<Filters>({ groupId: "", itemType: "", lowStockOnly: false });
  const [drawerProduct, setDrawerProduct] = useState<InventoryRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [flashIds, setFlashIds] = useState<ReadonlySet<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setAllRows(await window.arkom.invoke("inventory:list"));
  }, []);

  useEffect(() => {
    refresh().catch((err) => console.error("inventory:list failed", err));
  }, [refresh]);

  // F6 opens receiving from anywhere on the screen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F6") {
        e.preventDefault();
        setEntryOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rows = useMemo(() => {
    if (!allRows) return [];
    const needle = searchText.trim().toLowerCase();
    return allRows.filter((r) => {
      if (needle.length >= 2 && !r.name.toLowerCase().includes(needle) && !(r.barcode ?? "").includes(needle)) {
        return false;
      }
      if (filters.groupId && r.groupId !== filters.groupId) return false;
      if (filters.itemType && r.itemType !== filters.itemType) return false;
      if (filters.lowStockOnly && !isLowStock(r)) return false;
      return true;
    });
  }, [allRows, searchText, filters]);

  const totalValuation = allRows ? allRows.reduce((a, r) => a + r.valuationCents, 0) : null;
  const belowMinCount = allRows ? allRows.filter((r) => isLowStock(r)).length : 0;

  const onConfirmed = useCallback(
    (productIds: string[], lineCount: number) => {
      refresh().catch((err) => console.error("inventory:list failed", err));
      setFlashIds(new Set(productIds)); // handoff 03: changed rows flash 600ms
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashIds(new Set()), 600);
      setToast(lineCount === 1 ? t("entry.toastOne") : t("entry.toastMany", { n: lineCount }));
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3000);
    },
    [refresh, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("inv.title")}</div>
        <div className="text-[11px] text-muted">
          {t("inv.valuation")}{" "}
          <span className="font-mono text-[12px] font-bold tabular-nums text-ink">
            {totalValuation === null ? t("common.dash") : <MoneyText cents={totalValuation} />}
          </span>{" "}
          {t("inv.valuationSuffix")}
        </div>
        <div className="flex-1" />
        {belowMinCount > 0 ? (
          <button
            type="button"
            onClick={() => setFilters((f) => ({ ...f, lowStockOnly: !f.lowStockOnly }))}
            className={cn(
              "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
              // the low-stock count wears the warning pair so it reads across the shop
              filters.lowStockOnly
                ? "border-warning-ink bg-warning-ink text-warning-bg"
                : "border-warning-ink/30 bg-warning-bg text-warning-ink hover:border-warning-ink/60",
            )}
          >
            {belowMinCount === 1 ? t("inv.belowMinOne") : t("inv.belowMinMany", { n: belowMinCount })}
          </button>
        ) : null}
        <SearchInput
          className="w-[240px]"
          placeholder={t("inv.searchPlaceholder")}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <PrimaryButton title={t("entry.openHint")} onClick={() => setEntryOpen(true)}>
          {t("entry.open")}
        </PrimaryButton>
      </div>

      {/* filters row */}
      <div className="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <select
          value={filters.groupId}
          onChange={(e) => setFilters((f) => ({ ...f, groupId: e.target.value }))}
          className="h-6 rounded-[3px] border border-line-strong bg-card px-1.5 text-[11px] text-ink-2 outline-none"
        >
          <GroupOptions allLabel={t("catalog.filter.groupAll")} />
                </select>
        <select
          value={filters.itemType}
          onChange={(e) => setFilters((f) => ({ ...f, itemType: e.target.value as Filters["itemType"] }))}
          className="h-6 rounded-[3px] border border-line-strong bg-card px-1.5 text-[11px] text-ink-2 outline-none"
        >
          <option value="">{t("catalog.filter.typeAll")}</option>
          <option value="stocked">{t("catalog.filter.stocked")}</option>
          <option value="serialized">{t("catalog.filter.serialized")}</option>
        </select>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, lowStockOnly: !f.lowStockOnly }))}
          className={cn(
            "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
            filters.lowStockOnly
              ? "border-ink bg-ink text-inverse-ink"
              : "border-line-strong bg-card text-ink-2 hover:border-muted",
          )}
        >
          {t("catalog.filter.lowStock")}
        </button>
        <div className="flex-1" />
        {rows.length === 0 && allRows !== null ? null : (
          <span className="text-[11px] text-muted">{t("catalog.count", { n: rows.length })}</span>
        )}
      </div>

      {/* table */}
      <div className="min-w-0 flex-1 overflow-auto bg-card">
        {allRows !== null && rows.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="text-[12px] text-muted">{t("catalog.noResults")}</div>
              <GhostButton
                className="mt-2"
                onClick={() => {
                  setFilters({ groupId: "", itemType: "", lowStockOnly: false });
                  setSearchText("");
                }}
              >
                {t("catalog.clearFilters")}
              </GhostButton>
            </div>
          </div>
        ) : (
          <InventoryTable rows={rows} loading={allRows === null} flashIds={flashIds} onSelect={setDrawerProduct} />
        )}
      </div>

      {entryOpen ? (
        <EntradaDrawer
          rows={allRows ?? []}
          onConfirmed={onConfirmed}
          onCreateArticle={(code) => {
            setEntryOpen(false);
            openCatalogWithBarcode(code);
          }}
          onClose={() => setEntryOpen(false)}
        />
      ) : null}

      {drawerProduct ? <MovementsDrawer product={drawerProduct} onClose={() => setDrawerProduct(null)} /> : null}
      <Toast message={toast} />
    </div>
  );
}
