/**
 * Login — the shop's front door (handoff/auth.md §1).
 *
 * Tiles rather than a name field because the shop has two to five staff and
 * typing a username between customers is friction with no security value: the
 * PIN is the secret, the name is not.
 *
 * Spanish only. The ES/EN toggle belongs to the shell, which has not loaded
 * yet, and the first thing a Spanish shop sees should not be English.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AuthUsersResponseSchema,
  ROLE_LABELS_ES,
  SessionInfoSchema,
  type LoginUser,
} from "@arkom/core";
import { cn, Keypad, useT } from "@arkom/ui";
import { ipcOf } from "../../lib/errors";
import { BrandPlate, CountdownChip, useCountdown } from "./auth-chrome";
import { ForgotPinFlow } from "./forgot-pin";

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useT();
  const [users, setUsers] = useState<LoginUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [forgot, setForgot] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = AuthUsersResponseSchema.parse(await window.arkom.invoke("auth:users"));
      setUsers(rows);
      // one user means one tap saved, every single time
      if (rows.length === 1 && rows[0]) setSelectedId(rows[0].id);
    } catch (err) {
      console.error("auth:users failed", err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = users.find((u) => u.id === selectedId) ?? null;
  const remaining = useCountdown(lockedUntil);
  const locked = remaining > 0;

  const pick = (user: LoginUser) => {
    setSelectedId(user.id);
    setPin("");
    setError(null);
    setLockedUntil(user.lockedUntilMs && user.lockedUntilMs > Date.now() ? user.lockedUntilMs : null);
  };

  const submit = useCallback(async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      SessionInfoSchema.parse(await window.arkom.invoke("auth:login", { userId: selectedId, pin }));
      onSignedIn();
    } catch (err) {
      const ipc = ipcOf(err);
      setPin("");
      if (ipc?.code === "USER_LOCKED") {
        // the message carries seconds; the countdown owns the display
        setLockedUntil(Date.now() + Number(ipc.message) * 1000);
        setError(null);
      } else if (ipc?.code === "INVALID_PIN") {
        const left = Number(ipc.message);
        setError(
          Number.isFinite(left) && left === 1
            ? t("auth.wrongPinOnce")
            : t("auth.wrongPin", { n: String(Number.isFinite(left) ? left : 0) }),
        );
      } else {
        setError(ipc?.message ?? String(err));
      }
      setBusy(false);
      void load(); // refresh lock state on the tiles
    }
  }, [selectedId, pin, busy, onSignedIn, t, load]);

  if (forgot) {
    return (
      <AuthFrame>
        <ForgotPinFlow user={selected} onBack={() => setForgot(false)} onDone={() => { setForgot(false); void load(); }} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="grid w-full max-w-[720px] grid-cols-[1fr_auto] gap-10">
        {/* ---- who ---- */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[.12em] text-muted">{t("auth.who")}</div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => pick(u)}
                className={cn(
                  "rounded-[3px] border px-3 py-2.5 text-left transition-colors",
                  // selected inverts to graphite — never blue, that belongs to confirm
                  u.id === selectedId
                    ? "border-inverse bg-inverse text-inverse-ink"
                    : "border-line-strong bg-card text-ink hover:border-ink-2",
                )}
              >
                <div className="truncate text-[13px] font-semibold">{u.name}</div>
                <div
                  className={cn(
                    "mt-0.5 text-[10px] font-bold uppercase tracking-[.08em]",
                    u.id === selectedId ? "text-inverse-muted" : "text-muted",
                  )}
                >
                  {ROLE_LABELS_ES[u.role as keyof typeof ROLE_LABELS_ES] ?? u.role}
                </div>
                {u.lockedUntilMs && u.lockedUntilMs > Date.now() ? (
                  <div className="mt-1">
                    <CountdownChip until={u.lockedUntilMs} />
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* ---- the keypad ---- */}
        <div className="flex flex-col items-center">
          <Keypad
            value={pin}
            onChange={setPin}
            onSubmit={() => void submit()}
            disabled={!selectedId || locked}
            busy={busy}
            submitLabel={busy ? t("auth.entering") : t("auth.enter")}
            clearLabel={t("auth.keypadClear")}
          />

          <div className="mt-3 h-10 w-[264px] text-center">
            {locked ? (
              <div className="rounded-[3px] border border-warning-ink/25 bg-warning-bg px-2 py-1.5 text-[11px] font-semibold text-warning-ink">
                {t("auth.lockedFor", { time: formatCountdown(remaining) })}
              </div>
            ) : error ? (
              <div className="rounded-[3px] border border-danger-ink/25 bg-danger-bg px-2 py-1.5 text-[11px] font-semibold text-danger-ink">
                {error}
              </div>
            ) : !selectedId ? (
              <div className="text-[11px] text-subtle">{t("auth.pickUser")}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setForgot(true)}
            className="mt-1 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {t("auth.forgot")}
          </button>
        </div>
      </div>
    </AuthFrame>
  );
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Brand plate on top, content centred — shared by Login and the setup steps. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[860px] flex-col bg-canvas text-ink">
      <BrandPlate />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">{children}</div>
      <ShopFooter />
    </div>
  );
}

/** Shop name and version, bottom-left — this is how a support call starts. */
function ShopFooter() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    window.arkom
      .invoke("meta:context")
      .then((raw) => {
        const ctx = raw as { tenant: { name: string } };
        setLabel(ctx.tenant.name);
      })
      .catch(() => setLabel(""));
  }, []);
  return (
    <div className="flex-none px-4 py-2 font-mono text-[10px] text-subtle">
      {label ? `${label} · ` : ""}v{__APP_VERSION__}
    </div>
  );
}
