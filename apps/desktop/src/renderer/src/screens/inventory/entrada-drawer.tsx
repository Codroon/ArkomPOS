/**
 * Entrada de stock — a focused right drawer (handoff 03), opened from the
 * Inventario header or F6. Receiving is a task you sit down to do, so it gets
 * the whole panel instead of a strip squeezed under the table: one column,
 * top to bottom — find the item, say how many, what it cost, from whom, add it
 * to the list, repeat, confirm once.
 *
 * Esc closes (unless the scan picker/rescue is up), focus is trapped inside,
 * and after Confirmar the drawer clears but STAYS OPEN for the next box.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  centsToInput,
  formatCents,
  isValidImei,
  parseIpcError,
  parseMoneyInput,
  uuidv7,
  type EntityRef,
  type InventoryRow,
  type ScanProduct,
  type StockAddEntry,
} from "@arkom/core";
import {
  Chip,
  cn,
  Field,
  GhostButton,
  PrimaryButton,
  ScanInput,
  SectionLabel,
  SelectInput,
  TextInput,
  useDataLabel,
  useT,
  type ScanInputHandle,
  type TKey,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { useScanFlow } from "../../lib/use-scan-flow";

interface StagedLine {
  key: string;
  productId: string;
  name: string;
  code: string | null;
  qty: number;
  unitCostCents: number;
  imeis: string[];
}

type LineErrors = Partial<Record<"cost" | "qty" | "imei", TKey>>;

export function EntradaDrawer({
  rows,
  onConfirmed,
  onCreateArticle,
  onClose,
}: {
  rows: InventoryRow[];
  onConfirmed: (productIds: string[], lineCount: number) => void;
  onCreateArticle: (barcode: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const drawerRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<ScanInputHandle>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const imeiRef = useRef<HTMLInputElement>(null);

  const [scanText, setScanText] = useState("");
  const [product, setProduct] = useState<ScanProduct | null>(null);
  const [costInput, setCostInput] = useState("");
  const [qtyInput, setQtyInput] = useState("1");
  const [imeiInput, setImeiInput] = useState("");
  const [imeis, setImeis] = useState<string[]>([]);
  const [lineErrors, setLineErrors] = useState<LineErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  const [staged, setStaged] = useState<StagedLine[]>([]);
  const [suppliers, setSuppliers] = useState<EntityRef[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierMode, setNewSupplierMode] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    window.arkom
      .invoke("supplier:list")
      .then(setSuppliers)
      .catch((err) => console.error("supplier:list failed", err));
    setTimeout(() => scanRef.current?.focus(), 0);
  }, []);

  const serialized = product?.itemType === "serialized";
  const qty = /^\d+$/.test(qtyInput.trim()) ? Number(qtyInput.trim()) : 0;
  const knownRow = product ? rows.find((r) => r.productId === product.productId) : undefined;

  const selectProduct = useCallback(
    (next: ScanProduct) => {
      setProduct(next);
      setScanText("");
      setNotice(null);
      setLineErrors({});
      setImeis([]);
      setImeiInput("");
      setQtyInput("1");
      const known = rows.find((r) => r.productId === next.productId);
      setCostInput(known?.costCents == null ? "" : centsToInput(known.costCents)); // last cost
      setTimeout(() => qtyRef.current?.select(), 0); // quantity first
    },
    [rows],
  );

  const { resolve, modals, isModalOpen } = useScanFlow({
    onProduct: selectProduct,
    onUnit: () => setNotice(t("err.duplicateImei")), // that IMEI is already in stock
    onCreateProduct: onCreateArticle,
    onError: (message) => setNotice(message),
    onAttached: (p, code) => setNotice(t("unknown.attached", { code, name: p.name })),
  });

  /* Esc closes the drawer — but never while a picker/rescue owns the screen. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isModalOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isModalOpen]);

  /* focus trap: Tab cycles inside the drawer */
  const onTrapKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !drawerRef.current) return;
    const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /** Typing a name (not a long code) filters the catalog inline. */
  const searchMatches = useMemo(() => {
    const needle = scanText.trim().toLowerCase();
    if (needle.length < 2 || /^\d{6,}$/.test(needle)) return [];
    return rows
      .filter((r) => r.active && (r.name.toLowerCase().includes(needle) || (r.barcode ?? "").includes(needle)))
      .slice(0, 6);
  }, [scanText, rows]);

  const toScanProduct = (row: InventoryRow): ScanProduct => ({
    productId: row.productId,
    name: row.name,
    itemType: row.itemType,
    priceCents: null,
    onHand: row.onHand,
    active: row.active,
  });

  const rejectImei = (key: TKey) => {
    setLineErrors({ imei: key });
    setTimeout(() => imeiRef.current?.select(), 0);
  };

  const captureImei = async () => {
    const imei = imeiInput.trim();
    if (!isValidImei(imei)) {
      rejectImei("val.imeiInvalid");
      return;
    }
    if (imeis.includes(imei) || staged.some((l) => l.imeis.includes(imei))) {
      rejectImei("val.imeiDupStaged");
      return;
    }
    try {
      const known = await window.arkom.invoke("scan:resolve", { code: imei });
      if (known.kind === "unit" || (known.kind === "none" && known.unavailableUnit)) {
        rejectImei("val.imeiRegistered");
        return;
      }
    } catch (err) {
      console.error("scan:resolve failed", err);
    }
    setLineErrors({});
    setImeis((prev) => [...prev, imei]);
    setImeiInput("");
    setTimeout(() => imeiRef.current?.focus(), 0);
  };

  const stageLine = () => {
    if (!product) return;
    const errors: LineErrors = {};
    const cost = parseMoneyInput(costInput);
    if (cost === null) errors.cost = costInput.trim() === "" ? "val.costRequired" : "val.invalidAmount";
    if (qty < 1) errors.qty = "val.qtyMin1";
    if (serialized && imeis.length !== qty) errors.imei = "val.imeiCountMismatch";
    setLineErrors(errors);
    if (Object.keys(errors).length > 0 || cost === null) return;

    setStaged((prev) => [
      ...prev,
      {
        key: uuidv7(),
        productId: product.productId,
        name: product.name,
        code: knownRow?.barcode ?? null,
        qty,
        unitCostCents: cost,
        imeis: serialized ? imeis : [],
      },
    ]);
    setConfirmError(null);
    setProduct(null);
    setCostInput("");
    setQtyInput("1");
    setImeis([]);
    setImeiInput("");
    scanRef.current?.focus(); // straight back to scanning the next box
  };

  const createSupplier = () => {
    const name = newSupplierName.trim();
    if (!name) return;
    setSupplierError(null);
    window.arkom
      .invoke("supplier:create", { name })
      .then((created) => {
        setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "es")));
        setSupplierId(created.id);
        setNewSupplierMode(false);
        setNewSupplierName("");
      })
      .catch((err) => {
        const ipc = parseIpcError(err);
        setSupplierError(ipc ? (ipc.code === "DUPLICATE_NAME" ? t("err.duplicateName") : ipc.message) : String(err));
      });
  };

  const totalCents = staged.reduce((a, l) => a + l.qty * l.unitCostCents, 0);
  const canStage =
    product !== null && qty >= 1 && parseMoneyInput(costInput) !== null && (!serialized || imeis.length === qty);
  const canConfirm = staged.length > 0 && supplierId !== "" && !submitting && product === null;

  const confirm = () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setConfirmError(null);
    const entries: StockAddEntry[] = staged.map((l) =>
      l.imeis.length > 0
        ? { productId: l.productId, expectedQty: l.qty, imeis: l.imeis, unitCostCents: l.unitCostCents, supplierId }
        : { productId: l.productId, qty: l.qty, unitCostCents: l.unitCostCents, supplierId },
    );
    window.arkom
      .invoke("stock:add", { entries })
      .then((res) => {
        setStaged([]);
        setProduct(null);
        setCostInput("");
        setQtyInput("1");
        setImeis([]);
        setImeiInput("");
        onConfirmed(res.productIds, res.lineCount);
        scanRef.current?.focus(); // stays open for the next delivery
      })
      .catch((err) => setConfirmError(errorMessage(t, err)))
      .finally(() => setSubmitting(false));
  };

  const lineErr = (k: keyof LineErrors) => (lineErrors[k] ? t(lineErrors[k]!) : undefined);
  const disabled = product === null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/10" onMouseDown={onClose}>
      <div
        ref={drawerRef}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onTrapKeyDown}
        className={cn(
          "flex h-full w-[480px] flex-col border-l border-line-strong bg-surface shadow-lg",
          submitting && "pointer-events-none opacity-70",
        )}
      >
        {/* header */}
        <div className="flex flex-none items-center gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">{t("entry.section")}</div>
          <div className="flex-1" />
          <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* body */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
          {/* 1 · find the item */}
          <div className="relative">
            <Field label={t("entry.scanLabel")} required>
              <ScanInput
                ref={scanRef}
                autoFocus
                value={scanText}
                onChange={(e) => setScanText(e.target.value)}
                onScan={resolve}
                placeholder={t("entry.searchOrScan")}
              />
            </Field>
            {!product && searchMatches.length > 0 ? (
              <div className="absolute top-[52px] z-20 w-full overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-md">
                {searchMatches.map((row) => (
                  <button
                    key={row.productId}
                    type="button"
                    onClick={() => selectProduct(toScanProduct(row))}
                    className="flex w-full items-center gap-2 border-b border-line px-2 py-1.5 text-left last:border-b-0 hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px]">{row.name}</span>
                    {row.itemType === "serialized" ? <Chip>{t("chip.serie")}</Chip> : null}
                    <span className="font-mono text-[10px] tabular-nums text-subtle">{row.onHand}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* 2 · the resolved item */}
          {product ? (
            <div className="rounded-[3px] border border-line bg-card px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-bold">
                    {product.name}
                    {serialized ? <Chip className="ml-1.5">{t("chip.serie")}</Chip> : null}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-subtle">
                    {knownRow?.barcode ?? t("common.dash")} · {t("entry.currentStock", { n: product.onHand })}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[10px] text-muted underline hover:text-ink"
                  onClick={() => {
                    setProduct(null);
                    setImeis([]);
                    scanRef.current?.focus();
                  }}
                >
                  {t("entry.changeProduct")}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-[3px] border border-dashed border-line px-3 py-4 text-center text-[11px] text-subtle">
              {t("entry.idleHint")}
            </div>
          )}
          {notice ? <div className="text-[11px] text-ink-2">{notice}</div> : null}

          {/* 3 · quantity, then cost */}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("entry.qty")} required error={lineErr("qty")}>
              <TextInput
                ref={qtyRef}
                mono
                requiredStyle
                inputMode="numeric"
                disabled={disabled}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && serialized) {
                    e.preventDefault();
                    imeiRef.current?.focus();
                  }
                }}
              />
            </Field>
            <Field
              label={t("entry.unitCost")}
              required
              error={lineErr("cost")}
              hint={!disabled && knownRow?.costCents != null ? t("entry.lastCostHint") : null}
            >
              <TextInput
                mono
                requiredStyle
                disabled={disabled}
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                placeholder={t("editor.moneyPlaceholder")}
              />
            </Field>
          </div>

          {/* 3b · serialized: the quantity is the IMEI target */}
          {serialized ? (
            <div className="rounded-[3px] border border-line bg-card px-3 py-2">
              <Field
                label={t("entry.imeiLoop", { n: Math.min(imeis.length + 1, qty), total: qty })}
                required
                error={lineErr("imei")}
              >
                <TextInput
                  ref={imeiRef}
                  mono
                  requiredStyle
                  disabled={disabled || imeis.length >= qty}
                  value={imeiInput}
                  onChange={(e) => setImeiInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void captureImei();
                    }
                  }}
                  placeholder={t("entry.imeiPlaceholder")}
                  maxLength={15}
                />
              </Field>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {imeis.map((imei) => (
                  <span
                    key={imei}
                    className="inline-flex items-center gap-1 rounded-[2px] border border-line bg-surface-2 px-1 py-px font-mono text-[10px] tabular-nums"
                  >
                    {imei}
                    <button
                      type="button"
                      className="text-muted hover:text-ink"
                      onClick={() => setImeis((prev) => prev.filter((x) => x !== imei))}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-1 text-[10px] text-subtle">
                {imeis.length === qty
                  ? t("entry.imeiCaptured", { n: imeis.length, total: qty })
                  : t("entry.imeiPending", { n: Math.max(0, qty - imeis.length) })}
              </div>
            </div>
          ) : null}

          {/* 4 · supplier */}
          <Field label={t("entry.supplier")} required error={supplierError}>
            {newSupplierMode ? (
              <div className="flex gap-1.5">
                <TextInput
                  requiredStyle
                  autoFocus
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createSupplier();
                    }
                  }}
                  placeholder={t("entry.newSupplierPlaceholder")}
                />
                <GhostButton onClick={createSupplier}>{t("common.save")}</GhostButton>
              </div>
            ) : (
              <SelectInput requiredStyle value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">{t("entry.supplierPlaceholder")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {dataLabel(s.name)}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <button
            type="button"
            className="-mt-2 self-start text-[10px] text-muted underline hover:text-ink"
            onClick={() => {
              setNewSupplierMode((m) => !m);
              setSupplierError(null);
            }}
          >
            {newSupplierMode ? t("common.cancel") : t("entry.newSupplier")}
          </button>

          {/* 5 · add to the list */}
          <GhostButton className="h-8 w-full" disabled={!canStage} onClick={stageLine}>
            {t("entry.addToList")}
          </GhostButton>

          {/* 6 · staged lines, with room to breathe */}
          <div className="min-h-[120px] flex-1 rounded-[3px] border border-line bg-card p-1">
            {staged.length === 0 ? (
              <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-subtle">
                {t("entry.stagedEmpty")}
              </div>
            ) : (
              staged.map((l) => (
                <div key={l.key} className="flex items-start gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px]">{l.name}</div>
                    <div className="font-mono text-[10px] tabular-nums text-subtle">
                      {l.imeis.length > 0 ? t("entry.stagedUnits", { n: l.imeis.length }) : l.code ?? ""}
                    </div>
                  </div>
                  <div className="whitespace-nowrap font-mono text-[11px] tabular-nums">
                    {l.qty} × {formatCents(l.unitCostCents)}
                  </div>
                  <button
                    type="button"
                    aria-label={t("entry.removeLine")}
                    className="text-[11px] text-muted hover:text-ink"
                    onClick={() => setStaged((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex-none border-t border-line-strong bg-surface-2 px-4 py-3">
          {confirmError ? <div className="mb-2 text-[11px] text-ink-2">{confirmError}</div> : null}
          <div className="mb-2 flex items-baseline justify-between">
            <SectionLabel>{t("entry.stagedTotal")}</SectionLabel>
            <span className="font-mono text-[14px] font-bold tabular-nums">{formatCents(totalCents)}</span>
          </div>
          <PrimaryButton className="h-9 w-full text-[13px]" onClick={confirm} disabled={!canConfirm}>
            {submitting ? t("common.saving") : t("entry.confirm")}
          </PrimaryButton>
        </div>
      </div>

      {modals}
    </div>
  );
}
