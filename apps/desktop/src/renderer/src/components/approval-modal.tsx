/**
 * "Autorización del responsable" (handoff/auth.md §3).
 *
 * The header is the whole point: the owner must be able to judge what they are
 * approving without asking, so the action appears in plain Spanish with its
 * specifics — the product, the old and new price, the reason — never a raw
 * permission key.
 *
 * With exactly one owner the tile is preselected and the keypad is live
 * immediately: the common case should be two taps, not four.
 */
import { useCallback, useEffect, useState } from "react";
import { AuthUsersResponseSchema, type LoginUser } from "@arkom/core";
import { cn, GhostButton, Keypad, useT } from "@arkom/ui";
import { ipcOf } from "../lib/errors";
import { CountdownChip, useCountdown } from "../screens/auth/auth-chrome";
import { formatCountdown } from "../screens/auth/login-screen";

export interface ApprovalDetail {
  label: string;
  value: string;
  /** render the value in mono — prices, codes, IMEIs */
  mono?: boolean;
}

export function ApprovalModal({
  title,
  permissionLabel,
  details,
  onApprove,
  onCancel,
}: {
  title: string;
  permissionLabel: string;
  details: ApprovalDetail[];
  onApprove: (approval: { userId: string; pin: string }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [approvers, setApprovers] = useState<LoginUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);

  const remaining = useCountdown(lockedUntil);
  const locked = remaining > 0;

  useEffect(() => {
    window.arkom
      .invoke("auth:users")
      .then((raw) => {
        // only owners can authorise; a cashier cannot approve for a cashier
        const owners = AuthUsersResponseSchema.parse(raw).filter((u) => u.role === "owner");
        setApprovers(owners);
        if (owners.length === 1 && owners[0]) setSelectedId(owners[0].id);
      })
      .catch((err) => console.error("auth:users failed", err));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  /**
   * The PIN is checked in main, as part of the retried action — this modal
   * never verifies anything itself. It hands the credential up and lets the
   * caller's retry surface the result.
   */
  const submit = useCallback(() => {
    if (!selectedId || locked) return;
    setError(null);
    onApprove({ userId: selectedId, pin });
  }, [selectedId, pin, locked, onApprove]);

  // a failed retry comes back as a re-opened modal; surface why
  useEffect(() => {
    setPin("");
  }, [approvers.length]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-ink/25" onMouseDown={onCancel}>
      <div
        className="w-[420px] rounded-[3px] border border-line-strong bg-card shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-line-strong bg-surface-2 px-4 py-2.5">
          <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("apr.title")}</div>
          <div className="mt-0.5 text-[14px] font-semibold text-ink">{title}</div>
          <div className="text-[10px] text-subtle">{permissionLabel}</div>
        </div>

        {/* what is actually being authorised */}
        <div className="border-b border-line px-4 py-3">
          {details.map((d, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 py-0.5 text-[12px]">
              <span className="text-muted">{d.label}</span>
              <span className={cn("text-right text-ink", d.mono ? "font-mono font-bold tabular-nums" : "font-semibold")}>
                {d.value}
              </span>
            </div>
          ))}
        </div>

        {approvers.length === 0 ? (
          <div className="px-4 py-4 text-[12px] text-danger-ink">{t("apr.noApprover")}</div>
        ) : (
          <div className="flex flex-col items-center px-4 py-3">
            {approvers.length > 1 ? (
              <div className="mb-3 w-full">
                <div className="text-[10px] font-bold uppercase tracking-[.1em] text-muted">{t("apr.who")}</div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {approvers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(u.id);
                        setPin("");
                        setLockedUntil(u.lockedUntilMs && u.lockedUntilMs > Date.now() ? u.lockedUntilMs : null);
                      }}
                      className={cn(
                        "rounded-[3px] border px-2 py-1.5 text-left text-[12px]",
                        u.id === selectedId
                          ? "border-inverse bg-inverse text-inverse-ink"
                          : "border-line-strong bg-card hover:border-ink-2",
                      )}
                    >
                      <div className="truncate font-semibold">{u.name}</div>
                      {u.lockedUntilMs && u.lockedUntilMs > Date.now() ? (
                        <CountdownChip until={u.lockedUntilMs} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Keypad
              value={pin}
              onChange={setPin}
              onSubmit={submit}
              disabled={!selectedId || locked}
              submitLabel={t("apr.authorize")}
              clearLabel={t("auth.keypadClear")}
            />

            <div className="mt-2 h-8 w-full text-center">
              {locked ? (
                <div className="rounded-[3px] border border-warning-ink/25 bg-warning-bg px-2 py-1 text-[11px] font-semibold text-warning-ink">
                  {t("auth.lockedFor", { time: formatCountdown(remaining) })}
                </div>
              ) : error ? (
                <div className="text-[11px] font-semibold text-danger-ink">{error}</div>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-line bg-surface-2 px-4 py-2">
          {/* prominent, because a locked owner would otherwise block the sale */}
          <GhostButton onClick={onCancel}>{t("apr.cancel")}</GhostButton>
        </div>
      </div>
    </div>
  );
}

/** Surface a failed approval attempt on the next open. */
export function approvalErrorMessage(err: unknown, t: (k: never) => string): string | null {
  const ipc = ipcOf(err);
  if (!ipc) return null;
  return ipc.code === "INVALID_PIN" || ipc.code === "USER_LOCKED" ? ipc.message : null;
}
