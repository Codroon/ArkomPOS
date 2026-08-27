/**
 * The lock overlay (handoff/auth.md §2).
 *
 * Covers everything, including modals and drawers, at full Graphite opacity —
 * the till should look switched off from across the shop rather than merely
 * busy. Esc does nothing and focus is trapped: this is a control, not a
 * screensaver, and the IPC guard refuses guarded work while it is up.
 *
 * There are no user tiles. Only the locked user can unlock; the route to a
 * different person is "Cambiar de usuario", which logs out and parks the cart.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ROLE_LABELS_ES, SessionInfoSchema, type SessionInfo } from "@arkom/core";
import { Keypad, useT } from "@arkom/ui";
import { ipcOf } from "../../lib/errors";
import { formatCountdown } from "./login-screen";
import { useCountdown } from "./auth-chrome";

export function LockOverlay({ session, onSwitchUser }: { session: SessionInfo; onSwitchUser: () => void }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const trapRef = useRef<HTMLDivElement>(null);

  const remaining = useCountdown(lockedUntil);
  const locked = remaining > 0;

  // swallow Esc and Tab-out; the overlay owns the keyboard while it is up
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    trapRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      SessionInfoSchema.parse(await window.arkom.invoke("auth:unlock", { pin }));
      // the session and the open cart survive; the shell reappears as it was
    } catch (err) {
      const ipc = ipcOf(err);
      setPin("");
      if (ipc?.code === "USER_LOCKED") {
        setLockedUntil(Date.now() + Number(ipc.message) * 1000);
      } else if (ipc?.code === "INVALID_PIN") {
        const left = Number(ipc.message);
        setError(left === 1 ? t("auth.wrongPinOnce") : t("auth.wrongPin", { n: String(left) }));
      } else {
        setError(ipc?.message ?? String(err));
      }
      setBusy(false);
    }
  }, [busy, pin, t]);

  return (
    <div
      ref={trapRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-inverse text-inverse-ink outline-none"
    >
      <span className="font-display text-[18px] tracking-[.06em]">{t("shell.brand")}</span>
      <div className="mt-6 text-[12px] font-bold uppercase tracking-[.12em] text-inverse-muted">
        {t("lock.title")}
      </div>

      <div className="mt-2 text-center">
        <div className="text-[16px] font-semibold">{session.name}</div>
        <div className="text-[11px] text-inverse-muted">
          {ROLE_LABELS_ES[session.role as keyof typeof ROLE_LABELS_ES] ?? session.role}
        </div>
      </div>

      <div className="mt-6">
        <Keypad
          tone="dark"
          value={pin}
          onChange={setPin}
          onSubmit={() => void submit()}
          disabled={locked}
          busy={busy}
          submitLabel={t("lock.unlock")}
          clearLabel={t("auth.keypadClear")}
        />
      </div>

      <div className="mt-3 h-9 w-[264px] text-center">
        {locked ? (
          <div className="rounded-[3px] border border-warning-ink/40 bg-warning-bg px-2 py-1.5 text-[11px] font-semibold text-warning-ink">
            {t("auth.lockedFor", { time: formatCountdown(remaining) })}
          </div>
        ) : error ? (
          <div className="rounded-[3px] border border-danger-ink/40 bg-danger-bg px-2 py-1.5 text-[11px] font-semibold text-danger-ink">
            {error}
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onSwitchUser}
        className="mt-2 text-[11px] text-inverse-muted underline-offset-2 hover:text-inverse-ink hover:underline"
      >
        {t("lock.switchUser")}
      </button>
    </div>
  );
}
