/**
 * The quote block on the ficha — handoff/repairs.md §3.
 *
 * Concepto · Coste · Cargo · Margen, and the margin in € and % in the footer,
 * because the number that tells the owner whether the job was worth doing
 * should not need a calculator.
 *
 * Two things this panel says out loud that a quieter design would hide:
 *   - a fitted part is already off the shelf ("Descontada del inventario"),
 *   - removing it posts a RETURN movement rather than deleting anything
 *     (ADR-0004), which is what the confirm dialog says in words.
 */
import { useEffect, useState } from "react";
import {
  isSerializedItem,
  centsToInput,
  formatCents,
  parseMoneyInput,
  type InventoryRow,
  type RepairDetail,
  type RepairLineRow,
} from "@arkom/core";
import {
  AccentButton,
  Chip,
  ConfirmDialog,
  Field,
  GhostButton,
  PrimaryButton,
  ScanInput,
  SectionLabel,
  TextInput,
  cn,
  useT, useDataLabel } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { useScanFlow } from "../../lib/use-scan-flow";
import { SupplierField } from "../../components/supplier-picker";

type Dialog = null | "labor" | "part" | "order";

/** The three-decimal-free margin of one line, or null when nothing is charged. */
function lineMargin(line: RepairLineRow): { cents: number; pct: number | null } | null {
  if (line.chargeCents === 0) return null;
  const cost = (line.unitCostCents ?? 0) * line.qty;
  const cents = line.chargeCents - cost;
  return { cents, pct: Math.round((cents / line.chargeCents) * 100) };
}

export function QuotePanel({
  detail,
  onChanged,
  readOnly,
}: {
  detail: RepairDetail;
  onChanged: (next: RepairDetail) => void;
  readOnly: boolean;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removing, setRemoving] = useState<RepairLineRow | null>(null);
  const [editing, setEditing] = useState<{ line: RepairLineRow; value: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<RepairDetail>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
      return true;
    } catch (err) {
      setError(errorMessage(t, err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /* An edit needs a reason only when it LOWERS a charge the customer already
     agreed to — main decides that from the ticket's own rows, and this is the
     UI mirroring the same rule so the field appears before the refusal does. */
  const approved = detail.approvals[0] ?? null;
  const needsReason = (line: RepairLineRow, next: number) => approved !== null && next < line.chargeCents;

  return (
    <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <SectionLabel>{t("rep.detail.quote")}</SectionLabel>
        <div className="flex-1" />
        {!readOnly ? (
          <div className="flex gap-1.5">
            <GhostButton onClick={() => setDialog("part")}>{t("rep.quote.addPart")}</GhostButton>
            <GhostButton onClick={() => setDialog("labor")}>{t("rep.quote.addLabor")}</GhostButton>
            <GhostButton onClick={() => setDialog("order")}>{t("rep.quote.addOrder")}</GhostButton>
          </div>
        ) : null}
      </div>

      {detail.lines.length === 0 ? (
        <div className="mt-2 text-[11px] text-subtle">{t("rep.quote.empty")}</div>
      ) : (
        <table className="mt-2 w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] font-bold tracking-[.08em] text-subtle">
              <th className="py-1">{t("rep.quote.concept")}</th>
              <th className="w-[90px] py-1 text-right">{t("rep.quote.cost")}</th>
              <th className="w-[90px] py-1 text-right">{t("rep.quote.charge")}</th>
              <th className="w-[110px] py-1 text-right">{t("rep.quote.margin")}</th>
              <th className="w-[70px] py-1" />
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => {
              const margin = lineMargin(line);
              const onOrder = line.kind === "part_on_order" && line.receivedAt === null;
              return (
                <tr key={line.id} className="border-b border-line align-top">
                  <td className="py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span>
                        {line.qty > 1 ? `${line.qty} × ` : ""}
                        {dataLabel(line.description)}
                      </span>
                      {onOrder ? <Chip variant="warning">{t("rep.quote.ordered")}</Chip> : null}
                    </div>
                    {line.kind === "inventory_part" ? (
                      <div className="text-[10px] text-subtle">{t("rep.quote.consumed")}</div>
                    ) : null}
                    {/* either fact is worth showing on its own: an ordered part
                        with a supplier and no estimate still answers "who is it
                        coming from?", which used to hide behind the cost */}
                    {onOrder && (line.expectedCostCents !== null || line.supplierText) ? (
                      <div className="text-[10px] text-subtle">
                        {line.expectedCostCents !== null
                          ? `${t("rep.quote.expected")} ${formatCents(line.expectedCostCents)}`
                          : ""}
                        {line.expectedCostCents !== null && line.supplierText ? " · " : ""}
                        {line.supplierText ?? ""}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink-2">
                    {line.unitCostCents === null ? "—" : formatCents(line.unitCostCents * line.qty)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {readOnly ? (
                      formatCents(line.chargeCents)
                    ) : (
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-2 hover:text-accent-ink"
                        onClick={() =>
                          setEditing({ line, value: centsToInput(line.chargeCents), reason: "" })
                        }
                      >
                        {formatCents(line.chargeCents)}
                      </button>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink-2">
                    {margin === null ? "—" : `${formatCents(margin.cents)} · ${margin.pct}%`}
                  </td>
                  <td className="py-1.5 text-right">
                    {!readOnly ? (
                      <button
                        type="button"
                        className="text-[11px] text-muted underline hover:text-danger-ink"
                        onClick={() => setRemoving(line)}
                      >
                        {t("rep.quote.remove")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            <tr className="text-[12px] font-semibold">
              <td className="py-1.5">{t("rep.quote.total")}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{formatCents(detail.margin.costCents)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{formatCents(detail.quoteTotalCents)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {formatCents(detail.margin.marginCents)}
                {detail.margin.marginPct === null ? "" : ` · ${detail.margin.marginPct}%`}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      {error ? <div className="mt-2 text-[11px] text-danger-ink">{error}</div> : null}

      {dialog === "labor" ? (
        <LaborDialog
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={async (description, chargeCents) => {
            const ok = await run(() =>
              window.arkom.invoke("repair:addLine", {
                kind: "labor",
                ticketId: detail.id,
                description,
                chargeCents,
              }),
            );
            if (ok) setDialog(null);
          }}
        />
      ) : null}

      {dialog === "part" ? (
        <PartDialog
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={async (productId, qty) => {
            const ok = await run(() =>
              window.arkom.invoke("repair:addLine", {
                kind: "inventory_part",
                ticketId: detail.id,
                productId,
                qty,
              }),
            );
            if (ok) setDialog(null);
          }}
        />
      ) : null}

      {dialog === "order" ? (
        <OrderDialog
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={async (input) => {
            const ok = await run(() =>
              window.arkom.invoke("repair:addLine", {
                kind: "part_on_order",
                ticketId: detail.id,
                ...input,
              }),
            );
            if (ok) setDialog(null);
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmDialog
          open
          cancelLabel={t("common.cancel")}
          title={t("rep.quote.removeTitle")}
          /* the wording matters: the row goes, the movement does not — a second,
             opposite movement is posted and both stay on the ledger */
          body={
            removing.kind === "inventory_part"
              ? t("rep.quote.removeBody")
              : t("rep.quote.removeBodyPlain")
          }
          confirmLabel={t("rep.quote.remove")}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            void run(() =>
              window.arkom.invoke("repair:removeLine", { ticketId: detail.id, lineId: removing.id }),
            ).then((ok) => ok && setRemoving(null));
          }}
        />
      ) : null}

      {editing ? (
        <ChargeDialog
          line={editing.line}
          value={editing.value}
          reason={editing.reason}
          needsReason={needsReason(editing.line, parseMoneyInput(editing.value) ?? editing.line.chargeCents)}
          busy={busy}
          onChange={(next) => setEditing((e) => (e ? { ...e, ...next } : e))}
          onCancel={() => setEditing(null)}
          onConfirm={async () => {
            const cents = parseMoneyInput(editing.value);
            if (cents === null) return;
            const ok = await run(() =>
              window.arkom.invoke("repair:setLineCharge", {
                ticketId: detail.id,
                lineId: editing.line.id,
                chargeCents: cents,
                reason: editing.reason.trim() || null,
              }),
            );
            if (ok) setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- dialogs */

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

function LaborDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (description: string, chargeCents: number) => void;
}) {
  const t = useT();
  const [description, setDescription] = useState("");
  const [charge, setCharge] = useState("");
  const cents = parseMoneyInput(charge);

  return (
    <Modal title={t("rep.labor.title")}>
      <Field label={t("rep.labor.description")} required>
        <TextInput requiredStyle autoFocus value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field className="mt-2" label={t("rep.labor.charge")} required>
        <TextInput mono inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} />
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={busy || !description.trim() || cents === null}
          onClick={() => onConfirm(description.trim(), cents!)}
        >
          {t("common.add")}
        </AccentButton>
      </div>
    </Modal>
  );
}

function PartDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (productId: string, qty: number) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [chosen, setChosen] = useState<InventoryRow | null>(null);
  const [qty, setQty] = useState("1");
  const [scanError, setScanError] = useState<string | null>(null);

  /**
   * A scanned code picks the part outright.
   *
   * The same pipeline the Sale screen and the receiving drawer use, so an
   * unknown code gets the usual rescue rather than a dead end, and an ambiguous
   * one gets the usual picker. A serialized product is refused here with the
   * reason ADR-0014 §3 gives, rather than being silently ignored.
   */
  const scan = useScanFlow({
    onProduct: (product) => {
      setScanError(null);
      if (isSerializedItem(product.itemType)) {
        setScanError(t("rep.part.serialized"));
        return;
      }
      window.arkom
        .invoke("inventory:list", { search: product.name })
        .then((all) => {
          const row = all.find((r) => r.productId === product.productId);
          if (row) setChosen(row);
          else setScanError(t("rep.part.none"));
        })
        .catch(() => undefined);
    },
    onUnit: () => setScanError(t("rep.part.serialized")),
    onCreateProduct: () => setScanError(t("rep.part.none")),
    onError: (message) => setScanError(message),
  });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      window.arkom
        .invoke("inventory:list", { search: query.trim() || undefined })
        .then((all) => {
          if (cancelled) return;
          // serialized articles are refused by main anyway (ADR-0014 §3), so
          // they are not offered here either
          /* a used device is serialized-by-another-name and equally refused */
          setRows(all.filter((r) => !isSerializedItem(r.itemType)).slice(0, 20));
        })
        .catch(() => setRows([]));
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const n = Number(qty);
  const valid = chosen !== null && Number.isInteger(n) && n >= 1;

  return (
    <Modal title={t("rep.part.title")}>
      {chosen ? (
        <div className="flex items-center gap-2 rounded-[2px] border border-line bg-surface-2 px-2 py-1.5">
          <div className="min-w-0 flex-1 truncate text-[12px]">{chosen.name}</div>
          <div className="text-[11px] text-muted">{t("rep.part.stock", { n: String(chosen.onHand) })}</div>
          <GhostButton onClick={() => setChosen(null)}>{t("common.change")}</GhostButton>
        </div>
      ) : (
        <>
          {/* A ScanInput, like the Sale screen's: the technician has the same
              scanner in their hand and the same box in front of them, and
              typing a 13-digit barcode to then click the one result it filters
              to is a step the hardware already does. Typing still searches —
              Enter is what a scanner sends, so only a scan takes the fast path
              (foundations, "Global behaviors"). */}
          <ScanInput
            autoFocus
            autoRefocus={false}
            value={query}
            placeholder={t("rep.part.search")}
            onChange={(e) => setQuery(e.target.value)}
            onScan={(code) => {
              setQuery("");
              scan.resolve(code);
            }}
          />
          <div className="mt-2 max-h-[220px] overflow-y-auto rounded-[2px] border border-line">
            {rows.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-subtle">{scanError ?? t("rep.part.none")}</div>
            ) : (
              rows.map((row, i) => (
                <button
                  key={row.productId}
                  type="button"
                  onClick={() => setChosen(row)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-hover",
                    i > 0 && "border-t border-line",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px]">{row.name}</span>
                  <span className="text-[11px] text-muted">
                    {t("rep.part.stock", { n: String(row.onHand) })}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      <Field className="mt-2" label={t("rep.part.qty")}>
        <TextInput mono inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>

      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton disabled={busy || !valid} onClick={() => onConfirm(chosen!.productId, n)}>
          {t("common.add")}
        </AccentButton>
      </div>
      {scan.modals}
    </Modal>
  );
}

function OrderDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    description: string;
    qty: number;
    supplierId: string | null;
    expectedCostCents: number | null;
    chargeCents: number;
  }) => void;
}) {
  const t = useT();
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState("");
  const [charge, setCharge] = useState("");

  const n = Number(qty);
  const cents = parseMoneyInput(charge);
  const valid = description.trim() !== "" && Number.isInteger(n) && n >= 1 && cents !== null;

  return (
    <Modal title={t("rep.order.title")}>
      <Field label={t("rep.order.description")} required>
        <TextInput requiredStyle autoFocus value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label={t("rep.part.qty")}>
          <TextInput mono inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        {/* the same list receiving picks from, and the same way to add to it */}
        <SupplierField label="rep.order.supplier" value={supplier} onChange={setSupplier} />
        <Field label={t("rep.order.expected")}>
          <TextInput mono inputMode="decimal" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label={t("rep.order.charge")} required>
          <TextInput mono requiredStyle inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={busy || !valid}
          onClick={() =>
            onConfirm({
              description: description.trim(),
              qty: n,
              supplierId: supplier || null,
              expectedCostCents: parseMoneyInput(expected),
              chargeCents: cents!,
            })
          }
        >
          {t("common.add")}
        </AccentButton>
      </div>
    </Modal>
  );
}

function ChargeDialog({
  line,
  value,
  reason,
  needsReason,
  busy,
  onChange,
  onCancel,
  onConfirm,
}: {
  line: RepairLineRow;
  value: string;
  reason: string;
  needsReason: boolean;
  busy: boolean;
  onChange: (next: Partial<{ value: string; reason: string }>) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const cents = parseMoneyInput(value);
  const valid = cents !== null && (!needsReason || reason.trim() !== "");

  return (
    <Modal title={dataLabel(line.description)}>
      <Field label={t("rep.quote.charge")} required>
        <TextInput mono autoFocus inputMode="decimal" value={value} onChange={(e) => onChange({ value: e.target.value })} />
      </Field>
      {needsReason ? (
        <Field className="mt-2" label={t("rep.quote.lowerReason")} hint={t("rep.quote.lowerHint")} required>
          <TextInput requiredStyle value={reason} onChange={(e) => onChange({ reason: e.target.value })} />
        </Field>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <PrimaryButton disabled={busy || !valid} onClick={onConfirm}>
          {t("common.save")}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
