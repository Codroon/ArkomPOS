/**
 * Dispositivos usados en depósito — handoff/reports.md §5.
 *
 * A position, not a period. Oldest first, because the oldest held device is the
 * question this report exists to answer.
 *
 * The summary describes the WHOLE position and does not follow the filters: a
 * filter narrows the table, it does not change how much money is tied up.
 */
import { useEffect, useMemo, useState } from "react";
import type { ReportsUsedResponse } from "@arkom/core";
import { SelectInput, cn, useT, type TKey } from "@arkom/ui";
import { PurchasePeekModal } from "../../components/purchase-peek-modal";
import type { ReportFilters } from "./reports-screen";
import { EmptyReport, Figure, FilterBar, ReportShell, SummaryStrip, money } from "./report-shell";

const STATE_LABELS: Record<string, TKey> = {
  held: "rep2.used.held",
  needs_review: "rep2.used.review",
  in_stock: "rep2.used.inStock",
};

/** Days a device has sat, and when that stops being normal. */
const WARN_DAYS = 60;
const ALARM_DAYS = 120;

export function UsedReport({
  filters,
  patch,
  onBack,
}: {
  filters: ReportFilters;
  patch: (next: Partial<ReportFilters>) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [data, setData] = useState<ReportsUsedResponse | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);

  const query = useMemo(
    () => ({ status: filters.usedStatus, grade: filters.usedGrade }),
    [filters.usedStatus, filters.usedGrade],
  );

  useEffect(() => {
    window.arkom
      .invoke("reports:used", query)
      .then(setData)
      .catch((err) => console.error("reports:used failed", err));
  }, [query]);

  return (
    <ReportShell
      title={t("rep2.used.title")}
      window={t("rep2.now")}
      onBack={onBack}
      exportOf="used"
      filters={query}
    >
      <FilterBar>
        <SelectInput
          className="w-[200px]"
          value={filters.usedStatus ?? ""}
          onChange={(e) => patch({ usedStatus: e.target.value || null })}
        >
          <option value="">{t("rep2.repairs.allStatus")}</option>
          {Object.entries(STATE_LABELS).map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          className="w-[160px]"
          value={filters.usedGrade ?? ""}
          onChange={(e) => patch({ usedGrade: e.target.value || null })}
        >
          <option value="">{t("rep2.used.allGrades")}</option>
          {["A", "B", "C"].map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </SelectInput>
      </FilterBar>

      <SummaryStrip>
        {(data?.summary ?? []).map((s) => (
          <Figure
            key={s.state}
            label={t(STATE_LABELS[s.state] ?? "common.dash")}
            value={`${s.count} · ${money(s.costCents)}`}
            wide
          />
        ))}
        <Figure label={t("rep2.used.total")} value={money(data?.totalCostCents ?? 0)} wide />
        {/* store credit is money the shop OWES, and it belongs beside money the
            shop is holding */}
        <Figure
          label={t("rep2.used.credit")}
          value={t("rep2.used.creditValue", {
            n: data?.storeCredit.count ?? 0,
            total: money(data?.storeCredit.totalCents ?? 0),
          })}
          wide
        />
      </SummaryStrip>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <EmptyReport message={t("rep2.empty")} />
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep2.used.col.purchase")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep2.used.col.model")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep2.used.col.grade")}</th>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep.list.status")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.used.col.cost")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.used.col.price")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.used.col.days")}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((r) => (
                <tr
                  key={r.purchaseId}
                  className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
                  onClick={() => setPeekId(r.purchaseId)}
                >
                  <td className="px-3 py-1.5 font-mono tabular-nums">{r.docNumber ?? "—"}</td>
                  <td className="px-3 py-1.5">{r.model}</td>
                  <td className="px-3 py-1.5 font-mono">{r.grade ?? "—"}</td>
                  <td className="px-3 py-1.5">{t(STATE_LABELS[r.state] ?? "common.dash")}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(r.costCents)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(r.salePriceCents)}</td>
                  {/* the only thresholds on this screen, and they are about
                      cash rather than about the device */}
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-mono font-bold tabular-nums",
                      r.daysHeld >= ALARM_DAYS ? "text-danger-ink" : r.daysHeld >= WARN_DAYS ? "text-warning-ink" : "",
                    )}
                  >
                    {r.daysHeld}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {peekId ? <PurchasePeekModal purchaseId={peekId} onClose={() => setPeekId(null)} /> : null}
    </ReportShell>
  );
}
