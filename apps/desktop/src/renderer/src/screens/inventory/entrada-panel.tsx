/**
 * Entrada de stock panel — handoff 03 §Entrada. Scan resolves the product;
 * serialized products switch to the IMEI branch (qty locked to 1, one staged
 * row per IMEI, staged duplicates rejected inline). Confirmar posts one
 * stock:add transaction; on success the parent refreshes, flashes changed
 * rows and focus returns to the scan input.
 */
import { useEffect, useRef, useState } from "react";
import {
  centsToInput,
  formatCents,
  isValidImei,
  parseIpcError,
  parseMoneyInput,
  uuidv7,
  type EntityRef,
  type InventoryRow,
  type StockAddEntry,
} from "@arkom/core";
import {
  Chip,
  Field,
  GhostButton,
  PrimaryButton,
  ScanInput,
  SectionLabel,
  SelectInput,
  TextInput,
  useT,
  type ScanInputHandle,
  type TKey,
} from "@arkom/ui";

interface StagedLine {
  key: string;
  productId: string;
  name: string;
  barcode: string | null;
  serialized: boolean;
  qty: number;
  unitCostCents: number;
  imei: string | null;
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
  const scanRef = useRef<ScanInputHandle>(null);
  const imeiRef = useRef<HTMLInputElement>(null);

  const [scanText, setScanText] = useState("");
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [product, setProduct] = useState<InventoryRow | null>(null);
  const [costInput, setCostInput] = useState("");
  const [qtyInput, setQtyInput] = useState("1");
  const [imeiInput, setImeiInput] = useState("");
  const [lineErrors, setLineErrors] = useState<LineErrors>({});

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

  const resolve = (code: string) => {
    const found = rows.find((r) => r.barcode === code);
    setScanText("");
    if (!found) {
      setUnknownCode(code);
      return;
    }
    setUnknownCode(null);
    setProduct(found);
    setCostInput(found.costCents == null ? "" : centsToInput(found.costCents)); // last cost prefill
    setQtyInput("1");
    setImeiInput("");
    setLineErrors({});
    if (found.itemType === "serialized") setTimeout(() => imeiRef.current?.focus(), 0);
  };

  const stageLine = () => {
    if (!product) return;
    const errors: LineErrors = {};
    const cost = parseMoneyInput(costInput);
    if (cost === null) errors.cost = costInput.trim() === "" ? "val.costRequired" : "val.invalidAmount";
    const serialized = product.itemType === "serialized";
    let qty = 1;
    let imei: string | null = null;
    if (serialized) {
      imei = imeiInput.trim();
      if (!isValidImei(imei)) errors.imei = "val.imeiInvalid";
      else if (staged.some((l) => l.imei === imei)) errors.imei = "val.imeiDupStaged";
    } else {
      qty = /^\d+$/.test(qtyInput.trim()) ? Number(qtyInput.trim()) : 0;
      if (qty < 1) errors.qty = "val.qtyMin1";
    }
    setLineErrors(errors);
    if (Object.keys(errors).length > 0 || cost === null) return;

    setStaged((prev) => [
      ...prev,
      {
        key: uuidv7(),
        productId: product.productId,
        name: product.name,
        barcode: product.barcode,
        serialized,
        qty,
        unitCostCents: cost,
        imei,
      },
    ]);
    setConfirmError(null);
    if (serialized) {
      setImeiInput(""); // one row per IMEI: keep the product, take the next IMEI
      setTimeout(() => imeiRef.current?.focus(), 0);
    } else {
      setProduct(null);
      setCostInput("");
      setQtyInput("1");
      scanRef.current?.focus();
    }
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
  const canConfirm = staged.length > 0 && supplierId !== "" && !submitting;

  const confirm = () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setConfirmError(null);
    const entries: StockAddEntry[] = staged.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      unitCostCents: l.unitCostCents,
      supplierId,
      ...(l.imei ? { imei: l.imei } : {}),
    }));
    window.arkom
      .invoke("stock:add", { entries })
      .then((res) => {
        const ids = res.productIds;
        setStaged([]);
        setProduct(null);
        setCostInput("");
        setQtyInput("1");
        setImeiInput("");
        onConfirmed(ids, res.lineCount);
        scanRef.current?.focus();
      })
      .catch((err) => {
        const ipc = parseIpcError(err);
        setConfirmError(
          ipc ? (ipc.code === "DUPLICATE_IMEI" ? t("err.duplicateImei") : ipc.message) : t("catalog.saveFailed"),
        );
      })
      .finally(() => setSubmitting(false));
  };

  const lineErr = (k: keyof LineErrors) => (lineErrors[k] ? t(lineErrors[k]!) : undefined);

  return (
    <div className={`flex-none border-t border-border-strong bg-panel px-4 py-3 ${submitting ? "pointer-events-none opacity-60" : ""}`}>
      <SectionLabel className="mb-2">{t("entry.section")}</SectionLabel>
      <div className="flex items-start gap-3">
        {/* 1. scan + per-entry fields */}
        <div className="flex w-[440px] flex-none flex-col gap-2">
          <ScanInput
            ref={scanRef}
            value={scanText}
            onChange={(e) => setScanText(e.target.value)}
            onScan={resolve}
            placeholder={t("entry.scanPlaceholder")}
          />
          {unknownCode ? (
            <div className="text-[11px] text-ink-2">
              <span className="font-mono tabular-nums">{unknownCode}</span> · {t("entry.unknownCode")} ·{" "}
              <button
                type="button"
                className="font-bold underline hover:text-ink"
                onClick={() => onCreateArticle(unknownCode)}
              >
                {t("entry.createArticle")}
              </button>
            </div>
          ) : null}
          {product ? (
            <div className="rounded-[3px] border border-border bg-card p-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold">
                {product.name}
                {product.itemType === "serialized" ? <Chip>{t("chip.serie")}</Chip> : null}
              </div>
              <div className="flex items-end gap-2">
                <Field label={t("entry.unitCost")} required error={lineErr("cost")} className="w-32">
                  <TextInput
                    mono
                    requiredStyle
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    placeholder={t("editor.moneyPlaceholder")}
                  />
                </Field>
                {product.itemType === "serialized" ? (
                  <Field label={t("entry.imei")} required error={lineErr("imei")} className="flex-1">
                    <TextInput
                      ref={imeiRef}
                      mono
                      requiredStyle
                      value={imeiInput}
                      onChange={(e) => setImeiInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          stageLine();
                        }
                      }}
                      placeholder={t("entry.imeiPlaceholder")}
                      maxLength={15}
                    />
                  </Field>
                ) : (
                  <Field label={t("entry.qty")} required error={lineErr("qty")} className="w-24">
                    <TextInput
                      mono
                      requiredStyle
                      inputMode="numeric"
                      value={qtyInput}
                      onChange={(e) => setQtyInput(e.target.value)}
                    />
                  </Field>
                )}
                <GhostButton onClick={stageLine}>{t("entry.addLine")}</GhostButton>
              </div>
            </div>
          ) : null}
        </div>

        {/* 3. supplier */}
        <div className="w-[240px] flex-none">
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
                    {s.name}
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

        {/* 4. staged lines + 5. confirm */}
        <div className="min-w-0 flex-1">
          {staged.length > 0 ? (
            <table className="w-full border-collapse text-[11px]">
              <tbody>
                {staged.map((l) => (
                  <tr key={l.key} className="border-b border-border-light bg-card">
                    <td className="px-2 py-1">
                      {l.name}
                      <span className="ml-1.5 font-mono text-[9px] tabular-nums text-faint">
                        {l.imei ?? l.barcode ?? ""}
                      </span>
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
          ) : null}
          {confirmError ? <div className="mt-1 text-[11px] text-ink-2">{confirmError}</div> : null}
          <div className="mt-2 flex justify-end">
            <PrimaryButton onClick={confirm} disabled={!canConfirm}>
              {submitting ? t("common.saving") : `${t("entry.confirm")} · ${formatCents(totalCents)}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
