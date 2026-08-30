/**
 * The Reparaciones list — handoff/repairs.md §1.
 *
 * The counts strip doubles as the filter and its numbers are always over
 * EVERYTHING, whatever filter is active: a strip whose counts shrink as you use
 * it stops being a way to navigate and becomes a maze. Same rule, same reason,
 * as Dispositivos usados.
 */
import { useCallback, useEffect, useState } from "react";
import { REPAIR_STATUSES, type RepairListRow, type RepairStatus } from "@arkom/core";
import { Chip, ScanInput, SelectInput, Switch, cn, useT } from "@arkom/ui";
import { errorMessage } from "../../lib/errors";
import { OverdueChip, StatusChip, STATUS_KEYS, formatPromised } from "./status-chip";

export interface ListFilters {
  status: RepairStatus | null;
  technicianId: string | null;
  unassignedOnly: boolean;
  overdueOnly: boolean;
  search: string;
}

export const emptyFilters = (): ListFilters => ({
  status: null,
  technicianId: null,
  unassignedOnly: false,
  overdueOnly: false,
  search: "",
});

export function RepairList({
  onOpen,
  technicians,
  refreshKey,
}: {
  onOpen: (ticketId: string) => void;
  technicians: Array<{ id: string; name: string }>;
  refreshKey: number;
}) {
  const t = useT();
  const [filters, setFilters] = useState<ListFilters>(emptyFilters);
  const [rows, setRows] = useState<RepairListRow[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<RepairStatus, number>>>({});
  const [openCount, setOpenCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await window.arkom.invoke("repair:list", {
        status: filters.status,
        technicianId: filters.technicianId,
        unassignedOnly: filters.unassignedOnly,
        overdueOnly: filters.overdueOnly,
        search: filters.search.trim() || null,
      });
      setRows(result.rows);
      setCounts(result.counts);
      setOpenCount(result.openCount);
      setError(null);
    } catch (err) {
      setError(errorMessage(t, err));
      setRows([]);
    }
  }, [filters, t]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* counts strip — every chip a filter, every count over everything */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2">
        <button type="button" onClick={() => setFilters((f) => ({ ...f, status: null }))}>
          <Chip className={cn(filters.status === null && "ring-1 ring-ink")}>
            {t("rep.list.all")} · {total}
          </Chip>
        </button>
        {REPAIR_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilters((f) => ({ ...f, status: f.status === status ? null : status }))}
          >
            <span className={cn("inline-flex", filters.status === status && "rounded-[3px] ring-1 ring-ink")}>
              <StatusChip status={status} />
            </span>
            <span className="ml-1 font-mono text-[11px] tabular-nums text-muted">{counts[status] ?? 0}</span>
          </button>
        ))}
        <div className="flex-1" />
        <div className="text-[11px] text-subtle">{t("rep.list.open", { n: String(openCount) })}</div>
      </div>

      {/* second row: technician + overdue + search */}
      <div className="flex flex-none items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <div className="w-[190px]">
          <SelectInput
            value={filters.unassignedOnly ? "none" : (filters.technicianId ?? "")}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                unassignedOnly: e.target.value === "none",
                technicianId: e.target.value === "none" || e.target.value === "" ? null : e.target.value,
              }))
            }
          >
            <option value="">{t("rep.list.technician")}</option>
            {/* "nobody has picked this up" is information, so it is a choice */}
            <option value="none">{t("rep.list.unassigned")}</option>
            {technicians.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <Switch
          label={t("rep.list.onlyOverdue")}
          checked={filters.overdueOnly}
          onChange={(next) => setFilters((f) => ({ ...f, overdueOnly: next }))}
        />
        <div className="flex-1" />
        <div className="w-[340px]">
          {/* a ScanInput: scanning an IMEI lands on the ticket */}
          <ScanInput
            value={filters.search}
            placeholder={t("rep.list.search")}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            onScan={(code) => setFilters((f) => ({ ...f, search: code }))}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <div className="px-4 py-3 text-[12px] text-danger-ink">{error}</div> : null}
        {rows === null ? null : rows.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-subtle">
            {total === 0 ? t("rep.list.empty") : t("rep.list.noMatch")}
          </div>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line-strong text-left text-[10px] font-bold tracking-[.08em] text-subtle">
                <th className="px-4 py-1.5">{t("rep.list.number")}</th>
                <th className="px-2 py-1.5">{t("rep.list.customer")}</th>
                <th className="px-2 py-1.5">{t("rep.list.device")}</th>
                <th className="px-2 py-1.5">{t("rep.list.fault")}</th>
                <th className="px-2 py-1.5">{t("rep.list.status")}</th>
                <th className="px-2 py-1.5">{t("rep.list.technician")}</th>
                <th className="px-2 py-1.5">{t("rep.list.promised")}</th>
                <th className="px-4 py-1.5 text-right">{t("rep.list.days")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                // a finished ticket is still findable, but it stops competing
                // for attention with the ones that need something
                const closed = row.status === "collected" || row.status === "not_repaired";
                return (
                  <tr
                    key={row.ticketId}
                    onClick={() => onOpen(row.ticketId)}
                    className={cn(
                      "cursor-pointer border-b border-line hover:bg-hover",
                      closed && "text-subtle",
                    )}
                  >
                    <td className="px-4 py-1.5 font-mono">{row.docNumber}</td>
                    <td className="px-2 py-1.5">{row.customerName}</td>
                    <td className="max-w-[190px] truncate px-2 py-1.5">{row.deviceDescription}</td>
                    <td className="max-w-[220px] truncate px-2 py-1.5 text-ink-2">{row.reportedFault}</td>
                    <td className="px-2 py-1.5">
                      <StatusChip status={row.status} />
                    </td>
                    <td className="px-2 py-1.5">
                      {row.technicianName ?? (
                        // never an empty cell: a blank reads as a rendering bug
                        <span className="italic text-muted">{t("rep.list.unassigned")}</span>
                      )}
                    </td>
                    <td className={cn("px-2 py-1.5", row.overdue && "bg-warning-bg text-warning-ink")}>
                      <span className="mr-1.5 font-mono tabular-nums">
                        {formatPromised(row.promisedAt, row.promisedHalf, t)}
                      </span>
                      {row.overdue ? <OverdueChip /> : null}
                    </td>
                    <td className="px-4 py-1.5 text-right font-mono tabular-nums">{row.daysOpen}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { STATUS_KEYS };
