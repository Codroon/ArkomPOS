/**
 * The two dialogs the ficha opens — handoff/repairs.md §3.
 *
 * Both exist because the action needs one more fact than a button can carry:
 * *which way* the customer said yes, and *what the part actually cost*.
 */
import { useEffect, useState } from "react";
import { centsToInput, formatCents, parseMoneyInput, type InventoryRow, type RepairLineRow } from "@arkom/core";
import { AccentButton, Field, GhostButton, SearchInput, SelectInput, TextInput, cn, useT } from "@arkom/ui";

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
      <div className="w-[420px] rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{title}</div>
        <div className="px-3.5 py-3">{children}</div>
      </div>
    </div>
  );
}

/**
 * Recording the approval.
 *
 * The total is shown large and **read-only**. Approving *an amount* is the whole
 * point of the record, so a field someone could mistype there is a dispute
 * later — the number comes from the quote or not at all.
 */
export function ApprovalDialog({
  totalCents,
  onCancel,
  onConfirm,
}: {
  totalCents: number;
  onCancel: () => void;
  onConfirm: (method: "in_person" | "by_phone") => void;
}) {
  const t = useT();
  const [method, setMethod] = useState<"in_person" | "by_phone">("in_person");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={t("rep.approve.title")}>
      <div className="text-[10px] font-bold tracking-[.08em] text-subtle">{t("rep.approve.total")}</div>
      <div className="font-mono text-[26px] font-bold tabular-nums">{formatCents(totalCents)}</div>

      <div className="mt-3 flex overflow-hidden rounded-[3px] border border-line-strong">
        {(
          [
            ["in_person", t("rep.approve.inPerson")],
            ["by_phone", t("rep.approve.byPhone")],
          ] as ReadonlyArray<["in_person" | "by_phone", string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMethod(value)}
            className={cn(
              "flex-1 border-r border-line px-2 py-1.5 text-[12px] last:border-r-0",
              method === value ? "bg-ink font-semibold text-inverse-ink" : "bg-card text-ink-2 hover:bg-hover",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-muted">{t("rep.approve.note")}</div>

      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm(method);
          }}
        >
          {t("rep.approve.confirm")}
        </AccentButton>
      </div>
    </Modal>
  );
}

/**
 * Goods received.
 *
 * The real cost is prefilled with what was expected and is meant to be
 * corrected: the whole reason this dialog exists is that a delivery rarely costs
 * exactly what someone guessed when they ordered it, and the article's cost
 * figure should come from the invoice.
 */
export function ReceivePartDialog({
  lines,
  onCancel,
  onConfirm,
}: {
  lines: RepairLineRow[];
  onCancel: () => void;
  onConfirm: (input: { lineId: string; unitCostCents: number; qty: number; productId: string | null }) => void;
}) {
  const t = useT();
  const [lineId, setLineId] = useState(lines[0]?.id ?? "");
  const line = lines.find((l) => l.id === lineId) ?? lines[0] ?? null;

  const [cost, setCost] = useState(() => centsToInput(lines[0]?.expectedCostCents ?? 0));
  const [qty, setQty] = useState(String(lines[0]?.qty ?? 1));
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [product, setProduct] = useState<InventoryRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!line) return;
    setCost(centsToInput(line.expectedCostCents ?? 0));
    setQty(String(line.qty));
    setProduct(null);
    setQuery(line.description);
  }, [lineId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      window.arkom
        .invoke("inventory:list", { search: query.trim() || undefined })
        .then((all) => !cancelled && setRows(all.filter((r) => r.itemType !== "serialized").slice(0, 12)))
        .catch(() => setRows([]));
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const cents = parseMoneyInput(cost);
  const n = Number(qty);
  const valid = line !== null && cents !== null && Number.isInteger(n) && n >= 1 && product !== null;

  if (!line) return null;

  return (
    <Modal title={t("rep.parts.receiveTitle")}>
      {lines.length > 1 ? (
        <Field label={t("rep.parts.part")}>
          <SelectInput value={lineId} onChange={(e) => setLineId(e.target.value)}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.description}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : (
        <div className="text-[12px] font-semibold">{line.description}</div>
      )}

      <Field className="mt-2" label={t("rep.parts.product")} hint={t("rep.parts.productHint")} required>
        {product ? (
          <div className="flex items-center gap-2 rounded-[2px] border border-line bg-surface-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-[12px]">{product.name}</span>
            <GhostButton onClick={() => setProduct(null)}>{t("common.change")}</GhostButton>
          </div>
        ) : (
          <>
            <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="mt-1 max-h-[150px] overflow-y-auto rounded-[2px] border border-line">
              {rows.length === 0 ? (
                <div className="px-2.5 py-2 text-[11px] text-subtle">{t("rep.part.none")}</div>
              ) : (
                rows.map((row, i) => (
                  <button
                    key={row.productId}
                    type="button"
                    onClick={() => setProduct(row)}
                    className={cn(
                      "block w-full truncate px-2.5 py-1.5 text-left text-[12px] hover:bg-hover",
                      i > 0 && "border-t border-line",
                    )}
                  >
                    {row.name}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </Field>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label={t("rep.parts.realCost")} required>
          <TextInput mono requiredStyle inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label={t("rep.part.qty")}>
          <TextInput mono inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={busy || !valid}
          onClick={() => {
            setBusy(true);
            onConfirm({ lineId: line.id, unitCostCents: cents!, qty: n, productId: product!.productId });
          }}
        >
          {t("rep.parts.receive")}
        </AccentButton>
      </div>
    </Modal>
  );
}
