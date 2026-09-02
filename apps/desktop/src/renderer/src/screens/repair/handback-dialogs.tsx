/**
 * The three dialogs that end a repair — handoff/repairs.md §6.
 *
 * The money rules are NOT re-implemented here: `tenderSummary` is the same core
 * function the Sale screen's payment panel uses, so change, over-payment and the
 * card-cannot-exceed rule behave identically on both screens because they are
 * literally the same code.
 */
import { useMemo, useState } from "react";
import {
  centsToInput,
  formatCents,
  parseMoneyInput,
  tenderSummary,
  uuidv7,
  type RepairDetail,
  type RepairLineRow,
  type TenderDraft,
} from "@arkom/core";
import { AccentButton, Field, GhostButton, TextInput, cn, useT, type TKey, useDataLabel } from "@arkom/ui";

function Modal({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
      <div className={cn("rounded-[3px] border border-line-strong bg-card shadow-lg", wide ? "w-[520px]" : "w-[420px]")}>
        <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{title}</div>
        <div className="max-h-[70vh] overflow-y-auto px-3.5 py-3">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- notify */

export function NotifyDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (method: "phone" | "in_person" | "other", note: string | null) => void;
}) {
  const t = useT();
  const [method, setMethod] = useState<"phone" | "in_person" | "other">("phone");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={t("rep.notify.title")}>
      <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
        {(
          [
            ["phone", t("rep.notify.phone")],
            ["in_person", t("rep.notify.inPerson")],
            ["other", t("rep.notify.other")],
          ] as ReadonlyArray<["phone" | "in_person" | "other", string]>
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
      <Field className="mt-2" label={t("rep.notify.note")}>
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {/* said out loud, because a log that looks like a send button is a lie */}
      <div className="mt-2 text-[11px] text-muted">{t("rep.notify.hint")}</div>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            onConfirm(method, note.trim() || null);
          }}
        >
          {t("rep.notify.confirm")}
        </AccentButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ collect */

type Method = "cash" | "card" | "bizum" | "transfer";
const METHOD_KEYS: Record<Method, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
};

interface Entry {
  key: string;
  method: Method;
  amountInput: string;
  cardReference: string;
}

/**
 * Cobro y entrega.
 *
 * The deposit is on screen from the moment this opens and cannot be removed: it
 * is a payment the customer already made, not a discount on the work. What they
 * are asked for is the remainder.
 *
 * A zero remainder — the deposit covered it, or nothing was chargeable —
 * confirms with no tender at all, and says so.
 */
export function CollectDialog({
  detail,
  onCancel,
  onConfirm,
}: {
  detail: RepairDetail;
  onCancel: () => void;
  onConfirm: (tenders: TenderDraft[]) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  const total = detail.quoteTotalCents;
  const depositApplied = Math.min(detail.depositCents, total);
  const afterDeposit = total - depositApplied;

  const parsed = useMemo<TenderDraft[] | null>(() => {
    const out: TenderDraft[] = [];
    for (const entry of entries) {
      const cents = parseMoneyInput(entry.amountInput);
      if (cents === null || cents <= 0) return null;
      out.push({ method: entry.method, amountCents: cents, cardReference: entry.cardReference || null });
    }
    return out;
  }, [entries]);

  const summary = parsed ? tenderSummary(afterDeposit, parsed) : null;
  const remaining = summary ? summary.remainingCents : afterDeposit;
  const change = summary?.changeCents ?? 0;

  const cardMissingRef = entries.some((e) => e.method === "card" && e.cardReference.trim().length < 4);
  const canConfirm =
    !busy && parsed !== null && !cardMissingRef && (afterDeposit === 0 ? true : remaining === 0);

  return (
    <Modal wide title={t("rep.collect.title", { doc: detail.docNumber })}>
      <div className="text-[12px]">
        {detail.lines.map((line) => (
          <div key={line.id} className="flex justify-between border-b border-line py-1">
            <span>
              {line.qty > 1 ? `${line.qty} × ` : ""}
              {dataLabel(line.description)}
            </span>
            <span className="font-mono tabular-nums">{formatCents(line.chargeCents)}</span>
          </div>
        ))}
        <div className="flex justify-between py-1 font-semibold">
          <span>{t("rep.collect.total")}</span>
          <span className="font-mono tabular-nums">{formatCents(total)}</span>
        </div>
        {depositApplied > 0 ? (
          <>
            <div className="flex justify-between border-t border-line py-1 text-ink-2">
              <span>{t("rep.collect.deposit")}</span>
              <span className="font-mono tabular-nums">− {formatCents(depositApplied)}</span>
            </div>
            <div className="text-[10px] text-subtle">{t("rep.collect.depositNote")}</div>
          </>
        ) : null}
        <div className="mt-1 flex justify-between border-t border-line-strong py-1 text-[14px] font-bold">
          <span>{t("rep.collect.pending")}</span>
          <span className="font-mono tabular-nums">{formatCents(Math.max(0, remaining))}</span>
        </div>
        {change > 0 ? (
          <div className="flex justify-between py-1 text-success-ink">
            <span>{t("rep.collect.change")}</span>
            <span className="font-mono tabular-nums">{formatCents(change)}</span>
          </div>
        ) : null}
      </div>

      {afterDeposit === 0 ? (
        <div className="mt-3 rounded-[2px] border border-success-ink/30 bg-success-bg px-2 py-1.5 text-[12px] text-success-ink">
          {t("rep.collect.nothing")}
        </div>
      ) : (
        <>
          <div className="mt-3 flex gap-1.5">
            {(Object.keys(METHOD_KEYS) as Method[]).map((method) => (
              <button
                key={method}
                type="button"
                disabled={remaining <= 0}
                onClick={() =>
                  setEntries((list) => [
                    ...list,
                    {
                      key: uuidv7(),
                      method,
                      amountInput: centsToInput(Math.max(0, remaining)),
                      cardReference: "",
                    },
                  ])
                }
                className={cn(
                  "flex-1 rounded-[3px] border border-line-strong px-2 py-1.5 text-[11px]",
                  // a tile with nothing left to pay is an invitation to a number
                  // the handler will refuse
                  remaining <= 0 ? "cursor-default text-subtle" : "bg-card text-ink hover:bg-hover",
                )}
              >
                {t(METHOD_KEYS[method])}
              </button>
            ))}
          </div>

          {entries.map((entry, i) => (
            <div key={entry.key} className="mt-2 rounded-[3px] border border-line bg-surface-2 p-1.5">
              <div className="flex items-center gap-1.5">
                <span className="w-[80px] text-[11px] font-bold text-ink-2">{t(METHOD_KEYS[entry.method])}</span>
                <TextInput
                  mono
                  inputMode="decimal"
                  value={entry.amountInput}
                  onChange={(e) =>
                    setEntries((list) =>
                      list.map((x, j) => (j === i ? { ...x, amountInput: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className="text-[11px] text-muted underline hover:text-danger-ink"
                  onClick={() => setEntries((list) => list.filter((_, j) => j !== i))}
                >
                  {t("rep.quote.remove")}
                </button>
              </div>
              {entry.method === "card" ? (
                <div className="mt-1.5">
                  <TextInput
                    mono
                    placeholder="XXXX"
                    value={entry.cardReference}
                    onChange={(e) =>
                      setEntries((list) =>
                        list.map((x, j) => (j === i ? { ...x, cardReference: e.target.value } : x)),
                      )
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}
        </>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton
          disabled={!canConfirm}
          onClick={() => {
            setBusy(true);
            onConfirm(parsed ?? []);
          }}
        >
          {t("rep.collect.confirm")}
        </AccentButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- not repaired */

/**
 * Marcar no reparado.
 *
 * The confirm stays disabled until every consumed part has been resolved. This
 * is the one place the UI blocks on bookkeeping, and it does so because the
 * alternative is a part that silently vanished from the shelf (ADR-0014 §3).
 */
export function NotRepairedDialog({
  detail,
  onCancel,
  onConfirm,
}: {
  detail: RepairDetail;
  onCancel: () => void;
  onConfirm: (input: {
    reason: "customer_declined" | "unrepairable" | "abandoned";
    resolutions: Array<{ lineId: string; action: "return" | "charge" }>;
    depositAction: "refund" | "apply_fee";
    chargeDiagnosisFee: boolean;
  }) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [reason, setReason] = useState<"customer_declined" | "unrepairable" | "abandoned">("customer_declined");
  const [resolutions, setResolutions] = useState<Record<string, "return" | "charge">>({});
  const [depositAction, setDepositAction] = useState<"refund" | "apply_fee">("refund");
  const [chargeFee, setChargeFee] = useState(false);
  const [busy, setBusy] = useState(false);

  const consumed: RepairLineRow[] = detail.lines.filter((l) => l.kind === "inventory_part");
  const unresolved = consumed.filter((l) => !resolutions[l.id]).length;
  // a fee that never appeared on the intake receipt cannot be invented now
  const feeAvailable = detail.diagnosisFeeCents > 0;

  return (
    <Modal wide title={t("rep.close.title")}>
      <div className="text-[10px] font-bold tracking-[.08em] text-subtle">{t("rep.close.reason")}</div>
      <div className="mt-1 flex overflow-hidden rounded-[3px] border border-line-strong">
        {(
          [
            ["customer_declined", t("rep.close.customer_declined")],
            ["unrepairable", t("rep.close.unrepairable")],
            ["abandoned", t("rep.close.abandoned")],
          ] as ReadonlyArray<["customer_declined" | "unrepairable" | "abandoned", string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setReason(value)}
            className={cn(
              "flex-1 border-r border-line px-2 py-1.5 text-[12px] last:border-r-0",
              reason === value ? "bg-ink font-semibold text-inverse-ink" : "bg-card text-ink-2 hover:bg-hover",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {consumed.length > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] font-bold tracking-[.08em] text-subtle">{t("rep.close.parts")}</div>
          <div className="text-[10px] text-muted">{t("rep.close.partsHint")}</div>
          {consumed.map((line) => (
            <div key={line.id} className="mt-1.5 flex items-center gap-2 rounded-[2px] border border-line px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12px]">
                {line.qty > 1 ? `${line.qty} × ` : ""}
                {dataLabel(line.description)}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted">{formatCents(line.chargeCents)}</span>
              <div className="flex overflow-hidden rounded-[3px] border border-line-strong">
                {(
                  [
                    ["return", t("rep.close.return")],
                    ["charge", t("rep.close.charge")],
                  ] as ReadonlyArray<["return" | "charge", string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setResolutions((r) => ({ ...r, [line.id]: value }))}
                    className={cn(
                      "border-r border-line px-2 py-1 text-[11px] last:border-r-0",
                      resolutions[line.id] === value
                        ? "bg-ink font-semibold text-inverse-ink"
                        : "bg-card text-ink-2 hover:bg-hover",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {feeAvailable ? (
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={chargeFee} onChange={(e) => setChargeFee(e.target.checked)} />
            {t("rep.close.fee", { amount: formatCents(detail.diagnosisFeeCents) })}
          </label>
        ) : (
          /* the dialog says WHY it is absent rather than silently omitting it */
          <div className="text-[11px] text-muted">{t("rep.close.feeAbsent")}</div>
        )}
      </div>

      {detail.depositCents > 0 ? (
        <div className="mt-3">
          <div className="text-[10px] font-bold tracking-[.08em] text-subtle">
            {t("rep.close.deposit", { amount: formatCents(detail.depositCents) })}
          </div>
          <div className="mt-1 flex overflow-hidden rounded-[3px] border border-line-strong">
            {(
              [
                ["refund", t("rep.close.refund")],
                ["apply_fee", t("rep.close.applyFee")],
              ] as ReadonlyArray<["refund" | "apply_fee", string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setDepositAction(value)}
                className={cn(
                  "flex-1 border-r border-line px-2 py-1.5 text-[12px] last:border-r-0",
                  depositAction === value
                    ? "bg-ink font-semibold text-inverse-ink"
                    : "bg-card text-ink-2 hover:bg-hover",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {unresolved > 0 ? (
        <div className="mt-2 text-[11px] text-warning-ink">{t("rep.close.pendingParts")}</div>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        {/* the danger pair: a terminal action does not look like a routine one */}
        <button
          type="button"
          disabled={busy || unresolved > 0}
          onClick={() => {
            setBusy(true);
            onConfirm({
              reason,
              resolutions: consumed.map((l) => ({ lineId: l.id, action: resolutions[l.id]! })),
              depositAction,
              chargeDiagnosisFee: chargeFee && feeAvailable,
            });
          }}
          className={cn(
            "rounded-[3px] px-3 py-1.5 text-[12px] font-semibold",
            busy || unresolved > 0
              ? "cursor-default border border-line text-subtle"
              : "bg-danger-ink text-inverse-ink hover:opacity-90",
          )}
        >
          {t("rep.close.confirm")}
        </button>
      </div>
    </Modal>
  );
}
