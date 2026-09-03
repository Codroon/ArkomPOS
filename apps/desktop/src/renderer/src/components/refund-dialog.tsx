/**
 * Giving money back — ADR-0019.
 *
 * Opened from a completed ticket. It shows what is still refundable rather than
 * what was sold: a line already handed back is shown as spent, not offered
 * again, because "you cannot do that" after the fact is worse than not offering
 * it.
 *
 * Restock is per line and defaults ON, which is the ordinary case — an unopened
 * box goes back on the shelf. Turning it off is how a shop records a return it
 * cannot resell, and the money still goes back either way.
 */
import { useEffect, useMemo, useState } from "react";
import { formatCents, type RefundPeekResponse } from "@arkom/core";
import { AccentButton, Chip, Field, GhostButton, SelectInput, TextInput, cn, useDataLabel, useFieldError, useT } from "@arkom/ui";
import { errorMessage } from "../lib/errors";
import { useApprovalFlow } from "../lib/use-approval";

const METHODS = ["cash", "card", "bizum", "transfer", "store_credit"] as const;
const METHOD_KEY = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
  store_credit: "pay.storeCredit",
} as const;

export function RefundDialog({
  documentId,
  onCancel,
  onDone,
}: {
  documentId: string;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const approval = useApprovalFlow();

  const [peek, setPeek] = useState<RefundPeekResponse | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<(typeof METHODS)[number]>("cash");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const err = useFieldError(reason + JSON.stringify(qty));

  useEffect(() => {
    window.arkom
      .invoke("refund:peek", { documentId })
      .then((res) => {
        setPeek(res);
        /* nothing is pre-selected: a refund is a deliberate act per line, and a
           dialog that opens with everything ticked invites a slip */
        setRestock(Object.fromEntries(res.lines.map((l) => [l.id, l.restockable])));
      })
      .catch((e) => console.error("refund:peek failed", e));
  }, [documentId]);

  const chosen = useMemo(
    () => (peek?.lines ?? []).filter((l) => (qty[l.id] ?? 0) > 0),
    [peek, qty],
  );

  /* the figures the customer will be handed, computed from the ORIGINAL line's
     own totals so the screen and the document agree to the cent */
  const totalCents = useMemo(
    () =>
      chosen.reduce((sum, l) => {
        const n = qty[l.id] ?? 0;
        return sum + (n === l.remainingQty && l.refundedQty === 0 ? l.totalCents : Math.round((l.totalCents * n) / l.qty));
      }, 0),
    [chosen, qty],
  );

  const valid = chosen.length > 0 && reason.trim() !== "" && !busy;

  const submit = async () => {
    if (!valid || !peek) return;
    setBusy(true);
    err.clear();
    try {
      const res = await approval.run(
        (auth) =>
          window.arkom.invoke(
            "refund:create",
            {
              documentId: peek.documentId,
              reason: reason.trim(),
              method,
              lines: chosen.map((l) => ({ lineId: l.id, qty: qty[l.id]!, restock: !!restock[l.id] })),
            },
            auth,
          ),
        "sale.refund",
        {
          title: t("refund.title"),
          details: [
            { label: t("refund.ofTicket"), value: peek.docNumber },
            { label: t("refund.amount"), value: formatCents(totalCents) },
            { label: t("refund.reason"), value: reason.trim() },
          ],
        },
      );
      onDone(t("refund.done", { doc: res.docNumber }));
    } catch (e) {
      err.fail(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (!peek) return null;

  return (
    /* stopPropagation because this dialog is rendered INSIDE the ticket peek,
       whose own backdrop closes on mousedown. Without it, every click in here —
       a quantity, a checkbox, the confirm button — bubbled up and shut the
       whole thing, so a refund could be filled in but never submitted. */
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-inverse/40"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="max-h-[86vh] w-[640px] overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
          <div className="text-[13px] font-bold">{t("refund.title")}</div>
          <div className="font-mono text-[12px] font-bold tabular-nums">{peek.docNumber}</div>
          <div className="flex-1" />
          {peek.priorRefunds.length > 0 ? (
            <Chip variant="warning">{t("refund.priorCount", { n: peek.priorRefunds.length })}</Chip>
          ) : null}
        </div>

        {!peek.anythingLeft ? (
          <div className="px-4 py-8 text-center text-[12px] text-muted">{t("refund.nothingLeft")}</div>
        ) : (
          <div className="max-h-[46vh] overflow-y-auto px-4 py-2">
            <table className="w-full border-collapse text-[12px]">
              <thead className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                <tr>
                  <th className="py-1 text-left">{t("refund.col.item")}</th>
                  <th className="py-1 text-right">{t("refund.col.sold")}</th>
                  <th className="py-1 text-right">{t("refund.col.giveBack")}</th>
                  <th className="py-1 text-center">{t("refund.col.restock")}</th>
                  <th className="py-1 text-right">{t("refund.col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {peek.lines.map((l) => {
                  const spent = l.remainingQty === 0;
                  const n = qty[l.id] ?? 0;
                  return (
                    <tr key={l.id} className={cn("border-b border-line", spent && "text-muted")}>
                      <td className="py-1.5">
                        {dataLabel(l.description)}
                        {l.taxRegime === "REBU" ? <Chip className="ml-1.5">{t("refund.rebu")}</Chip> : null}
                        {l.returnsToReview ? (
                          <div className="text-[10px] text-subtle">{t("refund.toReview")}</div>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {l.qty}
                        {l.refundedQty > 0 ? (
                          <span className="ml-1 text-[10px] text-warning-ink">−{l.refundedQty}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 text-right">
                        {spent ? (
                          <span className="text-[11px]">{t("refund.spent")}</span>
                        ) : (
                          <TextInput
                            mono
                            className="ml-auto h-6 w-[64px] text-right"
                            inputMode="numeric"
                            value={n === 0 ? "" : String(n)}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(l.remainingQty, Number(e.target.value.replace(/\D/g, "")) || 0));
                              setQty((q) => ({ ...q, [l.id]: v }));
                            }}
                          />
                        )}
                      </td>
                      <td className="py-1.5 text-center">
                        {l.restockable && !spent ? (
                          <input
                            type="checkbox"
                            checked={!!restock[l.id]}
                            onChange={(e) => setRestock((r) => ({ ...r, [l.id]: e.target.checked }))}
                          />
                        ) : (
                          <span className="text-[10px] text-subtle">{t("common.dash")}</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{formatCents(l.totalCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {peek.anythingLeft ? (
          <div className="border-t border-line px-4 py-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("refund.method")}>
                <SelectInput value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(METHOD_KEY[m])}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Field label={t("refund.reason")} required error={err.error ?? undefined}>
                <TextInput requiredStyle value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
              </Field>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="text-[12px] font-semibold">{t("refund.amount")}</span>
              <span className="font-mono text-[15px] font-bold tabular-nums">{formatCents(totalCents)}</span>
            </div>
            {method === "cash" ? (
              <div className="mt-0.5 text-[10px] text-subtle">{t("refund.cashNote")}</div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line-strong px-4 py-2.5">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          {peek.anythingLeft ? (
            <AccentButton disabled={!valid} onClick={() => void submit()}>
              {t("refund.confirm")}
            </AccentButton>
          ) : null}
        </div>
      </div>
      {approval.modal}
    </div>
  );
}
