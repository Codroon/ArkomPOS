/**
 * Entrada / Salida de efectivo — handoff/cash.md §3c.
 *
 * The amount is always entered POSITIVE and the direction is the dialog, never a
 * minus sign the cashier types: a `-200` in a field labelled *Salida* is a bug
 * waiting to happen.
 *
 * Above the settings threshold the call comes back APPROVAL_REQUIRED and the
 * existing modal takes over — no new mechanism (ADR-0012 §5).
 */
import { useEffect, useMemo, useState } from "react";
import { formatCents, parseMoneyInput, type CashMovementsResponse } from "@arkom/core";
import { AccentButton, Field, GhostButton, TextInput, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { useApprovalFlow } from "../../lib/use-approval";

export function ManualMovementDialog({
  direction,
  onCancel,
  onDone,
}: {
  direction: "in" | "out";
  onCancel: () => void;
  onDone: (next: CashMovementsResponse) => void;
}) {
  const t = useT();
  const approval = useApprovalFlow();
  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [presets, setPresets] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.arkom
      .invoke("settings:get")
      .then((s) => {
        setPresets(s.cashConcepts);
        setThreshold(s.cashMovementApprovalCents);
      })
      .catch((err) => console.error("settings:get failed", err));
  }, []);

  const cents = useMemo(() => parseMoneyInput(amount), [amount]);
  const valid = cents !== null && cents > 0 && concept.trim() !== "";
  const willNeedApproval = threshold !== null && cents !== null && cents > threshold;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload = { amountCents: cents, concept: concept.trim() };
      const details = [
        { label: t("cash.mov.amountLabel"), value: formatCents(cents) },
        { label: t("cash.mov.conceptLabel"), value: payload.concept },
      ];
      const next = await approval.run(
        (auth) =>
          direction === "in"
            ? window.arkom.invoke("cash:paidIn", payload, auth)
            : window.arkom.invoke("cash:paidOut", payload, auth),
        "cash.movement_over_threshold",
        {
          title: t(direction === "in" ? "cash.mov.paidInTitle" : "cash.mov.paidOutTitle"),
          details,
        },
      );
      onDone(next);
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
        <div className="w-[420px] rounded-[3px] border border-line-strong bg-card shadow-lg">
          <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">
            {t(direction === "in" ? "cash.mov.paidInTitle" : "cash.mov.paidOutTitle")}
          </div>

          <div className="flex flex-col gap-2.5 px-3.5 py-3">
            <Field label={t("cash.mov.amountLabel")}>
              <TextInput
                mono
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>

            <Field label={t("cash.mov.conceptLabel")} error={error}>
              <TextInput
                placeholder={t("cash.mov.conceptPlaceholder")}
                value={concept}
                onChange={(e) => setConcept(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
            </Field>

            {presets.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setConcept(preset)}
                    className="rounded-[3px] border border-line-strong bg-card px-1.5 py-0.5 text-[10px] text-ink-2 hover:bg-hover"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            ) : null}

            {willNeedApproval ? (
              <div className="text-[11px] leading-snug text-warning-ink">{t("cash.mov.needsApproval")}</div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
            <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
            <AccentButton disabled={!valid || busy} onClick={() => void submit()}>
              {t(direction === "in" ? "cash.mov.recordIn" : "cash.mov.recordOut")}
            </AccentButton>
          </div>
        </div>
      </div>
      {approval.modal}
    </>
  );
}
