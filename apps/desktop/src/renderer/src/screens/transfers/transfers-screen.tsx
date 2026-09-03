/**
 * Transferencias — the Western Union counter (ADR-0018).
 *
 * A shadow log. WU's own terminal did the transfer; this screen records what it
 * did so the drawer, the Z and next round's reconciliation have something to
 * agree with. Nothing here issues a document or touches a sales figure.
 *
 * The list defaults to THIS SHIFT, because the question at a counter is "what
 * have I done since I opened", not "what has this shop ever done".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCents, parseMoneyInput, type TransferRow } from "@arkom/core";
import {
  AccentButton,
  Chip,
  Field,
  GhostButton,
  PrimaryButton,
  SearchInput,
  SectionLabel,
  SelectInput,
  TextInput,
  cn,
  useFieldError,
  useT,
  type TKey,
} from "@arkom/ui";
import { errorMessage, ipcOf } from "../../lib/errors";
import { useApprovalFlow } from "../../lib/use-approval";
import { COUNTRIES } from "./countries";

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_KEY: Record<string, TKey> = {
  sent: "tr.status.sent",
  paid: "tr.status.paid",
  cancelled: "tr.status.cancelled",
};

export function TransfersScreen() {
  const t = useT();
  const approval = useApprovalFlow();

  const [rows, setRows] = useState<TransferRow[] | null>(null);
  const [drawerCents, setDrawerCents] = useState(0);
  const [scope, setScope] = useState<"shift" | "all">("shift");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"send" | "payout" | null>(null);
  const [peek, setPeek] = useState<TransferRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await window.arkom.invoke("transfer:list", {
        scope,
        kind: kind || null,
        search: search.trim() || null,
      });
      setRows(res.rows);
      setDrawerCents(res.drawerCents);
    } catch (err) {
      console.error("transfer:list failed", err);
      setRows([]);
    }
  }, [scope, kind, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const done = (message: string) => {
    setDialog(null);
    setToast(message);
    void refresh();
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-baseline gap-2 border-b border-line-strong bg-surface-2 px-4 py-2.5">
        <h1 className="text-[15px] font-semibold">{t("tr.title")}</h1>
        <span className="text-[11px] text-subtle">{t("tr.subtitle")}</span>
        <div className="flex-1" />
        <div className="text-[11px] text-subtle">
          {t("tr.drawerEffect")}{" "}
          <span className="font-mono font-bold tabular-nums text-ink">{formatCents(drawerCents)}</span>
        </div>
        <GhostButton onClick={() => setDialog("payout")}>{t("tr.logPayout")}</GhostButton>
        <PrimaryButton onClick={() => setDialog("send")}>{t("tr.logSend")}</PrimaryButton>
      </div>

      <div className="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
        <SelectInput
          className="h-6 w-[150px] text-[11px]"
          value={scope}
          onChange={(e) => setScope(e.target.value as "shift" | "all")}
        >
          <option value="shift">{t("tr.scope.shift")}</option>
          <option value="all">{t("tr.scope.all")}</option>
        </SelectInput>
        <SelectInput className="h-6 w-[140px] text-[11px]" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t("tr.kind.all")}</option>
          <option value="send">{t("tr.kind.send")}</option>
          <option value="payout">{t("tr.kind.payout")}</option>
        </SelectInput>
        <div className="flex-1" />
        <SearchInput
          className="w-[280px]"
          placeholder={t("tr.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? null : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px] text-muted">{t("tr.empty")}</div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-4 py-1.5 text-left">{t("tr.col.when")}</th>
                <th className="px-2 py-1.5 text-left">{t("tr.col.mtcn")}</th>
                <th className="px-2 py-1.5 text-left">{t("tr.col.kind")}</th>
                <th className="px-2 py-1.5 text-left">{t("tr.col.parties")}</th>
                <th className="px-2 py-1.5 text-right">{t("tr.col.principal")}</th>
                <th className="px-2 py-1.5 text-right">{t("tr.col.fee")}</th>
                <th className="px-2 py-1.5 text-right">{t("tr.col.drawer")}</th>
                <th className="px-2 py-1.5 text-left">{t("tr.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setPeek(r)}
                  className={cn(
                    "cursor-pointer border-b border-line hover:bg-surface",
                    r.status === "cancelled" && "text-muted line-through",
                  )}
                >
                  <td className="px-4 py-1.5 font-mono tabular-nums text-ink-2">{stamp(r.createdAtMs)}</td>
                  <td className="px-2 py-1.5 font-mono tabular-nums">{r.mtcn}</td>
                  <td className="px-2 py-1.5">
                    {t(r.kind === "send" ? "tr.kind.send" : "tr.kind.payout")}
                    <span className="ml-1 text-[10px] text-subtle">{r.countryCode}</span>
                  </td>
                  <td className="px-2 py-1.5 truncate">
                    {r.senderName} → {r.receiverName}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatCents(r.principalCents)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-2">
                    {r.feeCents === 0 ? t("common.dash") : formatCents(r.feeCents)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                    {r.status === "cancelled" ? t("common.dash") : formatCents(r.drawerCents)}
                  </td>
                  <td className="px-2 py-1.5">
                    <Chip variant={r.status === "cancelled" ? "danger" : "success"}>{t(STATUS_KEY[r.status]!)}</Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* the principal is not revenue, said on the screen and not only in an ADR */}
      <div className="flex-none border-t border-line bg-surface-2 px-4 py-1.5 text-[10px] text-subtle">
        {t("tr.footNote")}
      </div>

      {dialog === "send" ? <SendDialog onCancel={() => setDialog(null)} onDone={done} /> : null}
      {dialog === "payout" ? <PayoutDialog onCancel={() => setDialog(null)} onDone={done} /> : null}
      {peek ? (
        <PeekModal
          row={peek}
          approval={approval}
          onClose={() => setPeek(null)}
          onCancelled={(m) => {
            setPeek(null);
            done(m);
          }}
        />
      ) : null}
      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-[3px] border border-line-strong bg-card px-3 py-2 text-[12px] shadow-lg">
          {toast}
        </div>
      ) : null}
      {approval.modal}
    </div>
  );
}

/* ------------------------------------------------------------- dialogs */

function Modal({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
      <div className="w-[520px] rounded-[3px] border border-line-strong bg-card px-4 py-3.5 shadow-lg">
        <div className="mb-2 text-[13px] font-bold">{title}</div>
        {children}
      </div>
    </div>
  );
}

function CountryField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label} required>
      <SelectInput requiredStyle value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}

function SendDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (m: string) => void }) {
  const t = useT();
  const [mtcn, setMtcn] = useState("");
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [country, setCountry] = useState("");
  const [principal, setPrincipal] = useState("");
  const [fee, setFee] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [busy, setBusy] = useState(false);
  const err = useFieldError(`${mtcn}|${principal}|${fee}`);

  const principalCents = parseMoneyInput(principal);
  /* blank fee means zero, which is ordinary business on plenty of corridors */
  const feeCents = fee.trim() === "" ? 0 : parseMoneyInput(fee);
  const valid =
    /^\d{10}$/.test(mtcn.replace(/[\s-]/g, "")) &&
    sender.trim() !== "" &&
    receiver.trim() !== "" &&
    country !== "" &&
    principalCents !== null &&
    principalCents > 0 &&
    feeCents !== null;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    err.clear();
    try {
      await window.arkom.invoke("transfer:send", {
        mtcn,
        senderName: sender.trim(),
        receiverName: receiver.trim(),
        countryCode: country,
        principalCents: principalCents!,
        feeCents: feeCents!,
        method,
      });
      onDone(t("tr.toast.sent"));
    } catch (e) {
      err.fail(ipcOf(e)?.code === "DUPLICATE_MTCN" ? t("err.duplicateMtcn") : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("tr.send.title")}>
      <Field label={t("tr.field.mtcn")} required error={err.error ?? undefined}>
        <TextInput mono requiredStyle autoFocus value={mtcn} onChange={(e) => setMtcn(e.target.value)} maxLength={20} />
      </Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label={t("tr.field.sender")} required>
          <TextInput requiredStyle value={sender} onChange={(e) => setSender(e.target.value)} />
        </Field>
        <Field label={t("tr.field.receiver")} required>
          <TextInput requiredStyle value={receiver} onChange={(e) => setReceiver(e.target.value)} />
        </Field>
        <CountryField value={country} onChange={setCountry} label={t("tr.field.destination")} />
        <Field label={t("tr.field.method")}>
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value as "cash" | "card")}>
            <option value="cash">{t("pay.cash")}</option>
            <option value="card">{t("pay.card")}</option>
          </SelectInput>
        </Field>
        <Field label={t("tr.field.principal")} required>
          <TextInput mono requiredStyle inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
        </Field>
        <Field label={t("tr.field.fee")} hint={t("tr.field.feeHint")}>
          <TextInput mono inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
      </div>
      <div className="mt-2 text-[11px] text-ink-2">
        {t("tr.send.drawerNote")}{" "}
        <span className="font-mono font-bold tabular-nums">
          {method === "cash" ? formatCents((principalCents ?? 0) + (feeCents ?? 0)) : formatCents(0)}
        </span>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton disabled={!valid || busy} onClick={() => void submit()}>
          {t("tr.send.confirm")}
        </AccentButton>
      </div>
    </Modal>
  );
}

function PayoutDialog({ onCancel, onDone }: { onCancel: () => void; onDone: (m: string) => void }) {
  const t = useT();
  const [mtcn, setMtcn] = useState("");
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [country, setCountry] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<{ expectedCashCents: number; amountCents: number } | null>(null);
  const err = useFieldError(`${mtcn}|${amount}`);

  const cents = parseMoneyInput(amount);
  const valid =
    /^\d{10}$/.test(mtcn.replace(/[\s-]/g, "")) &&
    sender.trim() !== "" &&
    receiver.trim() !== "" &&
    country !== "" &&
    cents !== null &&
    cents > 0;

  const submit = async (confirmedOverDrawer = false) => {
    if (!valid || busy) return;
    setBusy(true);
    err.clear();
    try {
      const res = await window.arkom.invoke("transfer:payout", {
        mtcn,
        senderName: sender.trim(),
        receiverName: receiver.trim(),
        countryCode: country,
        principalCents: cents!,
        confirmedOverDrawer,
      });
      if (res.kind === "overDrawerWarning") {
        setWarning({ expectedCashCents: res.expectedCashCents, amountCents: res.amountCents });
        return;
      }
      onDone(t("tr.toast.paid"));
    } catch (e) {
      err.fail(ipcOf(e)?.code === "DUPLICATE_MTCN" ? t("err.duplicateMtcn") : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  if (warning) {
    return (
      <Modal title={t("tr.overDrawer.title")}>
        {/* Not a refusal: WU has authorised the payment and the shop may have a
            second cash box. It says what it knows and lets a human decide. */}
        <div className="text-[12px] text-ink-2">{t("tr.overDrawer.body")}</div>
        <div className="mt-2 rounded-[3px] border border-line bg-surface px-3 py-2">
          <div className="flex justify-between text-[12px]">
            <span>{t("tr.overDrawer.expected")}</span>
            <span className="font-mono font-bold tabular-nums">{formatCents(warning.expectedCashCents)}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span>{t("tr.overDrawer.amount")}</span>
            <span className="font-mono font-bold tabular-nums">{formatCents(warning.amountCents)}</span>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
          <AccentButton
            disabled={busy}
            onClick={() => {
              setWarning(null);
              void submit(true);
            }}
          >
            {t("tr.overDrawer.confirm")}
          </AccentButton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("tr.payout.title")}>
      <Field label={t("tr.field.mtcn")} required error={err.error ?? undefined}>
        <TextInput mono requiredStyle autoFocus value={mtcn} onChange={(e) => setMtcn(e.target.value)} maxLength={20} />
      </Field>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Field label={t("tr.field.receiver")} required>
          <TextInput requiredStyle value={receiver} onChange={(e) => setReceiver(e.target.value)} />
        </Field>
        <Field label={t("tr.field.sender")} required>
          <TextInput requiredStyle value={sender} onChange={(e) => setSender(e.target.value)} />
        </Field>
        <CountryField value={country} onChange={setCountry} label={t("tr.field.origin")} />
        <Field label={t("tr.field.amount")} required>
          <TextInput mono requiredStyle inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <GhostButton onClick={onCancel}>{t("common.cancel")}</GhostButton>
        <AccentButton disabled={!valid || busy} onClick={() => void submit()}>
          {t("tr.payout.confirm")}
        </AccentButton>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- peek */

function PeekModal({
  row,
  approval,
  onClose,
  onCancelled,
}: {
  row: TransferRow;
  approval: ReturnType<typeof useApprovalFlow>;
  onClose: () => void;
  onCancelled: (message: string) => void;
}) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const err = useFieldError(reason);

  const country = useMemo(() => COUNTRIES.find((c) => c.code === row.countryCode)?.name ?? row.countryCode, [row]);

  const doCancel = async () => {
    if (reason.trim() === "" || busy) return;
    setBusy(true);
    err.clear();
    try {
      await approval.run(
        (auth) => window.arkom.invoke("transfer:cancel", { id: row.id, reason: reason.trim() }, auth),
        "transfers.cancel",
        {
          title: t("tr.cancel.confirm"),
          details: [
            { label: t("tr.field.mtcn"), value: row.mtcn },
            { label: t("tr.field.principal"), value: formatCents(row.principalCents) },
            { label: t("tr.cancel.willReverse"), value: formatCents(-row.drawerCents) },
          ],
        },
      );
      onCancelled(t("tr.toast.cancelled"));
    } catch (e) {
      err.fail(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-[12px]">
      <span className="text-ink-2">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40" onClick={onClose}>
      <div
        className="w-[460px] rounded-[3px] border border-line-strong bg-card px-4 py-3.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <div className="text-[13px] font-bold">{t(row.kind === "send" ? "tr.kind.send" : "tr.kind.payout")}</div>
          <div className="font-mono text-[12px] font-bold tabular-nums">{row.mtcn}</div>
          <div className="flex-1" />
          <Chip variant={row.status === "cancelled" ? "danger" : "success"}>{t(STATUS_KEY[row.status]!)}</Chip>
        </div>

        <SectionLabel>{t("tr.peek.detail")}</SectionLabel>
        <Row label={t("tr.field.sender")} value={row.senderName} />
        <Row label={t("tr.field.receiver")} value={row.receiverName} />
        <Row label={t(row.kind === "send" ? "tr.field.destination" : "tr.field.origin")} value={country} />
        <Row label={t("tr.field.principal")} value={formatCents(row.principalCents)} />
        <Row label={t("tr.field.fee")} value={formatCents(row.feeCents)} />
        {row.method ? <Row label={t("tr.field.method")} value={t(row.method === "cash" ? "pay.cash" : "pay.card")} /> : null}
        <Row label={t("tr.col.drawer")} value={formatCents(row.status === "cancelled" ? 0 : row.drawerCents)} />
        <Row label={t("tr.peek.loggedBy")} value={`${stamp(row.createdAtMs)} · ${row.userName ?? t("common.dash")}`} />
        {row.cancelledAtMs !== null ? (
          <>
            <Row
              label={t("tr.peek.cancelledBy")}
              value={`${stamp(row.cancelledAtMs)} · ${row.cancelledByName ?? t("common.dash")}`}
            />
            <Row label={t("tr.peek.reason")} value={row.cancelReason ?? t("common.dash")} />
          </>
        ) : null}

        {cancelling ? (
          <div className="mt-3 border-t border-line pt-2.5">
            <Field label={t("tr.cancel.reason")} required error={err.error ?? undefined}>
              <TextInput autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </Field>
            <div className="mt-1 text-[11px] text-ink-2">
              {t("tr.cancel.willReverse")}{" "}
              <span className="font-mono font-bold tabular-nums">{formatCents(-row.drawerCents)}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <GhostButton onClick={onClose}>{t("common.close")}</GhostButton>
          {row.status !== "cancelled" ? (
            cancelling ? (
              <AccentButton disabled={reason.trim() === "" || busy} onClick={() => void doCancel()}>
                {t("tr.cancel.confirm")}
              </AccentButton>
            ) : (
              <AccentButton onClick={() => setCancelling(true)}>{t("tr.cancel.start")}</AccentButton>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
