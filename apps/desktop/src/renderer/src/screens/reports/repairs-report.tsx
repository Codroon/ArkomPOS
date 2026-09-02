/**
 * Reparaciones — handoff/reports.md §4.
 *
 * Two tabs answering two different questions. **Abiertas** is a position: what
 * is late, and what is waiting on somebody else. **Cerradas** is a period, and
 * it is a margin report, so it lives behind `reports.costs` and the tab is not
 * rendered without it.
 *
 * The Taller board remains the live working view. This is history and money.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dayToInput,
  parseDayInput,
  resolvePreset,
  type DatePreset,
  type ReportsRepairsClosedResponse,
  type ReportsRepairsOpenResponse,
} from "@arkom/core";
import { SelectInput, Switch, TextInput, cn, useT, type TKey } from "@arkom/ui";
import { STATUS_KEYS, StatusChip } from "../repair/status-chip";
import { openRepairTicket } from "../../lib/screen-bus";
import { TechnicianPicker } from "../../components/technician-picker";
import type { ReportFilters } from "./reports-screen";
import {
  EmptyReport,
  Figure,
  FilterBar,
  ReportShell,
  Segments,
  SummaryStrip,
  dayStamp,
  money,
} from "./report-shell";

const PRESETS: ReadonlyArray<{ value: DatePreset; label: TKey }> = [
  { value: "today", label: "rep2.preset.today" },
  { value: "yesterday", label: "rep2.preset.yesterday" },
  { value: "week", label: "rep2.preset.week" },
  { value: "month", label: "rep2.preset.month" },
  { value: "lastMonth", label: "rep2.preset.lastMonth" },
  { value: "custom", label: "rep2.preset.custom" },
];

const OPEN_STATUSES = ["received", "quoted", "waiting_part", "in_repair", "ready"] as const;

const REASON_LABELS: Record<string, TKey> = {
  customer_declined: "rep.close.customer_declined",
  unrepairable: "rep.close.unrepairable",
  abandoned: "rep.close.abandoned",
};

export function RepairsReport({
  filters,
  patch,
  withCosts,
  onBack,
}: {
  filters: ReportFilters;
  patch: (next: Partial<ReportFilters>) => void;
  withCosts: boolean;
  onBack: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<ReportsRepairsOpenResponse | null>(null);
  const [closed, setClosed] = useState<ReportsRepairsClosedResponse | null>(null);

  const tab = withCosts ? filters.repairsTab : "open";

  const openQuery = useMemo(
    () => ({ status: filters.repairsStatus, technicianId: filters.repairsTechnicianId }),
    [filters.repairsStatus, filters.repairsTechnicianId],
  );
  const closedQuery = useMemo(
    () => ({ fromMs: filters.repairsFrom, toMs: filters.repairsTo, byTechnician: filters.repairsByTechnician }),
    [filters.repairsFrom, filters.repairsTo, filters.repairsByTechnician],
  );

  useEffect(() => {
    if (tab !== "open") return;
    window.arkom
      .invoke("reports:repairsOpen", openQuery)
      .then(setOpen)
      .catch((err) => console.error("reports:repairsOpen failed", err));
  }, [tab, openQuery]);

  useEffect(() => {
    if (tab !== "closed") return;
    window.arkom
      .invoke("reports:repairsClosed", closedQuery)
      .then(setClosed)
      .catch((err) => console.error("reports:repairsClosed failed", err));
  }, [tab, closedQuery]);

  const setPreset = useCallback(
    (preset: DatePreset) => {
      if (preset === "custom") {
        patch({ repairsPreset: preset });
        return;
      }
      const range = resolvePreset(preset);
      patch({ repairsPreset: preset, repairsFrom: range.fromMs, repairsTo: range.toMs });
    },
    [patch],
  );

  const goToTicket = (ticketId: string) => openRepairTicket(ticketId);

  return (
    <ReportShell
      title={t("rep2.repairs.title")}
      window={tab === "open" ? t("rep2.now") : `${dayStamp(filters.repairsFrom)} – ${dayStamp(filters.repairsTo - 86_400_000)}`}
      onBack={onBack}
      exportOf={tab === "open" ? "repairsOpen" : "repairsClosed"}
      filters={tab === "open" ? openQuery : closedQuery}
    >
      <FilterBar>
        {/* the Cerradas tab is a margin report, so it is absent without the
            permission rather than present and refusing */}
        {withCosts ? (
          <Segments
            value={tab}
            options={[
              { value: "open" as const, label: t("rep2.repairs.tabOpen") },
              { value: "closed" as const, label: t("rep2.repairs.tabClosed") },
            ]}
            onChange={(v) => patch({ repairsTab: v })}
          />
        ) : null}

        {tab === "open" ? (
          <>
            <SelectInput
              className="w-[190px]"
              value={filters.repairsStatus ?? ""}
              onChange={(e) => patch({ repairsStatus: e.target.value || null })}
            >
              <option value="">{t("rep2.repairs.allStatus")}</option>
              {OPEN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_KEYS[s])}
                </option>
              ))}
            </SelectInput>
            <TechnicianPicker
              mode="filter"
              className="w-[190px]"
              value={filters.repairsTechnicianId ?? ""}
              onChange={(next) => patch({ repairsTechnicianId: next === "" ? null : next })}
            />
          </>
        ) : (
          <>
            <Segments
              value={filters.repairsPreset}
              options={PRESETS.map((p) => ({ value: p.value, label: t(p.label) }))}
              onChange={setPreset}
            />
            {filters.repairsPreset === "custom" ? (
              <>
                <TextInput
                  mono
                  className="w-[110px]"
                  defaultValue={dayToInput(filters.repairsFrom)}
                  onBlur={(e) => {
                    const ms = parseDayInput(e.target.value);
                    if (ms !== null) patch({ repairsFrom: ms });
                  }}
                />
                <TextInput
                  mono
                  className="w-[110px]"
                  defaultValue={dayToInput(filters.repairsTo - 86_400_000)}
                  onBlur={(e) => {
                    const ms = parseDayInput(e.target.value);
                    if (ms !== null) patch({ repairsTo: ms + 86_400_000 });
                  }}
                />
              </>
            ) : null}
            <div className="flex-1" />
            <Switch
              label={t("rep2.repairs.byTech")}
              checked={filters.repairsByTechnician}
              onChange={(next) => patch({ repairsByTechnician: next })}
            />
          </>
        )}
      </FilterBar>

      {tab === "open" ? (
        <>
          <SummaryStrip>
            <Figure label={t("rep2.repairs.open")} value={String(open?.summary.open ?? 0)} />
            <Figure
              label={t("rep2.repairs.overdue")}
              value={String(open?.summary.overdue ?? 0)}
              tone={(open?.summary.overdue ?? 0) > 0 ? "danger" : "muted"}
            />
            {/* highlighted: a quoted ticket is the shop waiting on somebody
                else, and that pile grows silently */}
            <Figure
              label={t("rep2.repairs.waiting")}
              value={String(open?.summary.waitingOnCustomer ?? 0)}
              tone={(open?.summary.waitingOnCustomer ?? 0) > 0 ? "warning" : "muted"}
              wide
            />
            <Figure
              label={t("rep2.repairs.oldest")}
              value={open?.summary.oldest ? `${open.summary.oldest.docNumber ?? "—"} · ${open.summary.oldest.days} d` : "—"}
              wide
            />
          </SummaryStrip>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {open && open.rows.length === 0 ? (
              <EmptyReport message={t("rep2.empty")} />
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold">Nº</th>
                    <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.customer")}</th>
                    <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.device")}</th>
                    <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.status")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.repairs.col.days")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.repairs.col.since")}</th>
                    <th className="px-3 py-1.5 text-left font-bold">{t("rep2.repairs.tech")}</th>
                    <th className="px-3 py-1.5 text-left font-bold">{t("rep2.repairs.col.promised")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(open?.rows ?? []).map((r) => (
                    <tr
                      key={r.ticketId}
                      className={cn("cursor-pointer border-b border-line last:border-b-0 hover:bg-hover", r.overdue && "bg-row-flagged")}
                      onClick={() => goToTicket(r.ticketId)}
                    >
                      <td className="px-3 py-1.5 font-mono tabular-nums">{r.docNumber ?? "—"}</td>
                      <td className="px-3 py-1.5">{r.customerName}</td>
                      <td className="px-3 py-1.5">{r.device}</td>
                      <td className="px-3 py-1.5">
                        <StatusChip status={r.status as never} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.daysInStatus}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.daysSinceIntake}</td>
                      <td className="px-3 py-1.5">{r.technicianName ?? <span className="italic text-subtle">{t("rep2.repairs.unassigned")}</span>}</td>
                      <td className={cn("px-3 py-1.5 font-mono tabular-nums", r.overdue && "text-danger-ink")}>
                        {dayStamp(r.promisedAtMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <>
          <SummaryStrip>
            <Figure label={t("rep2.repairs.collected")} value={String(closed?.summary.collected ?? 0)} />
            <Figure label={t("rep2.repairs.revenue")} value={money(closed?.summary.revenueCents ?? 0)} />
            <Figure label={t("rep2.repairs.parts")} value={money(closed?.summary.partsCostCents ?? 0)} />
            <Figure label={t("rep2.repairs.labor")} value={money(closed?.summary.laborCents ?? 0)} />
            <Figure label={t("rep2.repairs.margin")} value={money(closed?.summary.marginCents ?? 0)} />
            <Figure
              label={t("rep2.repairs.turnaround")}
              value={closed?.summary.averageTurnaroundDays === null || closed === null ? "—" : `${closed.summary.averageTurnaroundDays} d`}
            />
            <Figure label={t("rep2.repairs.notRepaired")} value={String(closed?.summary.notRepaired ?? 0)} />
          </SummaryStrip>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {closed && closed.rows.length === 0 ? (
              <EmptyReport
                message={t("rep2.emptyRange", {
                  from: dayStamp(filters.repairsFrom),
                  to: dayStamp(filters.repairsTo - 86_400_000),
                })}
              />
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold">
                      {filters.repairsByTechnician ? t("rep2.repairs.tech") : t("common.number")}
                    </th>
                    {!filters.repairsByTechnician ? (
                      <>
                        <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.customer")}</th>
                        <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.device")}</th>
                        <th className="px-3 py-1.5 text-left font-bold">{t("rep2.repairs.col.intake")}</th>
                        <th className="px-3 py-1.5 text-left font-bold">{t("rep2.repairs.col.delivery")}</th>
                      </>
                    ) : null}
                    <th className="px-3 py-1.5 text-right font-bold">
                      {filters.repairsByTechnician ? t("rep2.repairs.collected") : t("rep2.repairs.col.days")}
                    </th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.repairs.revenue")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.repairs.parts")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.repairs.margin")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(closed?.rows ?? []).map((r) => (
                    <tr
                      key={r.key}
                      className={cn("border-b border-line last:border-b-0", r.ticketId && "cursor-pointer hover:bg-hover")}
                      onClick={r.ticketId ? () => goToTicket(r.ticketId!) : undefined}
                    >
                      <td className="px-3 py-1.5 font-mono tabular-nums">
                        {filters.repairsByTechnician ? r.label : (r.docNumber ?? "—")}
                      </td>
                      {!filters.repairsByTechnician ? (
                        <>
                          <td className="px-3 py-1.5">{r.label}</td>
                          <td className="px-3 py-1.5">{r.device}</td>
                          <td className="px-3 py-1.5 font-mono tabular-nums">{dayStamp(r.intakeAtMs)}</td>
                          <td className="px-3 py-1.5 font-mono tabular-nums">{dayStamp(r.collectedAtMs)}</td>
                        </>
                      ) : null}
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {filters.repairsByTechnician ? r.count : (r.turnaroundDays ?? "—")}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(r.revenueCents)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.partsCostCents)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(r.marginCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* three abandoned devices and three unrepairable ones are different
                problems, so the reasons get their own small table */}
            {closed && closed.notRepaired.length > 0 ? (
              <div className="border-t border-line-strong px-4 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                  {t("rep2.repairs.notRepaired")}
                </div>
                <div className="mt-1 flex gap-4">
                  {closed.notRepaired.map((n) => (
                    <div key={n.reason ?? "—"} className="text-[12px]">
                      {n.reason ? t(REASON_LABELS[n.reason] ?? "common.dash") : "—"}:{" "}
                      <span className="font-mono font-bold tabular-nums">{n.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </>
      )}
    </ReportShell>
  );
}
