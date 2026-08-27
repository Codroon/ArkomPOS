/**
 * Owner creation (handoff/auth.md §5).
 *
 * Two entry points, one component:
 *   - a fresh install, right after the shop is created;
 *   - a v0.9.0 till that just updated and has a shop but no users.
 *
 * The second is the one that needs care. The owner is looking at an unfamiliar
 * screen on a till that worked yesterday, so the copy says what happened and
 * that their data is intact BEFORE asking for anything.
 *
 * It cannot be skipped: without a user there is nobody to attribute a sale to.
 */
import { useCallback, useMemo, useState } from "react";
import { SetupOwnerResponseSchema } from "@arkom/core";
import { AccentButton, Field, TextInput, useT } from "@arkom/ui";
import { errorMessage, ipcOf } from "../../lib/errors";
import { AuthFrame } from "./login-screen";
import { RecoveryCodeStep } from "./recovery-code-step";

export function OwnerStep({ upgrade, onDone }: { upgrade: boolean; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ code: string; name: string } | null>(null);

  const problem = useMemo(() => {
    if (!name.trim()) return null;
    if (pin.length < 4) return null;
    if (repeat.length >= 4 && pin !== repeat) return t("auth.pinMismatch");
    return null;
  }, [name, pin, repeat, t]);

  const ready = name.trim().length > 0 && pin.length >= 4 && pin === repeat && !busy;

  const submit = useCallback(async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = SetupOwnerResponseSchema.parse(
        await window.arkom.invoke("setup:owner", { name: name.trim(), pin }),
      );
      setCreated({ code: res.recoveryCode, name: res.user.name });
    } catch (err) {
      const ipc = ipcOf(err);
      setError(ipc?.code === "WEAK_PIN" ? ipc.message : errorMessage(t, err));
      setBusy(false);
    }
  }, [ready, name, pin, t]);

  if (created) {
    return (
      <AuthFrame>
        <RecoveryCodeStep code={created.code} ownerName={created.name} onDone={onDone} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="w-full max-w-[460px]">
        <h1 className="font-display text-[22px] leading-tight">
          {upgrade ? t("own.upgradeTitle") : t("own.title")}
        </h1>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          {upgrade ? t("own.upgradeBody") : t("own.hintFirst")}
        </p>

        <div className="mt-5 flex flex-col gap-3.5 rounded-[3px] border border-line bg-card p-4">
          <Field label={t("own.name")}>
            <TextInput
              autoFocus
              value={name}
              placeholder={t("own.namePlaceholder")}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("auth.newPin")} hint={t("usr.pinWeak")}>
              <TextInput
                mono
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
            <Field label={t("auth.repeatPin")} error={problem}>
              <TextInput
                mono
                type="password"
                inputMode="numeric"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) void submit();
                }}
              />
            </Field>
          </div>

          {error ? (
            <div className="rounded-[3px] border border-danger-ink/25 bg-danger-bg px-2 py-1.5 text-[11px] font-semibold text-danger-ink">
              {error}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end">
          <AccentButton disabled={!ready} onClick={() => void submit()}>
            {busy ? t("own.creating") : t("own.create")}
          </AccentButton>
        </div>
      </div>
    </AuthFrame>
  );
}
