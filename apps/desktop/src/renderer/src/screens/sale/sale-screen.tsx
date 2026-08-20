/**
 * Venta — handoff 01. Left: search band (ScanInput, ≥8-digit fast entry =
 * scan; direct IMEI adds that unit; miss → shake + Crear artículo), group
 * chips, product grid. Right (400px): ticket + payment. F2 focus scan · F4
 * cobrar · F8 aparcar. All money figures come from server SaleState; the
 * draft survives restarts via sale:current (power-cut behavior).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isValidImei,
  type CompletedSale,
  type EntityRef,
  type ProductRow,
  type SaleAddLineResponse,
  type SaleLineRow,
  type SaleState,
} from "@arkom/core";
import { cn, GhostButton, ScanInput, Toast, useT, type ScanInputHandle } from "@arkom/ui";
import { errorMessage, ipcOf } from "../../lib/errors";
import { openCatalogWithBarcode } from "../../lib/screen-bus";
import { ProductGrid } from "./product-grid";
import { TicketPanel } from "./ticket-panel";
import { CompletedPanel, PaymentPanel, parseTenders, type TenderEntry } from "./payment-panel";
import { OverrideModal, ParkModal, ParkedPopover, UnitPickModal, type UnitPickState } from "./sale-modals";

export function SaleScreen({ terminalName }: { terminalName: string }) {
  const t = useT();
  const scanRef = useRef<ScanInputHandle>(null);

  const [sale, setSale] = useState<SaleState | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [groups, setGroups] = useState<EntityRef[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [searchText, setSearchText] = useState("");
  const [noMatch, setNoMatch] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const [unitPick, setUnitPick] = useState<UnitPickState | null>(null);
  const [overrideLine, setOverrideLine] = useState<SaleLineRow | null>(null);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkedList, setParkedList] = useState<{ docId: string; label: string; lineCount: number; totalCents: number }[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [tenders, setTenders] = useState<TenderEntry[]>([]);
  const [charging, setCharging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshParked = useCallback(() => {
    window.arkom
      .invoke("sale:listParked")
      .then(setParkedList)
      .catch((err) => console.error("sale:listParked failed", err));
  }, []);

  const refreshProducts = useCallback(() => {
    window.arkom
      .invoke("catalog:list")
      // sellable only: active with price + tax (incomplete/inactive can't be sold)
      .then((rows) => setProducts(rows.filter((r) => r.active && r.priceCents != null && r.taxRegime != null)))
      .catch((err) => console.error("catalog:list failed", err));
  }, []);

  // boot: restore the terminal's live draft (power-cut behavior) + catalog + parked
  useEffect(() => {
    refreshProducts();
    window.arkom.invoke("catalog:groups").then(setGroups).catch((err) => console.error(err));
    window.arkom
      .invoke("sale:current")
      .then(setSale)
      .catch((err) => console.error("sale:current failed", err));
    refreshParked();
  }, [refreshProducts, refreshParked]);

  const applyState = useCallback((next: SaleState, flashNewest = false) => {
    setSale((prev) => {
      if (flashNewest && next.lines.length > (prev?.lines.length ?? 0)) {
        const newest = next.lines[next.lines.length - 1]!;
        setFlashLineId(newest.id);
        setTimeout(() => setFlashLineId(null), 600);
      }
      return next;
    });
  }, []);

  const handleAddResponse = useCallback(
    (res: SaleAddLineResponse) => {
      if (res.kind === "state") applyState(res.state, true);
      else setUnitPick(res);
    },
    [applyState],
  );

  const onScan = useCallback(
    (code: string) => {
      setNoMatch(null);
      setSearchText("");
      window.arkom
        .invoke("sale:addLine", { docId: sale?.docId ?? null, barcode: code })
        .then(handleAddResponse)
        .catch((err) => {
          const ipc = ipcOf(err);
          if (ipc?.code === "VALIDATION" && ipc.field === "barcode") {
            setNoMatch(code);
            setShake(true);
            setTimeout(() => setShake(false), 350);
          } else {
            showToast(errorMessage(t, err));
          }
        });
    },
    [sale, handleAddResponse, showToast, t],
  );

  const onAddProduct = useCallback(
    (product: ProductRow) => {
      setNoMatch(null);
      window.arkom
        .invoke("sale:addLine", { docId: sale?.docId ?? null, productId: product.id })
        .then(handleAddResponse)
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, handleAddResponse, showToast, t],
  );

  const onPickUnit = useCallback(
    (unitId: string) => {
      setUnitPick(null);
      window.arkom
        .invoke("sale:addLine", { docId: sale?.docId ?? null, unitId })
        .then(handleAddResponse)
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, handleAddResponse, showToast, t],
  );

  const onSetQty = useCallback(
    (line: SaleLineRow, qty: number) => {
      if (!sale || qty < 1) return;
      window.arkom
        .invoke("sale:setQty", { docId: sale.docId, lineId: line.id, qty })
        .then((s) => applyState(s))
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, applyState, showToast, t],
  );

  const onRemove = useCallback(
    (line: SaleLineRow) => {
      if (!sale) return;
      window.arkom
        .invoke("sale:removeLine", { docId: sale.docId, lineId: line.id })
        .then((s) => applyState(s))
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, applyState, showToast, t],
  );

  const onOverrideApply = useCallback(
    (newPriceCents: number, reason: string) => {
      if (!sale || !overrideLine) return;
      window.arkom
        .invoke("sale:overridePrice", { docId: sale.docId, lineId: overrideLine.id, newPriceCents, reason })
        .then((s) => {
          setOverrideLine(null);
          applyState(s);
        })
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, overrideLine, applyState, showToast, t],
  );

  const resetForNewSale = useCallback(() => {
    setCompleted(null);
    setSale(null);
    setTenders([]);
    setNoMatch(null);
    scanRef.current?.focus();
  }, []);

  const onCharge = useCallback(() => {
    if (!sale || charging) return;
    const parsed = parseTenders(tenders);
    if (!parsed) return;
    setCharging(true);
    window.arkom
      .invoke("sale:complete", { docId: sale.docId, tenders: parsed })
      .then((done) => {
        setCompleted(done);
        setSale(null);
        setTenders([]);
        refreshProducts();
      })
      .catch((err) => {
        showToast(errorMessage(t, err));
        setShake(true); // failure: sale stays open, ticket flashes
        setTimeout(() => setShake(false), 350);
      })
      .finally(() => setCharging(false));
  }, [sale, charging, tenders, refreshProducts, showToast, t]);

  const onPark = useCallback(
    (label: string) => {
      if (!sale) return;
      window.arkom
        .invoke("sale:park", { docId: sale.docId, label: label || null })
        .then(() => {
          setParkOpen(false);
          setSale(null);
          setTenders([]);
          refreshParked();
          scanRef.current?.focus();
        })
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, refreshParked, showToast, t],
  );

  const onResume = useCallback(
    (docId: string) => {
      window.arkom
        .invoke("sale:resume", { docId })
        .then((s) => {
          setParkedOpen(false);
          setSale(s);
          setTenders([]);
          refreshParked();
        })
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [refreshParked, showToast, t],
  );

  // keyboard: F2 buscar · F4 cobrar · F8 aparcar · Enter on completed = new sale
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        scanRef.current?.focus();
      } else if (e.key === "F4") {
        e.preventDefault();
        onCharge();
      } else if (e.key === "F8") {
        e.preventDefault();
        if (sale && sale.lines.length > 0) setParkOpen(true);
      } else if (e.key === "Enter" && completed) {
        resetForNewSale();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCharge, sale, completed, resetForNewSale]);

  // completed state auto-advances to a new sale after 4s (handoff 01)
  useEffect(() => {
    if (!completed) return;
    const timer = setTimeout(resetForNewSale, 4000);
    return () => clearTimeout(timer);
  }, [completed, resetForNewSale]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* header strip */}
      <div className="flex flex-none items-center gap-3 border-b border-border-strong bg-panel px-4 py-2.5">
        <div className="text-[15px] font-bold">
          {t("nav.venta")} — {terminalName}
        </div>
        <div className="text-[11px] text-muted">
          {completed ? (
            <span className="font-mono font-bold tabular-nums text-ink">{completed.docNumber}</span>
          ) : (
            t("sale.draftState")
          )}
        </div>
        <div className="flex-1" />
        {parkedList.length > 0 ? (
          <button
            type="button"
            onClick={() => setParkedOpen((o) => !o)}
            className="h-6 rounded-[3px] border border-border-input bg-card px-2 text-[11px] font-bold text-ink-2 hover:border-ink-3"
          >
            {t("park.chip", { n: parkedList.length })}
          </button>
        ) : null}
        <div className="font-mono text-[10px] text-faint">{t("sale.kbdHints")}</div>
      </div>
      {parkedOpen ? <ParkedPopover parked={parkedList} onResume={onResume} onClose={() => setParkedOpen(false)} /> : null}

      <div className="flex min-h-0 flex-1">
        {/* left: find products */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("flex-none border-b border-border bg-panel-2 px-4 py-2", shake && "arkom-shake")}>
            <ScanInput
              ref={scanRef}
              autoFocus
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setNoMatch(null);
              }}
              onScan={onScan}
              placeholder={t("catalog.searchPlaceholder")}
            />
            {noMatch ? (
              <div className="mt-1 text-[11px] text-ink-2">
                {t("sale.noMatch", { code: noMatch })}
                {/^\d{8,}$/.test(noMatch) && !isValidImei(noMatch) ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="font-bold underline hover:text-ink"
                      onClick={() => openCatalogWithBarcode(noMatch)}
                    >
                      {t("entry.createArticle")}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* group chips */}
          <div className="flex flex-none flex-wrap gap-1.5 border-b border-border bg-panel-2 px-4 py-2">
            <button
              type="button"
              onClick={() => setActiveGroup("")}
              className={cn(
                "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
                activeGroup === ""
                  ? "border-ink-2 bg-ink-2 text-white"
                  : "border-border-input bg-card text-ink-2 hover:border-ink-3",
              )}
            >
              {t("sale.groupAll")}
            </button>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveGroup(group.id)}
                className={cn(
                  "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
                  activeGroup === group.id
                    ? "border-ink-2 bg-ink-2 text-white"
                    : "border-border-input bg-card text-ink-2 hover:border-ink-3",
                )}
              >
                {group.name}
              </button>
            ))}
          </div>

          <ProductGrid products={products} groups={groups} activeGroup={activeGroup} search={searchText} onAdd={onAddProduct} />
        </div>

        {/* right: ticket + payment (400px fixed) */}
        <aside className="flex w-[400px] flex-none flex-col border-l border-border-strong bg-panel">
          {completed ? (
            <CompletedPanel completed={completed} onNew={resetForNewSale} />
          ) : (
            <>
              <TicketPanel
                sale={sale}
                flashLineId={flashLineId}
                shake={shake}
                onSetQty={onSetQty}
                onOverride={setOverrideLine}
                onRemove={onRemove}
              />
              <div className="flex-none border-t border-border bg-panel px-3 pt-2">
                <GhostButton
                  className="h-7 w-full"
                  disabled={!sale || sale.lines.length === 0}
                  onClick={() => setParkOpen(true)}
                >
                  {t("park.button")}
                </GhostButton>
              </div>
              <PaymentPanel sale={sale} entries={tenders} charging={charging} onChange={setTenders} onCharge={onCharge} />
            </>
          )}
        </aside>
      </div>

      {unitPick ? <UnitPickModal pick={unitPick} onPick={onPickUnit} onClose={() => setUnitPick(null)} /> : null}
      {overrideLine ? (
        <OverrideModal line={overrideLine} onApply={onOverrideApply} onClose={() => setOverrideLine(null)} />
      ) : null}
      {parkOpen ? <ParkModal onPark={onPark} onClose={() => setParkOpen(false)} /> : null}
      <Toast message={toast} />
    </div>
  );
}
