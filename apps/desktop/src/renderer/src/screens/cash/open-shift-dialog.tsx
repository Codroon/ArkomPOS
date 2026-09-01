/**
 * Abrir turno — handoff/cash.md §3a.
 *
 * One field and one button, because ten seconds is the target and anything else
 * on this dialog is a reason to miss it. Reached three ways: the Caja screen,
 * the top-bar chip, and inline from Sale when a charge is refused with
 * SHIFT_REQUIRED — in which case `preamble` explains why it appeared.
 */
import { useEffect, useState } from "react";
import { centsToInput, formatCents, parseMoneyInput, type Breakdown } from "@arkom/core";
import { AccentButton, Field, GhostButton, TextInput, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { DenominationDialog } from "./denomination-dialog";

export function OpenShiftDialog({
  preamble,
  onCancel,
  onOpened,
}: {
  preamble?: string;
  onCancel: () => void;
  onOpened: () => void | Promise<void>;
}) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [counting, setCounting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* the shop's usual float, prefilled — a setting, so the client's answer is
     data rather than a number in the source */
  useEffect(() => {
    window.arkom
      .invoke("settings:get")
      .then((s) => setAmount((prev) => (prev === "" ? centsToInput(s.cashDefaultFloatCents) : prev)))
      .catch((err) => console.error("settings:get failed", err));
  }, []);

  const cents = parseMoneyInput(amount);
  const valid = cents !== null && cents >= 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.arkom.invoke("cash:open", { floatCents: cents, breakdown });
      await onOpened();
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  };

  if (counting) {
    return (
      <DenominationDialog
        initial={breakdown}
        onCancel={() => setCounting(false)}
        onUse={(totalCents, next) => {
          setAmount(centsToInput(totalCents));
          setBreakdown(next);
          setCounting(false);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
      <div className="w-[400px] rounded-[3px] border border-line-strong bg-card shadow-lg">
        <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{t("cash.openTitle")}</div>
        <div className="px-3.5 py-3">
          {preamble ? <div className="mb-2.5 text-[11px] leading-snug text-ink-2">{preamble}</div> : null}

          <Field label={t("cash.float")} hint={t("cash.floatHint")} error={error}>
            <div className="flex items-center gap-2">
              <TextInput
                mono
                autoFocus
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  /* typing over a counted figure retires the breakdown: the two
                     may never disagree, and the domain would refuse the pair */
                  setBreakdown(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && void submit()}
              />
              <GhostButton onClick={() => setCounting(true)}>{t("cash.count")}</GhostButton>
            </div>
          </Field>

          {breakdown && Object.keys(breakdown).length > 0 ? (
            <div className="mt-1.5 font-mono text-[10px] text-muted">
              {t("cash.breakdown")}:{" "}
              {Object.entries(breakdown)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([cents, qty]) => `${qty}×${formatCents(Number(cents)).replace(" €", "")}`)
                .join(" · ")}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          <AccentButton disabled={!valid || busy} onClick={() => void submit()}>
            {t("cash.openShift")}
          </AccentButton>
        </div>
      </div>
    </div>
  );
}
