/**
 * Taller (nav 07) — handoff/repairs.md §5.
 *
 * Seven columns in status order. Entregado and No reparado are collapsed behind
 * a toggle, because a board of finished work is not a board.
 *
 * **No calendar.** The wireframe drew a half-hour slot grid; ADR-0014 chose a
 * date and a half-day, which is what a phone shop actually promises, and that is
 * all a card shows.
 *
 * Cards are read-only here. Dragging one would attempt a transition, and the
 * only honest way to do that is through the same guard the ficha's buttons use —
 * which means opening the dialog the action needs. Until every one of those
 * dialogs exists, a card opens its ficha rather than pretending to move.
 */
import { TechnicianPicker, UNASSIGNED } from "../../components/technician-picker";
import { useCallback, useEffect, useState } from "react";
import { REPAIR_STATUSES, type RepairStatus, type WorkshopBoard } from "@arkom/core";
import { SelectInput, Switch, cn, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { openRepairTicket } from "../../lib/screen-bus";
import { OverdueChip, STATUS_KEYS, formatPromised } from "./status-chip";

const TERMINAL: RepairStatus[] = ["collected", "not_repaired"];

/** The left border encodes age in the current status. */
function ageBorder(days: number): string {
  if (days >= 7) return "border-l-danger-ink";
  if (days >= 3) return "border-l-warning-ink";
  return "border-l-line";
}

export function WorkshopScreen() {
  const t = useT();
  const [board, setBoard] = useState<WorkshopBoard | null>(null);
  const [technicianId, setTechnicianId] = useState<string>("");
  const [showClosed, setShowClosed] = useState(false);
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.arkom
      .invoke("auth:users")
      .then((users) => setStaff(users.map((u) => ({ id: u.id, name: u.name }))))
      .catch(() => setStaff([]));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setBoard(
        await window.arkom.invoke("workshop:board", {
          technicianId: technicianId === UNASSIGNED || technicianId === "" ? null : technicianId,
          unassignedOnly: technicianId === UNASSIGNED,
        }),
      );
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  }, [technicianId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = (board?.columns ?? []).filter(
    (c) => showClosed || !TERMINAL.includes(c.status),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("rep.board.title")}</div>
        <div className="text-[11px] text-subtle">
          {t("rep.list.open", { n: String(board?.openCount ?? 0) })}
        </div>
        <div className="flex-1" />
        <div className="w-[190px]">
          <TechnicianPicker
            mode="filter"
            value={technicianId}
            onChange={setTechnicianId}
          />
        </div>
        <Switch label={t("rep.board.showClosed")} checked={showClosed} onChange={setShowClosed} />
      </div>

      {error ? <div className="px-4 py-3 text-[12px] text-danger-ink">{error}</div> : null}

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-3">
        {columns.map((column) => (
          <div key={column.status} className="flex w-[236px] flex-none flex-col">
            <div className="flex items-center gap-1.5 border-b border-line-strong pb-1.5">
              <span className="text-[10px] font-bold tracking-[.08em] text-subtle">
                {t(STATUS_KEYS[column.status]).toUpperCase()}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-muted">{column.cards.length}</span>
            </div>
            <div className="mt-2 flex flex-col gap-2 overflow-y-auto">
              {column.cards.length === 0 ? (
                <div className="text-[10px] text-subtle">{t("rep.board.empty")}</div>
              ) : (
                column.cards.map((card) => (
                  <button
                    key={card.ticketId}
                    type="button"
                    onClick={() => openRepairTicket(card.ticketId)}
                    className={cn(
                      "rounded-[3px] border border-line border-l-[3px] bg-card px-2.5 py-2 text-left hover:bg-hover",
                      ageBorder(card.daysInStatus),
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold">{card.docNumber}</span>
                      <div className="flex-1" />
                      <span className="font-mono text-[10px] tabular-nums text-muted">
                        {t("rep.board.days", { n: String(card.daysInStatus) })}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px]">{card.deviceDescription}</div>
                    <div className="truncate text-[10px] text-ink-2">{card.reportedFault}</div>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={cn("text-[10px]", card.technicianName ? "text-muted" : "italic text-muted")}>
                        {card.technicianName ?? t("rep.list.unassigned")}
                      </span>
                      <div className="flex-1" />
                      {card.overdue ? (
                        <OverdueChip />
                      ) : card.promisedAt !== null ? (
                        <span className="font-mono text-[10px] tabular-nums text-muted">
                          {formatPromised(card.promisedAt, card.promisedHalf, t)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { REPAIR_STATUSES };
