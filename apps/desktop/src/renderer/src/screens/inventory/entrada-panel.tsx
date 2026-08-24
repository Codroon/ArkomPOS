/**
 * Entrada de stock — handoff 03, rebuilt for discoverability.
 *
 * The whole shape is ALWAYS visible (find · quantity · cost · supplier ·
 * staged lines · Confirmar) with the fields disabled until an item resolves,
 * so nothing about the feature is hidden behind a successful scan. Finding is
 * scan-or-search through `scan:resolve` (primary code, additional codes, IMEI,
 * or a name search), with the ambiguity picker and the unknown-code rescue
 * wired in. Quantity comes first: for a serialized product the quantity IS the
 * IMEI target and an "IMEI n of N" capture loop appears — Confirmar stays
 * disabled until the captured IMEIs match the quantity.
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

export function EntradaPanel({
  rows,
  onConfirmed,
  onCreateArticle,
}: {
  rows: InventoryRow[];
  onConfirmed: (productIds: string[], lineCount: number) => void;
  onCreateArticle: (barcode: string) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
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
  }, []);

  const serialized = product?.itemType === "serialized";
  const qty = /^\d+$/.test(qtyInput.trim()) ? Number(qtyInput.trim()) : 0;

  const selectProduct = useCallback(
    (next: ScanProduct) => {
      setProduct(next);
      setScanText("");
      setNotice(null);
      setLineErrors({});
      setImeis([]);
      setImeiInput("");
      setQtyInput("1");
      // last cost prefill, from the row the inventory table already has
      const known = rows.find((r) => r.productId === next.productId);
      setCostInput(known?.costCents == null ? "" : centsToInput(known.costCents));
      setTimeout(() => qtyRef.current?.select(), 0); // quantity first
    },
    [rows],
  );

  const { resolve, modals } = useScanFlow({
    onProduct: selectProduct,
    onUnit: () => setNotice(t("err.duplicateImei")), // that IMEI is already in stock
    onCreateProduct: onCreateArticle,
    onError: (message) => setNotice(message),
    onAttached: (p, code) => setNotice(t("unknown.attached", { code, name: p.name })),
  });

  /** Typing a name (not a code) filters the catalog inline — search works too. */
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

  const captureImei = async () => {
    const imei = imeiInput.trim();
    if (!isValidImei(imei)) {
      setLineErrors({ imei: "val.imeiInvalid" });
      return;
    }
    if (imeis.includes(imei) || staged.some((l) => l.imeis.includes(imei))) {
      setLineErrors({ imei: "val.imeiDupStaged" });
      return;
    }
    // already in the database? the resolver knows — catch it here rather than
    // letting the whole entry fail at Confirmar
    try {
      const known = await window.arkom.invoke("scan:resolve", { code: imei });
      if (known.kind === "unit" || (known.kind === "none" && known.unavailableUnit)) {
        setLineErrors({ imei: "val.imeiRegistered" });
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
    if (serialized && imeis.length !== qty) errors.imei = "val.imeiInvalid";
    setLineErrors(errors);
    if (Object.keys(errors).length > 0 || cost === null) return;

    setStaged((prev) => [
      ...prev,
      {
        key: uuidv7(),
        productId: product.productId,
        name: product.name,
        code: rows.find((r) => r.productId === product.productId)?.barcode ?? null,
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
    scanRef.current?.focus();
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
  const canConfirm = staged.length > 0 && supplierId !== "" && !submitting;

  const confirm = () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setConfirmError(null);
    const entries: StockAddEntry[] = staged.map((l) =>
      l.imeis.length > 0
        ? {
            productId: l.productId,
            expectedQty: l.qty,
            imeis: l.imeis,
            unitCostCents: l.unitCostCents,
            supplierId,
          }
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
        scanRef.current?.focus();
      })
      .catch((err) => setConfirmError(errorMessage(t, err)))
      .finally(() => setSubmitting(false));
  };

  const lineErr = (k: keyof LineErrors) => (lineErrors[k] ? t(lineErrors[k]!) : undefined);
  const disabled = product === null;

  return (
    <div
      className={cn(
        "flex-none border-t border-border-strong bg-panel px-4 py-3",
        submitting && "pointer-events-none opacity-60",
      )}
    >
      <SectionLabel className="mb-2">{t("entry.section")}</SectionLabel>

      <div className="flex items-start gap-3">
        {/* find: scan OR search by name — always enabled */}
        <div className="relative flex w-[300px] flex-none flex-col gap-1">
          <Field label={t("entry.scanLabel")} required>
            <ScanInput
              ref={scanRef}
              value={scanText}
              onChange={(e) => setScanText(e.target.value)}
              onScan={resolve}
              placeholder={t("entry.searchOrScan")}
            />
          </Field>
          {product ? (
            <div className="flex items-center gap-1.5 rounded-[3px] border border-border bg-card px-2 py-1 text-[12px]">
              <span className="min-w-0 flex-1 truncate font-bold">{product.name}</span>
              {serialized ? <Chip>{t("chip.serie")}</Chip> : null}
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
          ) : searchMatches.length > 0 ? (
            <div className="absolute top-[54px] z-20 w-full overflow-hidden rounded-[3px] border border-border-strong bg-card shadow-md">
              {searchMatches.map((row) => (
                <button
                  key={row.productId}
                  type="button"
                  onClick={() => selectProduct(toScanProduct(row))}
                  className="flex w-full items-center gap-2 border-b border-border-light px-2 py-1.5 text-left last:border-b-0 hover:bg-nav-hover"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px]">{row.name}</span>
                  {row.itemType === "serialized" ? <Chip>{t("chip.serie")}</Chip> : null}
                  <span className="font-mono text-[10px] tabular-nums text-faint">{row.onHand}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[10px] leading-snug text-faint">{t("entry.idleHint")}</div>
          )}
          {notice ? <div className="text-[11px] text-ink-2">{notice}</div> : null}
        </div>

        {/* quantity first, then cost — disabled until an item resolves */}
        <div className="w-[92px] flex-none">
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
        </div>
        <div className="w-[110px] flex-none">
          <Field label={t("entry.unitCost")} required error={lineErr("cost")}>
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

        {/* serialized: the quantity becomes the IMEI target */}
        {serialized ? (
          <div className="w-[210px] flex-none">
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
            <div className="mt-1 flex flex-wrap gap-1">
              {imeis.map((imei) => (
                <span
                  key={imei}
                  className="inline-flex items-center gap-1 rounded-[2px] border border-border bg-card px-1 font-mono text-[9px] tabular-nums"
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
            <div className="mt-0.5 text-[10px] text-faint">
              {imeis.length === qty
                ? t("entry.imeiCaptured", { n: imeis.length, total: qty })
                : t("entry.imeiPending", { n: Math.max(0, qty - imeis.length) })}
            </div>
          </div>
        ) : null}

        <div className="flex-none pt-[18px]">
          <GhostButton disabled={!canStage} onClick={stageLine}>
            {t("entry.addToList")}
          </GhostButton>
        </div>

        {/* supplier */}
        <div className="w-[190px] flex-none">
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
            className="mt-1 text-[10px] text-muted underline hover:text-ink"
            onClick={() => {
              setNewSupplierMode((m) => !m);
              setSupplierError(null);
            }}
          >
            {newSupplierMode ? t("common.cancel") : t("entry.newSupplier")}
          </button>
        </div>

        {/* staged lines + confirm */}
        <div className="min-w-0 flex-1">
          <SectionLabel className="mb-1">{t("entry.stagedTotal")}</SectionLabel>
          <div className="max-h-[92px] overflow-y-auto">
            {staged.length === 0 ? (
              <div className="text-[11px] text-faint">{t("entry.stagedEmpty")}</div>
            ) : (
              <table className="w-full border-collapse text-[11px]">
                <tbody>
                  {staged.map((l) => (
                    <tr key={l.key} className="border-b border-border-light bg-card">
                      <td className="px-2 py-1">
                        <span className="truncate">{l.name}</span>
                        {l.imeis.length > 0 ? (
                          <span className="ml-1.5 font-mono text-[9px] text-faint">
                            {t("entry.stagedUnits", { n: l.imeis.length })}
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right font-mono tabular-nums">
                        {l.qty} × {formatCents(l.unitCostCents)}
                      </td>
                      <td className="w-6 px-1 py-1 text-center">
                        <button
                          type="button"
                          aria-label={t("entry.removeLine")}
                          className="text-muted hover:text-ink"
                          onClick={() => setStaged((prev) => prev.filter((x) => x.key !== l.key))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {confirmError ? <div className="mt-1 text-[11px] text-ink-2">{confirmError}</div> : null}
          <div className="mt-2 flex justify-end">
            <PrimaryButton onClick={confirm} disabled={!canConfirm}>
              {submitting ? t("common.saving") : `${t("entry.confirm")} · ${formatCents(totalCents)}`}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {modals}
    </div>
  );
}
