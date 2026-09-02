/**
 * La ficha — handoff/repairs.md §3.
 *
 * Left column: what it is. Right column: what can be done to it.
 *
 * The right column renders **only the actions the facts allow**, and when one is
 * missing it says which fact is missing rather than showing a dead button. Both
 * halves come from `detail.actions`, which main computed with the same core
 * function that will refuse the call — so the buttons drawn here and the actions
 * main accepts cannot disagree (ADR-0014 §1).
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, type RepairDetail, type RepairStatus } from "@arkom/core";
import {
  AccentButton,
  Chip,
  GhostButton,
  SectionLabel,
  SelectInput,
  cn,
  useT,
  type TKey,
} from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { PrintToast } from "../../lib/print-toast";
import { TechnicianPicker, UNASSIGNED, useTechnicians } from "../../components/technician-picker";
import { OverdueChip, StatusChip, STATUS_KEYS, formatDateTime, formatPromised } from "./status-chip";
import { QuotePanel } from "./quote-panel";
import { ApprovalDialog, ReceivePartDialog } from "./repair-dialogs";
import { CollectDialog, NotifyDialog, NotRepairedDialog } from "./handback-dialogs";

const REFUSAL_KEYS: Record<string, TKey> = {
  terminal: "repRefusal.terminal",
  no_lines: "repRefusal.no_lines",
  not_authorized: "repRefusal.not_authorized",
  waiting_part: "repRefusal.waiting_part",
  already_ready: "repRefusal.already_ready",
  not_ready: "repRefusal.not_ready",
  unresolved_parts: "repRefusal.unresolved_parts",
  no_reason: "repRefusal.no_reason",
};

const DAMAGE_KEYS = [
  ["screen", "rep.damage.screen"],
  ["back", "rep.damage.back"],
  ["dents", "rep.damage.dents"],
  ["water", "rep.damage.water"],
] as const;

/** The seven statuses in order — a read-out, never a control. */
const ORDER: RepairStatus[] = [
  "received",
  "quoted",
  "waiting_part",
  "in_repair",
  "ready",
  "collected",
  "not_repaired",
];

export function RepairDetailPane({
  ticketId,
  onBack,
  onChanged,
}: {
  ticketId: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const printer = useTicketPrint();
  const [detail, setDetail] = useState<RepairDetail | null>(null);
  const [photos, setPhotos] = useState<Array<{ id: string; kind: string; dataUrl: string }>>([]);
  const [revealed, setRevealed] = useState(false);
  const [dialog, setDialog] = useState<null | "approve" | "receive" | "collect" | "notify" | "close">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* the assignment dialog: opened deliberately, never a stray click on a select */
  const [assigning, setAssigning] = useState(false);
  const [assignChoice, setAssignChoice] = useState<string>("");
  const technicians = useTechnicians();
  const assignedName = technicians.find((u) => u.id === detail?.assignedUserId)?.name ?? null;

  const load = useCallback(async () => {
    try {
      setDetail(await window.arkom.invoke("repair:get", { ticketId }));
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }, [ticketId, t]);

  useEffect(() => {
    void load();
    // the images come ONCE, not on every mutation — see RepairDetail.photos
    window.arkom
      .invoke("repair:photos", { ticketId })
      .then((r) => setPhotos(r.photos))
      .catch(() => setPhotos([]));
    setRevealed(false);
  }, [ticketId, load]);

  const apply = (next: RepairDetail) => {
    setDetail(next);
    onChanged();
  };

  const reveal = async () => {
    // the value is already here; the call exists to record WHO looked
    try {
      await window.arkom.invoke("repair:revealPasscode", { ticketId });
      setRevealed(true);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  if (!detail) {
    return <div className="px-4 py-6 text-[12px] text-subtle">{error ?? ""}</div>;
  }

  const closed = detail.status === "collected" || detail.status === "not_repaired";
  const refusalText = (key: string | null) => (key ? t(REFUSAL_KEYS[key] ?? "common.dash") : null);
  const marks = DAMAGE_KEYS.filter(([k]) => detail.device.damage[k]);

  /* The primary action changes with the status, and it is the ficha's single
     blue element. What is NOT allowed simply is not rendered; the reason lives
     under the button block. */
  const markReady = async () => {
    try {
      apply(await window.arkom.invoke("repair:markReady", { ticketId }));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const primary =
    detail.actions.collect === null
      ? { label: t("rep.action.collect"), run: () => setDialog("collect") }
      : detail.actions.mark_ready === null
        ? { label: t("rep.action.markReady"), run: () => void markReady() }
        : detail.actions.receive_part === null
          ? { label: t("rep.action.receivePart"), run: () => setDialog("receive") }
          : detail.actions.approve === null
            ? { label: t("rep.action.approve"), run: () => setDialog("approve") }
            : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* header */}
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <GhostButton onClick={onBack}>← {t("rep.detail.back")}</GhostButton>
        <div className="font-mono text-[15px] font-bold">{detail.docNumber}</div>
        <div className="text-[12px] text-ink-2">
          {detail.customer.name} · {detail.device.description}
        </div>
        <StatusChip status={detail.status} />
        {detail.overdue ? <OverdueChip /> : null}
        <div className="flex-1" />
      </div>

      {/* status strip — a read-out; nothing in it is clickable */}
      <div className="flex flex-none items-center gap-1 border-b border-line bg-surface-2 px-4 py-1.5">
        {ORDER.filter((s) => s !== "not_repaired" || detail.status === "not_repaired").map((s) => (
          <span
            key={s}
            className={cn(
              "rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold tracking-[.04em]",
              s === detail.status ? "bg-ink text-inverse-ink" : "text-subtle",
            )}
          >
            {t(STATUS_KEYS[s])}
          </span>
        ))}
        <div className="flex-1" />
        {/* under the strip, the fact that put it there */}
        {detail.approvals[0] ? (
          <div className="text-[10px] text-muted">
            {t("rep.detail.approvedBy", {
              total: formatCents(detail.approvals[0].approvedTotalCents),
              method:
                detail.approvals[0].method === "in_person"
                  ? t("rep.approve.inPerson")
                  : t("rep.approve.byPhone"),
              who: detail.approvals[0].userName ?? "—",
            })}
          </div>
        ) : null}
      </div>

      {notice ? (
        <div className="flex-none border-b border-line bg-success-bg px-4 py-1.5 text-[11px] text-success-ink">
          {notice}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
        {/* ---- left: what it is ---- */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("rep.detail.intake")}</SectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
              <Row label={t("rep.customer.section")} value={`${detail.customer.name} · ${detail.customer.phone}`} />
              <Row label={t("rep.device.description")} value={detail.device.description} />
              <Row label={t("rep.device.imei")} value={detail.device.imei ?? "—"} mono />
              <Row label={t("rep.device.accessories")} value={detail.device.accessories ?? "—"} />
              <Row label={t("rep.device.fault")} value={detail.device.reportedFault} span />
              <Row label={t("rep.device.condition")} value={detail.device.conditionAtIntake ?? "—"} span />
            </div>

            {marks.length > 0 || detail.device.damageNote ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {marks.map(([k, key]) => (
                  <Chip key={k} variant="warning">
                    {t(key)}
                  </Chip>
                ))}
                {detail.device.damageNote ? (
                  <span className="text-[11px] text-ink-2">{detail.device.damageNote}</span>
                ) : null}
              </div>
            ) : null}

            {/* the passcode: masked, and looking at it is itself recorded */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-[.08em] text-subtle">
                {t("rep.device.passcode")}
              </span>
              {detail.devicePasscode === null ? (
                <span className="text-[11px] text-muted">{t("rep.passcode.none")}</span>
              ) : revealed ? (
                <>
                  <span className="font-mono text-[12px]">{detail.devicePasscode}</span>
                  <GhostButton onClick={() => setRevealed(false)}>{t("rep.passcode.hide")}</GhostButton>
                </>
              ) : (
                <>
                  <span className="font-mono text-[12px] tracking-[.2em]">••••</span>
                  <GhostButton onClick={() => void reveal()}>{t("rep.passcode.reveal")}</GhostButton>
                </>
              )}
            </div>

            {photos.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((photo) => (
                  <img
                    key={photo.id}
                    src={photo.dataUrl}
                    alt={photo.kind}
                    className="h-[84px] w-[84px] rounded-[2px] border border-line object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[10px] text-subtle">{t("rep.detail.noPhotos")}</div>
            )}
          </section>

          <QuotePanel detail={detail} onChanged={apply} readOnly={closed} />

          {/* the dispute-settling block: a list, never a single line */}
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("rep.detail.approvals")}</SectionLabel>
            {detail.approvals.length === 0 ? (
              <div className="mt-1.5 text-[11px] text-subtle">{t("rep.detail.noApprovals")}</div>
            ) : (
              <ul className="mt-1.5 text-[12px]">
                {detail.approvals.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 border-b border-line py-1 last:border-b-0">
                    <span className="font-mono tabular-nums font-semibold">
                      {formatCents(a.approvedTotalCents)}
                    </span>
                    <span className="text-ink-2">
                      {a.method === "in_person" ? t("rep.approve.inPerson") : t("rep.approve.byPhone")}
                    </span>
                    <div className="flex-1" />
                    <span className="text-[11px] text-muted">
                      {a.userName ?? "—"} · {formatDateTime(a.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("rep.detail.notices")}</SectionLabel>
            {detail.notifications.length === 0 ? (
              <div className="mt-1.5 text-[11px] text-subtle">{t("rep.detail.noNotices")}</div>
            ) : (
              <ul className="mt-1.5 text-[12px]">
                {detail.notifications.map((n) => (
                  <li key={n.id} className="flex items-center gap-2 border-b border-line py-1 last:border-b-0">
                    <span>{n.method}</span>
                    {n.note ? <span className="text-ink-2">{n.note}</span> : null}
                    <div className="flex-1" />
                    <span className="text-[11px] text-muted">
                      {n.userName ?? "—"} · {formatDateTime(n.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ---- right: what can be done ---- */}
        <div className="flex w-[320px] flex-none flex-col gap-3">
          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("rep.detail.management")}</SectionLabel>
            {/* A VALUE, not a dropdown. An unset select reads as "nobody has
                decided yet" whether or not that is true, and it invited a change
                by accident; assignment is now a fact you read, and changing it
                is a thing you choose to do (ADR-0014 amendment). */}
            <div className="mt-2 flex items-baseline gap-2">
              <div className="text-[11px] text-muted">{t("tech.label")}</div>
              <div className="flex-1 text-[12px] font-medium">
                {assignedName ?? <span className="italic text-subtle">{t("tech.unassigned")}</span>}
              </div>
              {!closed ? (
                <GhostButton onClick={() => setAssigning(true)}>{t("tech.change")}</GhostButton>
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <Row label={t("rep.detail.received")} value={formatDateTime(detail.createdAt)} />
              <Row
                label={t("rep.list.promised")}
                value={formatPromised(detail.promisedAt, detail.promisedHalf, t)}
              />
              <Row label={t("rep.detail.deposit")} value={formatCents(detail.depositCents)} mono />
              <Row
                label={t("rep.detail.warranty")}
                value={t("rep.detail.months", { n: String(detail.warrantyMonths) })}
              />
            </div>
          </section>

          <section className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("rep.detail.actions")}</SectionLabel>

            {primary ? (
              /* the ficha's one blue element */
              <AccentButton className="mt-2 h-9 w-full" onClick={primary.run}>
                {primary.label}
              </AccentButton>
            ) : null}

            <div className="mt-2 flex flex-col gap-1.5">
              {detail.status === "ready" ? (
                <GhostButton onClick={() => setDialog("notify")}>{t("rep.action.notify")}</GhostButton>
              ) : null}
              <GhostButton onClick={() => printer.printRepair(ticketId, "intake", true)}>
                {t("rep.action.printIntake")}
              </GhostButton>
              {detail.lines.length > 0 && !closed ? (
                <GhostButton onClick={() => printer.printRepair(ticketId, "quote")}>
                  {t("rep.action.printQuote")}
                </GhostButton>
              ) : null}
              {detail.collectionDocumentId ? (
                <GhostButton onClick={() => printer.printRepair(ticketId, "receipt", true)}>
                  {t("rep.action.printReceipt")}
                </GhostButton>
              ) : null}
              {detail.notRepairedAt ? (
                <GhostButton onClick={() => printer.printRepair(ticketId, "return", true)}>
                  {t("rep.action.printReturn")}
                </GhostButton>
              ) : null}
            </div>

            {/* terminal actions do not sit next to routine ones */}
            {!closed && detail.actions.mark_not_repaired === null ? (
              <button
                type="button"
                onClick={() => setDialog("close")}
                className="mt-3 w-full border-t border-line pt-2 text-[11px] text-danger-ink underline hover:opacity-80"
              >
                {t("rep.action.notRepaired")}
              </button>
            ) : null}

            {/* what is missing, in words — the strip is where a blocked status
                explains itself, not a disabled button with no tooltip */}
            {!closed && primary === null ? (
              <div className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
                <div className="font-semibold">{t("rep.action.blocked")}</div>
                <ul className="mt-0.5 list-inside list-disc">
                  {(["approve", "mark_ready", "collect"] as const)
                    .map((k) => refusalText(detail.actions[k]))
                    .filter((v, i, a) => v !== null && a.indexOf(v) === i)
                    .map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>

          {error ? <div className="text-[11px] text-danger-ink">{error}</div> : null}
        </div>
      </div>

      {dialog === "approve" ? (
        <ApprovalDialog
          totalCents={detail.quoteTotalCents}
          onCancel={() => setDialog(null)}
          onConfirm={async (method) => {
            try {
              apply(await window.arkom.invoke("repair:recordApproval", { ticketId, method }));
              setDialog(null);
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}

      {dialog === "receive" ? (
        <ReceivePartDialog
          lines={detail.lines.filter((l) => l.kind === "part_on_order" && l.receivedAt === null)}
          onCancel={() => setDialog(null)}
          onConfirm={async (input) => {
            try {
              apply(await window.arkom.invoke("repair:receivePart", { ticketId, ...input }));
              setDialog(null);
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}

      {dialog === "notify" ? (
        <NotifyDialog
          onCancel={() => setDialog(null)}
          onConfirm={async (method, note) => {
            try {
              apply(await window.arkom.invoke("repair:notify", { ticketId, method, note }));
              setDialog(null);
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}

      {dialog === "collect" ? (
        <CollectDialog
          detail={detail}
          onCancel={() => setDialog(null)}
          onConfirm={async (tenders) => {
            try {
              const result = await window.arkom.invoke("repair:collect", { ticketId, tenders });
              setDialog(null);
              setNotice(t("rep.collect.done", { doc: result.docNumber }));
              await load();
              onChanged();
              // the receipt is a separate, retryable act — the same bargain
              // every other document in this app makes
              printer.printRepair(ticketId, "receipt");
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}

      {dialog === "close" ? (
        <NotRepairedDialog
          detail={detail}
          onCancel={() => setDialog(null)}
          onConfirm={async (input) => {
            try {
              const result = await window.arkom.invoke("repair:markNotRepaired", { ticketId, ...input });
              setDialog(null);
              setNotice(t("rep.close.done"));
              apply(result.detail);
              printer.printRepair(ticketId, "return");
            } catch (err) {
              setError(errorMessage(t, err));
            }
          }}
        />
      ) : null}

      {assigning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40">
          <div className="w-[380px] rounded-[3px] border border-line-strong bg-card shadow-lg">
            <div className="border-b border-line px-3.5 py-2.5 text-[13px] font-bold">{t("tech.change")}</div>
            <div className="px-3.5 py-3">
              <TechnicianPicker
                mode="assign"
                value={assignChoice || (detail?.assignedUserId ?? UNASSIGNED)}
                onChange={setAssignChoice}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-line px-3.5 py-2.5">
              <GhostButton onClick={() => setAssigning(false)}>{t("common.cancel")}</GhostButton>
              <AccentButton
                onClick={() => {
                  const choice = assignChoice || (detail?.assignedUserId ?? UNASSIGNED);
                  const userId = choice === UNASSIGNED ? null : choice;
                  void window.arkom
                    .invoke("repair:assign", { ticketId, userId })
                    .then((next) => {
                      apply(next);
                      setAssigning(false);
                      setAssignChoice("");
                    })
                    .catch((err) => setError(errorMessage(t, err)));
                }}
              >
                {t("tech.assign")}
              </AccentButton>
            </div>
          </div>
        </div>
      ) : null}
      <PrintToast printer={printer} />
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  span,
}: {
  label: string;
  value: string;
  mono?: boolean;
  span?: boolean;
}) {
  return (
    <div className={cn("flex flex-col", span && "col-span-2")}>
      <span className="text-[10px] font-bold tracking-[.08em] text-subtle">{label}</span>
      <span className={cn("text-[12px]", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  );
}
