/**
 * Usuarios (handoff/auth.md §4) — owner only.
 *
 * Two panes like Catálogo: who exists on the left, what they may do on the
 * right. The override toggles are rendered FROM THE REGISTRY, grouped by
 * module, which is the property that makes ADR-0012's Rule 2 true: a new
 * permission key appears here with no change to this file.
 *
 * Users are deactivated, never deleted — documents and oplog rows point at
 * them, and a sale from March must still say who rang it up.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PERMISSIONS,
  PERMISSION_MODULES,
  ROLE_LABELS_ES,
  UserRowSchema,
  UsersListResponseSchema,
  isRoleDefault,
  type PermissionModule,
  type UserRow,
} from "@arkom/core";
import {
  AccentButton,
  Chip,
  cn,
  Field,
  GhostButton,
  PrimaryButton,
  SectionLabel,
  Segmented,
  Switch,
  TextInput,
  Toast,
  useT,
} from "@arkom/ui";
import { errorMessage, ipcOf } from "../../lib/errors";
import { useSession } from "../../lib/use-session";
import { RecoveryCodeStep } from "../auth/recovery-code-step";

const MODULE_LABELS: Record<PermissionModule, string> = {
  sale: "Venta",
  catalog: "Catálogo",
  inventory: "Inventario",
  admin: "Administración",
};

interface Draft {
  id: string | null;
  name: string;
  role: string;
  overrides: Record<string, boolean>;
  active: boolean;
  pin: string;
  pinRepeat: string;
}

const blank = (): Draft => ({
  id: null,
  name: "",
  role: "cashier",
  overrides: {},
  active: true,
  pin: "",
  pinRepeat: "",
});

const fromRow = (u: UserRow): Draft => ({
  id: u.id,
  name: u.name,
  role: u.role,
  overrides: { ...u.overrides },
  active: u.active,
  pin: "",
  pinRepeat: "",
});

function formatWhen(ms: number | null, never: string): string {
  if (!ms) return never;
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function UsersScreen() {
  const t = useT();
  const { session } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "neutral" | "danger" } | null>(null);
  const [newCode, setNewCode] = useState<{ code: string; name: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  const say = useCallback((message: string, tone: "neutral" | "danger" = "neutral") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUsers(UsersListResponseSchema.parse(await window.arkom.invoke("users:list")));
    } catch (err) {
      console.error("users:list failed", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isOwnerDraft = draft?.role === "owner";
  const isSelf = draft?.id !== null && draft?.id === session?.userId;

  const ready = useMemo(() => {
    if (!draft) return false;
    if (!draft.name.trim()) return false;
    // a new user needs a PIN; an existing one changes it through Restablecer
    if (!draft.id && (draft.pin.length < 4 || draft.pin !== draft.pinRepeat)) return false;
    return true;
  }, [draft]);

  const save = useCallback(async () => {
    if (!draft || !ready) return;
    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        UserRowSchema.parse(
          await window.arkom.invoke("users:update", {
            id: draft.id,
            name: draft.name.trim(),
            role: draft.role,
            overrides: draft.overrides,
            active: draft.active,
          }),
        );
      } else {
        const res = (await window.arkom.invoke("users:create", {
          name: draft.name.trim(),
          role: draft.role,
          pin: draft.pin,
          overrides: draft.overrides,
        })) as { user: UserRow; recoveryCode: string | null };
        // a new owner's code is shown once, right here, before anything else
        if (res.recoveryCode) setNewCode({ code: res.recoveryCode, name: res.user.name });
      }
      await refresh();
      setDraft(null);
      say(t("usr.saved"));
    } catch (err) {
      const ipc = ipcOf(err);
      setError(ipc?.code === "WEAK_PIN" || ipc?.code === "LAST_OWNER" ? ipc.message : errorMessage(t, err));
    } finally {
      setSaving(false);
    }
  }, [draft, ready, refresh, say, t]);

  const resetPin = useCallback(
    async (newPin: string, currentPin?: string) => {
      if (!draft?.id) return;
      try {
        await window.arkom.invoke("users:resetPin", { id: draft.id, newPin, currentPin });
        setResetting(false);
        say(t("usr.saved"));
      } catch (err) {
        const ipc = ipcOf(err);
        setError(ipc?.code === "WEAK_PIN" ? ipc.message : errorMessage(t, err));
      }
    },
    [draft, say, t],
  );

  if (newCode) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <RecoveryCodeStep code={newCode.code} ownerName={newCode.name} onDone={() => setNewCode(null)} />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-none items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">{t("usr.title")}</h1>
        <span className="text-[11px] text-muted">{t("usr.subtitle")}</span>
        <div className="flex-1" />
        <PrimaryButton onClick={() => setDraft(blank())}>{t("usr.new")}</PrimaryButton>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_460px]">
        {/* ---- list ---- */}
        <div className="min-h-0 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[.08em] text-muted">
              <tr>
                <th className="px-4 py-2 text-left">{t("usr.name")}</th>
                <th className="px-4 py-2 text-left">{t("usr.role")}</th>
                <th className="px-4 py-2 text-left">{t("usr.status")}</th>
                <th className="px-4 py-2 text-left">{t("usr.lastLogin")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setDraft(fromRow(u))}
                  className={cn(
                    "cursor-pointer border-b border-line hover:bg-hover",
                    draft?.id === u.id ? "bg-row-selected" : "",
                    // inactive users stay listed: history points at them
                    !u.active ? "text-subtle" : "",
                  )}
                >
                  <td className="px-4 py-2 font-semibold">{u.name}</td>
                  <td className="px-4 py-2">{ROLE_LABELS_ES[u.role as keyof typeof ROLE_LABELS_ES] ?? u.role}</td>
                  <td className="px-4 py-2">
                    {u.active ? (
                      <span className="text-muted">{t("usr.active")}</span>
                    ) : (
                      <Chip variant="neutral">{t("usr.inactive")}</Chip>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px] tabular-nums text-muted">
                    {formatWhen(u.lastLoginAtMs, t("usr.never"))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ---- editor ---- */}
        <div className="min-h-0 overflow-y-auto border-l border-line-strong bg-surface p-4">
          {!draft ? (
            <div className="pt-10 text-center text-[12px] text-subtle">{t("usr.selectHint")}</div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label={t("usr.name")}>
                <TextInput
                  autoFocus
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>

              <Field label={t("usr.role")}>
                <Segmented
                  options={[
                    { value: "owner", label: ROLE_LABELS_ES.owner },
                    { value: "cashier", label: ROLE_LABELS_ES.cashier },
                  ]}
                  value={draft.role}
                  onChange={(v) => setDraft({ ...draft, role: v })}
                />
              </Field>

              {!draft.id ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("auth.newPin")} hint={t("usr.pinWeak")}>
                    <TextInput
                      mono
                      type="password"
                      inputMode="numeric"
                      value={draft.pin}
                      onChange={(e) => setDraft({ ...draft, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    />
                  </Field>
                  <Field
                    label={t("auth.repeatPin")}
                    error={
                      draft.pinRepeat.length >= 4 && draft.pin !== draft.pinRepeat ? t("auth.pinMismatch") : null
                    }
                  >
                    <TextInput
                      mono
                      type="password"
                      inputMode="numeric"
                      value={draft.pinRepeat}
                      onChange={(e) => setDraft({ ...draft, pinRepeat: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    />
                  </Field>
                </div>
              ) : (
                <div>
                  <GhostButton onClick={() => setResetting(true)}>{t("usr.resetPin")}</GhostButton>
                </div>
              )}

              {/* ---- permissions, straight from the registry ---- */}
              <div className="flex flex-col gap-3 border-t border-line pt-3">
                <SectionLabel>{t("usr.permissions")}</SectionLabel>
                {isOwnerDraft ? (
                  <div className="rounded-[3px] border border-line bg-surface-2 px-3 py-2 text-[11px] text-muted">
                    {t("usr.ownerAllPermissions")}
                  </div>
                ) : null}

                {PERMISSION_MODULES.map((mod) => {
                  const keys = PERMISSIONS.filter((p) => p.module === mod);
                  if (keys.length === 0) return null;
                  return (
                    <div key={mod}>
                      <div className="text-[10px] font-bold uppercase tracking-[.1em] text-subtle">
                        {MODULE_LABELS[mod]}
                      </div>
                      <div className="mt-1 flex flex-col gap-1">
                        {keys.map((p) => {
                          const override = draft.overrides[p.key];
                          const byDefault = isRoleDefault(draft.role, p.key);
                          const on = typeof override === "boolean" ? override : byDefault;
                          const state =
                            typeof override !== "boolean"
                              ? t("usr.byDefault")
                              : override
                                ? t("usr.allowed")
                                : t("usr.blocked");
                          return (
                            <div key={p.key} className="flex items-center gap-2 py-0.5">
                              <Switch
                                checked={on}
                                onChange={(next) => {
                                  const overrides = { ...draft.overrides };
                                  // back to "default" when the toggle matches the role
                                  if (next === byDefault) delete overrides[p.key];
                                  else overrides[p.key] = next;
                                  setDraft({ ...draft, overrides });
                                }}
                                label=""
                                className={isOwnerDraft ? "pointer-events-none opacity-40" : ""}
                              />
                              <span className="flex-1 text-[12px]">{p.labelEs}</span>
                              <span className="text-[10px] text-subtle">{state}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {draft.id ? (
                <div className="flex items-center gap-2 border-t border-line pt-3">
                  <Switch
                    checked={draft.active}
                    onChange={(active) => setDraft({ ...draft, active })}
                    label={t("usr.active")}
                  />
                </div>
              ) : null}

              {error ? (
                <div className="rounded-[3px] border border-danger-ink/25 bg-danger-bg px-3 py-2 text-[11px] font-semibold text-danger-ink">
                  {error}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <GhostButton onClick={() => { setDraft(null); setError(null); }}>{t("common.cancel")}</GhostButton>
                {/* the screen's one blue element */}
                <AccentButton disabled={!ready || saving} onClick={() => void save()}>
                  {saving ? t("common.saving") : t("common.save")}
                </AccentButton>
              </div>
            </div>
          )}
        </div>
      </div>

      {resetting && draft?.id ? (
        <ResetPinModal
          requireCurrent={!!isSelf}
          onCancel={() => setResetting(false)}
          onSubmit={(newPin, currentPin) => void resetPin(newPin, currentPin)}
        />
      ) : null}

      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </>
  );
}

/**
 * Changing your OWN PIN needs the current one first — an unattended unlocked
 * till must not let a passer-by take the owner's account (spec G5).
 */
function ResetPinModal({
  requireCurrent,
  onSubmit,
  onCancel,
}: {
  requireCurrent: boolean;
  onSubmit: (newPin: string, currentPin?: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");

  const ready = next.length >= 4 && next === repeat && (!requireCurrent || current.length >= 4);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-ink/25" onMouseDown={onCancel}>
      <div
        className="w-[380px] rounded-[3px] border border-line-strong bg-card p-4 shadow-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-[14px] font-semibold">{t("usr.resetPin")}</div>
        <div className="mt-3 flex flex-col gap-3">
          {requireCurrent ? (
            <Field label={t("usr.currentPin")}>
              <TextInput
                autoFocus
                mono
                type="password"
                inputMode="numeric"
                value={current}
                onChange={(e) => setCurrent(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
          ) : null}
          <Field label={t("auth.newPin")} hint={t("usr.pinWeak")}>
            <TextInput
              autoFocus={!requireCurrent}
              mono
              type="password"
              inputMode="numeric"
              value={next}
              onChange={(e) => setNext(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
          <Field label={t("auth.repeatPin")} error={repeat.length >= 4 && next !== repeat ? t("auth.pinMismatch") : null}>
            <TextInput
              mono
              type="password"
              inputMode="numeric"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          <AccentButton disabled={!ready} onClick={() => onSubmit(next, requireCurrent ? current : undefined)}>
            {t("common.save")}
          </AccentButton>
        </div>
      </div>
    </div>
  );
}
