/**
 * Stock muerto — handoff/reports.md §7.
 *
 * Sorted by cost tied up, descending: 40 unsold cases at 2 € are a tidy-up, and
 * one unsold laptop at 900 € is the reason this page exists.
 *
 * The threshold is **not** a filter — it lives in Ajustes and the header states
 * it. A threshold in the filter bar invites fishing for a number that looks
 * better than the one the shop agreed on.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReportsDeadStockResponse } from "@arkom/core";
import { SelectInput, useDataLabel, useT } from "@arkom/ui";
import { GroupOptions } from "../../components/group-picker";
import type { ReportFilters } from "./reports-screen";
import { EmptyReport, Figure, FilterBar, ReportShell, SummaryStrip, dayStamp, money } from "./report-shell";

export function DeadStockReport({
  filters,
  patch,
  onBack,
}: {
  filters: ReportFilters;
  patch: (next: Partial<ReportFilters>) => void;
  onBack: () => void;
}) {
  const t = useT();
  const dataLabel = useDataLabel();
  const [data, setData] = useState<ReportsDeadStockResponse | null>(null);

  const query = useMemo(() => ({ groupId: filters.deadGroupId }), [filters.deadGroupId]);

  useEffect(() => {
    window.arkom
      .invoke("reports:deadStock", query)
      .then(setData)
      .catch((err) => console.error("reports:deadStock failed", err));
  }, [query]);

  useEffect(() => {
  }, []);

  return (
    <ReportShell
      title={t("rep2.dead.title")}
      window={t("rep2.card.deadStockWindow", { days: data?.thresholdDays ?? 90 })}
      onBack={onBack}
      exportOf="deadStock"
      filters={query}
    >
      <FilterBar>
        <SelectInput
          className="w-[220px]"
          value={filters.deadGroupId ?? ""}
          onChange={(e) => patch({ deadGroupId: e.target.value || null })}
        >
          <GroupOptions allLabel={t("rep2.val.allGroups")} />
                </SelectInput>
      </FilterBar>

      <SummaryStrip>
        <Figure label={t("rep2.dead.products")} value={String(data?.rows.length ?? 0)} />
        <Figure label={t("rep2.dead.total")} value={money(data?.totalCostCents ?? 0)} wide />
      </SummaryStrip>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <EmptyReport message={t("rep2.empty")} />
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-bold">{t("catalog.col.name")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("catalog.col.group")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.onHand")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.dead.col.cost")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep2.dead.col.lastSale")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.dead.col.days")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr key={r.productId} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-1.5">{r.name}</td>
                  <td className="px-3 py-1.5 text-muted">{r.groupName ? dataLabel(r.groupName) : t("rep2.noGroup")}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.onHand}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">
                    {money(r.costTiedUpCents)}
                  </td>
                  {/* never sold is the strongest case on the page, so it says so
                      in words rather than showing an empty cell */}
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    {r.lastSaleAtMs === null ? (
                      <span className="italic text-muted">{t("rep2.dead.never")}</span>
                    ) : (
                      dayStamp(r.lastSaleAtMs)
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.daysSinceSale ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ReportShell>
  );
}
