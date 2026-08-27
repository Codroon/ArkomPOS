/**
 * "He olvidado mi PIN" (handoff/auth.md §1).
 *
 * Two different answers, because there are two different situations:
 * a cashier has an owner standing nearby who can reset it in ten seconds; an
 * owner has only the code they printed when the till was set up.
 */
import { useCallback, useState } from "react";
import { AuthRecoverResponseSchema, type LoginUser } from "@arkom/core";
import { AccentButton, Field, GhostButton, TextInput, useT } from "@arkom/ui";
import { ipcOf } from "../../lib/errors";
import { RecoveryCodeStep } from "./recovery-code-step";

export function ForgotPinFlow({
  user,
  onBack,
  onDone,
}: {
  user: LoginUser | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  const isOwner = user?.role === "owner";

  const submit = useCallback(async () => {
    if (busy || !user) return;
    if (pin !== repeat) {
      setError(t("auth.pinMismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = AuthRecoverResponseSchema.parse(
        await window.arkom.invoke("auth:recover", { userId: user.id, code, newPin: pin }),
      );
      // succeeding issues a FRESH code — the old one is dead from here
      setNewCode(res.recoveryCode);
    } catch (err) {
      const ipc = ipcOf(err);
      setError(ipc?.code === "WEAK_PIN" ? ipc.message : t("auth.recoveryBad"));
      setBusy(false);
    }
  }, [busy, user, pin, repeat, code, t]);

  if (newCode && user) {
    return <RecoveryCodeStep code={newCode} ownerName={user.name} onDone={onDone} />;
  }

  return (
    <div className="w-full max-w-[420px]">
      <h1 className="font-display text-[20px]">{t("auth.forgot")}</h1>

      {!user ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{t("auth.pickUser")}</p>
      ) : !isOwner ? (
        // no field at all: there is nothing a cashier can type that helps
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{t("auth.forgotCashier")}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3 rounded-[3px] border border-line bg-card p-4">
          <p className="text-[11px] leading-snug text-muted">{t("auth.forgotOwner")}</p>

          <Field label={t("auth.recoveryCode")}>
            <TextInput
              autoFocus
              mono
              value={code}
              placeholder="XXXX-XXXX-XXXX"
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("auth.newPin")}>
              <TextInput
                mono
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
            <Field label={t("auth.repeatPin")}>
              <TextInput
                mono
                type="password"
                inputMode="numeric"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
          </div>

          {error ? (
            <div className="rounded-[3px] border border-danger-ink/25 bg-danger-bg px-2 py-1.5 text-[11px] font-semibold text-danger-ink">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <GhostButton onClick={onBack}>{t("auth.back")}</GhostButton>
            <AccentButton disabled={busy || code.length < 8 || pin.length < 4} onClick={() => void submit()}>
              {t("auth.continue")}
            </AccentButton>
          </div>
        </div>
      )}

      {!isOwner ? (
        <div className="mt-4">
          <GhostButton onClick={onBack}>{t("auth.back")}</GhostButton>
        </div>
      ) : null}
    </div>
  );
}
