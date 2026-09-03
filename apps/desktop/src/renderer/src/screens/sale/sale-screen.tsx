/**
 * Venta — handoff 01. Left: search band (ScanInput, ≥8-digit fast entry =
 * scan; direct IMEI adds that unit; miss → shake + Crear artículo), group
 * chips, product grid. Right (400px): ticket + payment. F2 focus scan · F4
 * cobrar · F8 aparcar. All money figures come from server SaleState; the
 * draft survives restarts via sale:current (power-cut behavior).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseIpcError,
  availableForSale,
  type CompletedSale,
  type ProductRow,
  type SaleAddLineResponse,
  type SaleLineRow,
  type SaleState,
  centsToInput,
  formatCents,
  uuidv7,
} from "@arkom/core";
import { cn, GhostButton, ScanInput, Toast, useDataLabel, useT, type ScanInputHandle } from "@arkom/ui";
import { TicketPeekModal } from "../../components/ticket-peek-modal";
import { useCan } from "../../lib/use-session";
import { FindTicketDialog } from "./find-ticket-dialog";
import { useGroupName, useGroups } from "../../components/group-picker";
import { errorMessage } from "../../lib/errors";
import { PrinterRequiredNotice, usePrinterReady } from "../../lib/printer-ready";
import { refreshShift } from "../../lib/use-shift";
import { OpenShiftDialog } from "../cash/open-shift-dialog";
import { consumePendingVoucher, openCatalogWithBarcode } from "../../lib/screen-bus";
import { useScanFlow } from "../../lib/use-scan-flow";
import { ProductGrid } from "./product-grid";
import { TicketPanel } from "./ticket-panel";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { PrintToast } from "../../lib/print-toast";
import { useApprovalFlow } from "../../lib/use-approval";
import { CompletedPanel, PaymentPanel, parseTenders, type TenderEntry } from "./payment-panel";
import { VoucherFinder } from "./voucher-finder";
import { OverrideModal, ParkModal, ParkedPopover, UnitPickModal, type UnitPickState } from "./sale-modals";

export function SaleScreen({ terminalName }: { terminalName: string }) {
  const t = useT();
  const groups = useGroups();
  const dataLabel = useDataLabel();
  const groupName = useGroupName();
  const scanRef = useRef<ScanInputHandle>(null);
  const [peekDocId, setPeekDocId] = useState<string | null>(null);
  const can = useCan();
  const [finding, setFinding] = useState(false);

  /**
   * Open any completed ticket, however old.
   *
   * Whatever comes back opens the ordinary document peek — which is where
   * Refund lives. There is no refund screen, because a refund is a thing you do
   * to a ticket you are looking at (ADR-0019).
   */
  const openFound = (docId: string) => {
    setFinding(false);
    setPeekDocId(docId);
  };

  const [sale, setSale] = useState<SaleState | null>(null);
  const saleRef = useRef<SaleState | null>(null);
  saleRef.current = sale; // scan callbacks must see the live draft, not a stale closure
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [searchText, setSearchText] = useState("");
  const [noMatch, setNoMatch] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [shakeProductId, setShakeProductId] = useState<string | null>(null);
  const [flashLineId, setFlashLineId] = useState<string | null>(null);
  const [unitPick, setUnitPick] = useState<UnitPickState | null>(null);
  const [overrideLine, setOverrideLine] = useState<SaleLineRow | null>(null);
  const [parkOpen, setParkOpen] = useState(false);
  const [parkedList, setParkedList] = useState<{ docId: string; label: string; lineCount: number; totalCents: number }[]>([]);
  const [parkedOpen, setParkedOpen] = useState(false);
  const [tenders, setTenders] = useState<TenderEntry[]>([]);
  const [charging, setCharging] = useState(false);
  /* the till has no open shift and the cashier pressed Cobrar (ADR-0015 §9) */
  const [needsShift, setNeedsShift] = useState(false);
  const [voucherFinderOpen, setVoucherFinderOpen] = useState(false);

  /* A voucher handed over by "Continuar a la venta" lands as a tender chip the
     moment this screen mounts, so the customer's credit is already applied
     when the cashier starts scanning. */
  useEffect(() => {
    const pending = consumePendingVoucher();
    if (!pending) return;
    setTenders((prev) => [
      ...prev.filter((entry) => entry.voucherId !== pending.id),
      {
        key: uuidv7(),
        method: "store_credit" as const,
        amountInput: centsToInput(pending.amountCents),
        cardReference: "",
        voucherId: pending.id,
        voucherLabel: pending.docNumber,
      },
    ]);
  }, []);
  const [toast, setToast] = useState<{ text: string; tone: "neutral" | "danger" } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const printer = useTicketPrint();
  const printerReady = usePrinterReady();
  const approval = useApprovalFlow();

  const showToast = useCallback((message: string, tone: "neutral" | "danger" = "danger") => {
    setToast({ text: message, tone });
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
      .invoke("catalog:list", { includeUsed: true })
      // sellable only: active with price + tax (incomplete/inactive can't be sold)
      .then((rows) => setProducts(rows.filter((r) => r.active && r.priceCents != null && r.taxRegime != null)))
      .catch((err) => console.error("catalog:list failed", err));
  }, []);

  // boot: restore the terminal's live draft (power-cut behavior) + catalog + parked
  useEffect(() => {
    refreshProducts();
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

  const productsRef = useRef<ProductRow[]>([]);
  productsRef.current = products;

  /** Refuse an oversell before it is typed (req 2.x fail-fast); serialized
   *  products are already gated by unit availability in the picker. */
  const refuse = useCallback(
    (product: ProductRow, message: string) => {
      showToast(message);
      setShakeProductId(product.id);
      setTimeout(() => setShakeProductId(null), 400);
      setShake(true);
      setTimeout(() => setShake(false), 350);
    },
    [showToast],
  );

  const addByProduct = useCallback(
    (productId: string) => {
      const row = productsRef.current.find((p) => p.id === productId);
      if (row && row.itemType !== "serialized") {
        const available = availableForSale(productId, row.onHand, saleRef.current);
        if (available <= 0) {
          refuse(row, t(row.onHand <= 0 ? "sale.outOfStock" : "sale.onlyNLeft", { n: row.onHand, name: row.name }));
          return;
        }
      }
      window.arkom
        .invoke("sale:addLine", { docId: saleRef.current?.docId ?? null, productId })
        .then(handleAddResponse) // a serialized product answers with its unit list
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [handleAddResponse, showToast, refuse, t],
  );

  const addByUnit = useCallback(
    (unitId: string) => {
      window.arkom
        .invoke("sale:addLine", { docId: saleRef.current?.docId ?? null, unitId })
        .then(handleAddResponse)
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [handleAddResponse, showToast, t],
  );

  // every scan goes through the shared pipeline: instant when unambiguous,
  // picker when one code means several things, rescue when it means nothing
  const { resolve, modals: scanModals } = useScanFlow({
    onProduct: (product) => {
      setNoMatch(null);
      setSearchText("");
      addByProduct(product.productId);
    },
    onUnit: (unit) => {
      setNoMatch(null);
      setSearchText("");
      addByUnit(unit.unitId);
    },
    onCreateProduct: (code) => openCatalogWithBarcode(code),
    onError: (message) => showToast(message),
    onAttached: (product, code) => showToast(t("unknown.attached", { code, name: product.name }), "neutral"),
    onUnknown: (code) => {
      setNoMatch(code);
      setShake(true);
      setTimeout(() => setShake(false), 350);
    },
  });

  const onScan = useCallback(
    (code: string) => {
      setNoMatch(null);
      resolve(code);
    },
    [resolve],
  );

  const onAddProduct = useCallback(
    (product: ProductRow) => {
      setNoMatch(null);
      addByProduct(product.id);
    },
    [addByProduct],
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
      // cap at what the shelf can still give this line (other lines of the same
      // product already claim their share)
      const row = line.productId ? products.find((p) => p.id === line.productId) : undefined;
      let next = qty;
      if (row && line.productId) {
        const claimedElsewhere = sale.lines
          .filter((l) => l.id !== line.id && l.productId === line.productId)
          .reduce((n, l) => n + l.qty, 0);
        const maxForLine = Math.max(0, row.onHand - claimedElsewhere);
        if (qty > maxForLine) {
          showToast(t("sale.onlyNLeft", { n: maxForLine, name: row.name }));
          next = maxForLine;
          if (next === line.qty || next < 1) return; // nothing left to give
        }
      }
      window.arkom
        .invoke("sale:setQty", { docId: sale.docId, lineId: line.id, qty: next })
        .then((s) => applyState(s))
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, products, applyState, showToast, t],
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

  /**
   * A cashier lacks sale.price_override, so this raises APPROVAL_REQUIRED and
   * the flow collects an owner's PIN and retries the SAME call — the override
   * then lands with both ids on its audit entry. An owner never sees a keypad.
   */
  const onOverrideApply = useCallback(
    (newPriceCents: number, reason: string) => {
      if (!sale || !overrideLine) return;
      const line = overrideLine;
      void approval
        .run(
          (auth) =>
            window.arkom.invoke(
              "sale:overridePrice",
              { docId: sale.docId, lineId: line.id, newPriceCents, reason },
              auth,
            ),
          "sale.price_override",
          {
            title: t("apr.priceOverride"),
            details: [
              { label: t("sale.ticket"), value: line.description },
              {
                label: t("ovr.newPrice"),
                value: `${formatCents(line.unitPriceCents)} → ${formatCents(newPriceCents)}`,
                mono: true,
              },
              { label: t("apr.reason"), value: reason },
            ],
          },
        )
        .then((s) => {
          setOverrideLine(null);
          applyState(s);
        })
        .catch((err) => showToast(errorMessage(t, err)));
    },
    [sale, overrideLine, applyState, showToast, t, approval],
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
        /* Not an error the cashier can do anything about by reading it: there
           is no shift open, and the fix is ten seconds away. Offer it here
           rather than sending them to another screen with a customer waiting
           (ADR-0015 §9). */
        if (parseIpcError(err)?.code === "SHIFT_REQUIRED") {
          setNeedsShift(true);
          return;
        }
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

  /* Auto-print, exactly once per completed sale (PRD 2.9). Guarded by docId
     rather than a boolean: the completed panel re-renders, and a customer must
     not collect two tickets because React ran an effect twice. A failure here
     lands in the sticky toast below — never in the sale, which is already
     closed and paid. */
  const autoPrinted = useRef<string | null>(null);
  useEffect(() => {
    if (!completed || autoPrinted.current === completed.docId) return;
    autoPrinted.current = completed.docId;
    printer.print(completed.docId, false, /* auto */ true);
  }, [completed, printer]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* the till cannot issue a ticket: said here, before a queue forms */}
      {printerReady ? null : <PrinterRequiredNotice />}

      {/* header strip */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
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
            className="h-6 rounded-[3px] border border-line-strong bg-card px-2 text-[11px] font-bold text-ink-2 hover:border-muted"
          >
            {t("park.chip", { n: parkedList.length })}
          </button>
        ) : null}
        <div className="font-mono font-medium text-[10px] text-subtle">{t("sale.kbdHints")}</div>
      </div>
      {parkedOpen ? <ParkedPopover parked={parkedList} onResume={onResume} onClose={() => setParkedOpen(false)} /> : null}
      {peekDocId ? <TicketPeekModal docId={peekDocId} onClose={() => setPeekDocId(null)} /> : null}
      {finding ? <FindTicketDialog onCancel={() => setFinding(false)} onFound={openFound} /> : null}

      <div className="flex min-h-0 flex-1">
        {/* left: find products */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn("flex-none border-b border-line bg-surface-2 px-4 py-2", shake && "arkom-shake")}>
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
            {/* the rescue modal carries both ways out; this is the trace it leaves behind */}
            {noMatch ? <div className="mt-1 text-[11px] text-ink-2">{t("sale.noMatch", { code: noMatch })}</div> : null}
          </div>

          {/* group chips */}
          <div className="flex flex-none flex-wrap gap-1.5 border-b border-line bg-surface-2 px-4 py-2">
            <button
              type="button"
              onClick={() => setActiveGroup("")}
              className={cn(
                "h-6 rounded-[3px] border px-2 text-[11px] font-bold",
                activeGroup === ""
                  ? "border-ink bg-ink text-inverse-ink"
                  : "border-line-strong bg-card text-ink-2 hover:border-muted",
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
                    ? "border-ink bg-ink text-inverse-ink"
                    : "border-line-strong bg-card text-ink-2 hover:border-muted",
                )}
              >
                {groupName(group)}
              </button>
            ))}
          </div>

          <ProductGrid
            products={products}
            groups={groups}
            activeGroup={activeGroup}
            search={searchText}
            shakeProductId={shakeProductId}
            onAdd={onAddProduct}
          />
        </div>

        {/* right: ticket + payment (400px fixed) */}
        <aside className="flex w-[400px] flex-none flex-col border-l border-line-strong bg-surface">
          {completed ? (
            <CompletedPanel
              completed={completed}
              onNew={resetForNewSale}
              printing={printer.state.busy}
              onPrint={() => printer.print(completed.docId, true)}
            />
          ) : (
            <>
              <TicketPanel
                onFindTicket={can("sale.refund") ? () => setFinding(true) : undefined}
                sale={sale}
                flashLineId={flashLineId}
                shake={shake}
                onSetQty={onSetQty}
                onOverride={setOverrideLine}
                onRemove={onRemove}
              />
              <div className="flex-none border-t border-line bg-surface px-3 pt-2">
                <GhostButton
                  className="h-7 w-full"
                  disabled={!sale || sale.lines.length === 0}
                  onClick={() => setParkOpen(true)}
                >
                  {t("park.button")}
                </GhostButton>
              </div>
              <PaymentPanel
                sale={sale}
                entries={tenders}
                charging={charging}
                onChange={setTenders}
                onCharge={onCharge}
                blocked={!printerReady}
                onFindVoucher={() => setVoucherFinderOpen(true)}
              />
            </>
          )}
        </aside>
      </div>

      {unitPick ? <UnitPickModal pick={unitPick} onPick={onPickUnit} onClose={() => setUnitPick(null)} /> : null}
      {overrideLine ? (
        <OverrideModal line={overrideLine} onApply={onOverrideApply} onClose={() => setOverrideLine(null)} />
      ) : null}
      {parkOpen ? <ParkModal onPark={onPark} onClose={() => setParkOpen(false)} /> : null}
      {voucherFinderOpen ? (
        <VoucherFinder
          saleTotalCents={sale?.totalCents ?? 0}
          onCancel={() => setVoucherFinderOpen(false)}
          onPick={(voucher, plan) => {
            /* the voucher's amount, not a number the cashier types: it redeems
               whole or not at all (ADR-0013 §4) */
            setTenders((prev) => [
              ...prev.filter((entry) => entry.voucherId !== voucher.id),
              {
                key: uuidv7(),
                method: "store_credit" as const,
                amountInput: centsToInput(plan.tenderCents),
                cardReference: "",
                voucherId: voucher.id,
                voucherLabel: voucher.docNumber,
              },
            ]);
            setVoucherFinderOpen(false);
          }}
        />
      ) : null}
      {needsShift ? (
        <OpenShiftDialog
          preamble={t("cash.openSaleHint")}
          onCancel={() => setNeedsShift(false)}
          onOpened={async () => {
            setNeedsShift(false);
            await refreshShift();
            /* the charge they already pressed now goes through. Making them
               press Cobrar again after solving the problem the app raised is
               the kind of small rudeness a till gets blamed for. */
            onCharge();
          }}
        />
      ) : null}
      {scanModals}
      <Toast message={toast?.text ?? null} tone={toast?.tone ?? "neutral"} />
      <PrintToast printer={printer} className={toast ? "bottom-16" : undefined} />
      {approval.modal}
    </div>
  );
}
