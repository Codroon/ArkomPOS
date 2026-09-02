/**
 * Valoración de inventario — handoff/reports.md §6.
 *
 * **This total must equal the Inventario header, to the cent.** It uses the same
 * SQL expression that screen uses, and a test pins the two together: if they ever
 * disagree, one of them is lying and the shop cannot tell which.
 */
import { useEffect, useMemo, useState } from "react";
import { formatCents, type ReportsValuationResponse } from "@arkom/core";
import { SectionLabel, SelectInput, useDataLabel, useT } from "@arkom/ui";
import { useGroups } from "../../components/group-picker";
import type { ReportFilters } from "./reports-screen";
import { EmptyReport, FilterBar, ReportShell, money } from "./report-shell";

export function ValuationReport({
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
  const groups = useGroups();
  const [data, setData] = useState<ReportsValuationResponse | null>(null);

  const query = useMemo(() => ({ groupId: filters.valuationGroupId }), [filters.valuationGroupId]);

  useEffect(() => {
    window.arkom
      .invoke("reports:valuation", query)
      .then(setData)
      .catch((err) => console.error("reports:valuation failed", err));
  }, [query]);

  useEffect(() => {
  }, []);

  return (
    <ReportShell
      title={t("rep2.val.title")}
      window={t("rep2.now")}
      onBack={onBack}
      exportOf="valuation"
      filters={query}
    >
      <FilterBar>
        <SelectInput
          className="w-[220px]"
          value={filters.valuationGroupId ?? ""}
          onChange={(e) => patch({ valuationGroupId: e.target.value || null })}
        >
          <option value="">{t("rep2.val.allGroups")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </SelectInput>
      </FilterBar>

      {/* one figure, the largest on any report screen, because it is the whole
          point of the page */}
      <div className="flex flex-none items-baseline gap-3 border-b border-line bg-surface-2 px-4 py-2.5">
        <SectionLabel>{t("rep2.val.total")}</SectionLabel>
        <div className="font-display text-[20px] tabular-nums">{formatCents(data?.totalCents ?? 0)}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.products.length === 0 ? (
          <EmptyReport message={t("rep2.empty")} />
        ) : (
          <>
            <div className="px-4 pt-3">
              <SectionLabel>{t("rep2.val.byGroup")}</SectionLabel>
            </div>
            <table className="mt-1 w-full border-collapse text-[12px]">
              <thead className="bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-bold">{t("catalog.col.group")}</th>
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.qty")}</th>
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.groups ?? []).map((g) => (
                  <tr key={g.groupId ?? "—"} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">{g.groupName ? dataLabel(g.groupName) : t("rep2.noGroup")}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{g.qty}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(g.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="px-4 pt-4">
              <SectionLabel>{t("rep2.val.byProduct")}</SectionLabel>
            </div>
            <table className="mt-1 w-full border-collapse text-[12px]">
              <thead className="bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
                <tr>
                  <th className="px-3 py-1.5 text-left font-bold">{t("catalog.col.name")}</th>
                  <th className="px-3 py-1.5 text-left font-bold">{t("catalog.col.group")}</th>
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.onHand")}</th>
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.unitCost")}</th>
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.val.col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.products ?? []).map((p) => (
                  <tr key={p.productId} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-muted">{p.groupName ? dataLabel(p.groupName) : t("rep2.noGroup")}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.onHand}</td>
                    {/* serialized rows show no single unit cost, because they
                        have none: five identical phones bought at three prices */}
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(p.unitCostCents)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(p.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </ReportShell>
  );
}
