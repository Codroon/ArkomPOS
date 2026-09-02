/**
 * Caja (nav 09) — handoff/cash.md §2.
 *
 * Two shapes and never a third: no shift open (one panel, one button), or a
 * shift open (the drawer's own record). The movements panel and the close/X
 * panel arrive with their slices; what is here is the shift itself.
 */
import { useEffect, useState } from "react";
import { formatCents } from "@arkom/core";
import { AccentButton, ActionRow, Chip, GhostButton, SectionLabel, useT } from "@arkom/ui";
import { useShift } from "../../lib/use-shift";
import { useCan } from "../../lib/use-session";
import { useTicketPrint } from "../../lib/use-ticket-print";
import { PrintToast } from "../../lib/print-toast";
import { OpenShiftDialog } from "./open-shift-dialog";
import { MovementsPanel } from "./movements-panel";
import { ClosePanel } from "./close-panel";
import { HistoryModal } from "./history-modal";
import { TicketPeekModal } from "../../components/ticket-peek-modal";

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-[12px] font-medium">{children}</div>
    </div>
  );
}

export function CashScreen() {
  const t = useT();
  const { shift, refresh } = useShift();
  const printer = useTicketPrint();
  const can = useCan();
  const [opening, setOpening] = useState(false);
  const [peekDocId, setPeekDocId] = useState<string | null>(null);
  /* the Z just produced — the panel becomes a result rather than vanishing */
  const [closed, setClosed] = useState<{ shiftId: string; zDocNumber: string } | null>(null);
  const [history, setHistory] = useState(false);
  /* bumped by the movements panel so the close panel re-reads its figures */
  const [movementTick, setMovementTick] = useState(0);

  /* re-read on every visit: another window, or the last close, may have moved
     on since this component was last mounted */
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("cash.title")}</div>
        {shift ? (
          <>
            <Chip>{shift.zDocNumber ?? t("cash.provisional")}</Chip>
            <div className="text-[11px] text-subtle">
              {t("cash.shiftOpenSince", { time: stamp(shift.openedAtMs) })}
              {shift.openedByName ? ` · ${shift.openedByName}` : ""}
            </div>
          </>
        ) : (
          <Chip variant="danger">{t("cash.noShift")}</Chip>
        )}
        <div className="flex-1" />
        {can("cash.history") ? (
          <GhostButton onClick={() => setHistory(true)}>{t("cash.history")}</GhostButton>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-3">
        {shift === null ? (
          <div className="mx-auto mt-16 w-[420px] rounded-[3px] border border-line-strong bg-card px-4 py-5 text-center">
            {closed ? (
              /* the shift that just ended, with its number and the paper it
                 produced — the shape the intake and purchase screens use */
              <>
                <div className="text-[13px] font-bold">{t("cash.close.done", { number: closed.zDocNumber })}</div>
                <ActionRow className="mt-3.5">
                  <GhostButton onClick={() => printer.printShift(closed.shiftId, "z", true)}>
                    {t("cash.close.reprint")}
                  </GhostButton>
                  <AccentButton onClick={() => setOpening(true)}>{t("cash.close.newShift")}</AccentButton>
                </ActionRow>
              </>
            ) : (
              <>
                <div className="text-[13px] font-bold">{t("cash.noShiftTitle")}</div>
                <div className="mt-1.5 text-[11px] leading-snug text-muted">{t("cash.noShiftBody")}</div>
                <div className="mt-3.5 flex justify-center">
                  <AccentButton onClick={() => setOpening(true)}>{t("cash.openShift")}</AccentButton>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
          <div className="flex w-[380px] flex-none flex-col gap-3">
          <div className="rounded-[3px] border border-line-strong bg-card px-3 py-2.5">
            <SectionLabel>{t("cash.section")}</SectionLabel>
            <div className="mt-1.5">
              <Row label={t("cash.float")}>
                <span className="font-mono font-bold tabular-nums">{formatCents(shift.openingFloatCents)}</span>
              </Row>
              <Row label={t("cash.countedBy")}>{shift.openedByName ?? t("common.dash")}</Row>
              <Row label={t("cash.openedAt")}>
                <span className="font-mono tabular-nums">{stamp(shift.openedAtMs)}</span>
              </Row>
            </div>
            {shift.openingBreakdown && Object.keys(shift.openingBreakdown).length > 0 ? (
              <div className="mt-1.5 border-t border-line pt-1.5 font-mono text-[10px] text-muted">
                {t("cash.breakdown")}:{" "}
                {Object.entries(shift.openingBreakdown)
                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                  .map(([cents, qty]) => `${qty}×${formatCents(Number(cents)).replace(" €", "")}`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
          <ClosePanel
            reloadKey={movementTick}
            onClosed={async (result) => {
              setClosed(result);
              await refresh();
            }}
          />
          </div>
          <MovementsPanel onPeekDocument={setPeekDocId} onChanged={() => setMovementTick((n) => n + 1)} />
          </>
        )}
      </div>

      {history ? <HistoryModal onClose={() => setHistory(false)} /> : null}
      <PrintToast printer={printer} />
      {peekDocId ? <TicketPeekModal docId={peekDocId} onClose={() => setPeekDocId(null)} /> : null}
      {opening ? (
        <OpenShiftDialog
          onCancel={() => setOpening(false)}
          onOpened={async () => {
            setOpening(false);
            setClosed(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
