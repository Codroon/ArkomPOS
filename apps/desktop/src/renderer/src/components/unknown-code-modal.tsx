/**
 * Unknown-code rescue — the fix for "I scanned the box and it said no results".
 * Two ways out, never a dead end: create the product with the code prefilled,
 * or attach the code to a product that already exists (it becomes an additional
 * code) and carry on with the interrupted flow.
 */
import { useEffect, useMemo, useState } from "react";
import type { ProductRow, ScanProduct } from "@arkom/core";
import { Chip, GhostButton, MoneyText, PrimaryButton, SearchInput, useT } from "@arkom/ui";
import { errorMessage } from "../lib/errors";

type Mode = "choice" | "attach";

export function UnknownCodeModal({
  code,
  unavailableUnit,
  onCreateProduct,
  onAttached,
  onClose,
}: {
  code: string;
  /** set when the code IS a known IMEI whose phone is sold/reserved */
  unavailableUnit?: { imei: string; status: string; productName: string };
  onCreateProduct: (code: string) => void;
  /** the code now resolves to this product — resume whatever was interrupted */
  onAttached: (product: ScanProduct, code: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("choice");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [pending, setPending] = useState<ProductRow | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    if (mode !== "attach") return;
    window.arkom
      .invoke("catalog:list", {})
      .then(setRows)
      .catch((err) => console.error("catalog:list failed", err));
  }, [mode]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle.length >= 2
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || (r.barcode ?? "").includes(needle))
      : rows;
    return list.slice(0, 60);
  }, [rows, search]);

  const toScanProduct = (row: ProductRow): ScanProduct => ({
    productId: row.id,
    name: row.name,
    itemType: row.itemType,
    priceCents: row.priceCents,
    onHand: row.onHand,
    active: row.active,
  });

  const attach = (row: ProductRow, confirmed: boolean) => {
    setError(null);
    window.arkom
      .invoke("catalog:addCode", { productId: row.id, code, confirmed })
      .then((result) => {
        if (result.kind === "sharedWarning") {
          setPending(row);
          setConflicts(result.conflicts.map((c) => c.name));
          return;
        }
        onAttached(toScanProduct(row), code);
      })
      .catch((err) => setError(errorMessage(t, err)));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/25" onMouseDown={onClose}>
      <div
        className="flex max-h-[70vh] w-[420px] flex-col rounded-[3px] border border-line-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[13px] font-bold">
            {mode === "choice" ? t("unknown.title") : t("unknown.attachTitle", { code })}
          </div>
          {mode === "choice" ? (
            <div className="text-[11px] text-muted">
              {unavailableUnit
                ? t(unavailableUnit.status === "sold" ? "unknown.unitSold" : "unknown.unitReserved", {
                    name: unavailableUnit.productName,
                  })
                : t("unknown.body", { code })}
            </div>
          ) : null}
        </div>

        {mode === "choice" ? (
          // a known-but-unavailable IMEI has no rescue: creating a product for a
          // phone we already sold would be wrong, so we only explain and close
          unavailableUnit ? (
            <div className="flex justify-end p-4">
              <PrimaryButton className="h-8" onClick={onClose}>
                {t("peek.close")}
              </PrimaryButton>
            </div>
          ) : (
            <div className="flex flex-col gap-2 p-4">
              <PrimaryButton className="h-8" onClick={() => onCreateProduct(code)}>
                {t("unknown.create")}
              </PrimaryButton>
              <GhostButton className="h-8" onClick={() => setMode("attach")}>
                {t("unknown.attach")}
              </GhostButton>
            </div>
          )
        ) : (
          <>
            <div className="border-b border-line px-4 py-2">
              <SearchInput
                autoFocus
                placeholder={t("unknown.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="p-4 text-center text-[12px] text-muted">{t("unknown.noProducts")}</div>
              ) : (
                visible.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => attach(row, false)}
                    className="flex w-full items-center gap-2 border-b border-line px-4 py-2 text-left hover:bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px]">
                        {row.name}
                        {row.itemType === "serialized" ? <Chip className="ml-1.5">{t("chip.serie")}</Chip> : null}
                      </div>
                      <div className="font-mono font-medium text-[10px] tabular-nums text-subtle">{row.barcode ?? ""}</div>
                    </div>
                    {row.priceCents != null ? <MoneyText cents={row.priceCents} className="text-[11px]" /> : null}
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {error ? <div className="border-t border-line px-4 py-2 text-[11px] text-ink-2">{error}</div> : null}

        {/* shared-code confirmation, inline so the picker stays put behind it */}
        {conflicts && pending ? (
          <div className="border-t border-line-strong bg-surface-2 px-4 py-3">
            <div className="text-[12px] font-bold">{t("shared.title")}</div>
            <div className="mt-1 text-[11px] text-muted">
              {t("shared.body", { code, names: conflicts.join(", ") })}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <GhostButton
                onClick={() => {
                  setConflicts(null);
                  setPending(null);
                }}
              >
                {t("common.cancel")}
              </GhostButton>
              <PrimaryButton
                onClick={() => {
                  const row = pending;
                  setConflicts(null);
                  setPending(null);
                  attach(row, true);
                }}
              >
                {t("shared.attachAnyway")}
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
