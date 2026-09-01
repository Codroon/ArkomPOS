/**
 * Ventas — handoff/reports.md §3. Also the tax report; there is no second one.
 *
 * Cost columns are absent from the RESPONSE for a caller without
 * `reports.costs`, so this file renders five columns rather than eight without
 * knowing anything about permissions beyond the flag the handler sends back.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  dayToInput,
  formatCents,
  parseDayInput,
  resolvePreset,
  type DatePreset,
  type ReportsSalesDetailResponse,
  type ReportsSalesResponse,
} from "@arkom/core";
import { GhostButton, SelectInput, TextInput, cn, useT, type TKey } from "@arkom/ui";
import { TicketPeekModal } from "../../components/ticket-peek-modal";
import type { ReportFilters } from "./reports-screen";
import {
  EmptyReport,
  EstimateCaption,
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

const GROUPS = [
  { value: "day", label: "rep2.sales.by.day" },
  { value: "group", label: "rep2.sales.by.group" },
  { value: "product", label: "rep2.sales.by.product" },
  { value: "user", label: "rep2.sales.by.user" },
  { value: "method", label: "rep2.sales.by.method" },
] as const;

const METHOD_LABELS: Record<string, TKey> = {
  cash: "pay.cash",
  card: "pay.card",
  bizum: "pay.bizum",
  transfer: "pay.transfer",
  store_credit: "pay.storeCredit",
  deposit: "rep.agreement.deposit",
};

export function SalesReport({
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
  const [data, setData] = useState<ReportsSalesResponse | null>(null);
  const [detail, setDetail] = useState<{ label: string; rows: ReportsSalesDetailResponse["rows"] } | null>(null);
  const [peekDocId, setPeekDocId] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      fromMs: filters.salesFrom,
      toMs: filters.salesTo,
      shiftId: filters.salesShiftId,
      groupBy: filters.salesGroupBy,
    }),
    [filters.salesFrom, filters.salesTo, filters.salesShiftId, filters.salesGroupBy],
  );

  useEffect(() => {
    window.arkom
      .invoke("reports:sales", query)
      .then(setData)
      .catch((err) => console.error("reports:sales failed", err));
  }, [query]);

  const setPreset = useCallback(
    (preset: DatePreset) => {
      if (preset === "custom") {
        patch({ salesPreset: preset });
        return;
      }
      const range = resolvePreset(preset);
      patch({ salesPreset: preset, salesFrom: range.fromMs, salesTo: range.toMs, salesShiftId: null });
    },
    [patch],
  );

  const openDetail = async (key: string, label: string) => {
    if (filters.salesGroupBy === "group" || filters.salesGroupBy === "method") return;
    const kind = filters.salesGroupBy === "product" ? "product" : filters.salesGroupBy;
    const res = await window.arkom.invoke("reports:salesDetail", {
      fromMs: query.fromMs,
      toMs: query.toMs,
      shiftId: query.shiftId,
      kind: kind as "day" | "user" | "product",
      key,
    });
    setDetail({ label, rows: res.rows });
  };

  const summary = data?.summary;
  const showCosts = withCosts && data?.withCosts === true && filters.salesGroupBy === "product";
  const windowLabel = filters.salesShiftId
    ? t("rep2.shift")
    : `${dayStamp(filters.salesFrom)} – ${dayStamp(filters.salesTo - 86_400_000)}`;

  return (
    <ReportShell
      title={t("rep2.sales.title")}
      window={windowLabel}
      onBack={onBack}
      exportOf="sales"
      filters={query}
    >
      <FilterBar>
        <Segments
          value={filters.salesPreset}
          options={PRESETS.map((p) => ({ value: p.value, label: t(p.label) }))}
          onChange={setPreset}
        />
        {filters.salesPreset === "custom" ? (
          <>
            <TextInput
              mono
              className="w-[110px]"
              placeholder={t("rep.agreement.promisedFormat")}
              defaultValue={dayToInput(filters.salesFrom)}
              onBlur={(e) => {
                const ms = parseDayInput(e.target.value);
                if (ms !== null) patch({ salesFrom: ms, salesShiftId: null });
              }}
            />
            <TextInput
              mono
              className="w-[110px]"
              placeholder={t("rep.agreement.promisedFormat")}
              defaultValue={dayToInput(filters.salesTo - 86_400_000)}
              onBlur={(e) => {
                const ms = parseDayInput(e.target.value);
                if (ms !== null) patch({ salesTo: ms + 86_400_000, salesShiftId: null });
              }}
            />
          </>
        ) : null}

        <SelectInput
          className="w-[220px]"
          value={filters.salesShiftId ?? ""}
          onChange={(e) => patch({ salesShiftId: e.target.value || null })}
        >
          <option value="">{t("rep2.shiftAll")}</option>
          {(data?.shifts ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.zDocNumber ?? "—"} · {dayStamp(s.atMs)}
            </option>
          ))}
        </SelectInput>

        <div className="flex-1" />
        <span className="text-[11px] text-muted">{t("rep2.sales.groupBy")}</span>
        <Segments
          value={filters.salesGroupBy}
          options={GROUPS.map((g) => ({ value: g.value, label: t(g.label) }))}
          onChange={(v) => patch({ salesGroupBy: v })}
        />
      </FilterBar>

      <SummaryStrip>
        <Figure label={t("rep2.sales.tickets")} value={String(summary?.tickets ?? 0)} />
        <Figure label={t("rep2.sales.net")} value={money(summary?.netCents ?? 0)} />
        <Figure label={t("rep2.sales.vat")} value={money(summary?.taxCents ?? 0)} />
        <Figure label={t("rep2.sales.gross")} value={money(summary?.grossCents ?? 0)} />
        <Figure label={t("rep2.sales.average")} value={money(summary?.averageTicketCents ?? 0)} />
        {/* on its own, because the margin scheme carries no VAT and folding it
            into the taxable base would misstate the return */}
        <Figure label={t("rep2.sales.used")} value={money(summary?.usedSalesCents ?? 0)} wide />
      </SummaryStrip>

      <EstimateCaption estimate={showCosts ? (data?.estimate ?? null) : null} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {data && data.rows.length === 0 ? (
          <EmptyReport
            message={t("rep2.emptyRange", {
              from: dayStamp(filters.salesFrom),
              to: dayStamp(filters.salesTo - 86_400_000),
            })}
          />
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 bg-surface-2 text-[10px] font-bold uppercase tracking-[0.1em] text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-bold">{t("rep2.sales.col.concept")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.col.ops")}</th>
                {filters.salesGroupBy === "product" || filters.salesGroupBy === "group" ? (
                  <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.col.qty")}</th>
                ) : null}
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.net")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.vat")}</th>
                <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.gross")}</th>
                {showCosts ? (
                  <>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.col.cost")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.col.margin")}</th>
                    <th className="px-3 py-1.5 text-right font-bold">{t("rep2.sales.col.marginPct")}</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((row) => {
                const drillable = filters.salesGroupBy === "day" || filters.salesGroupBy === "user" || filters.salesGroupBy === "product";
                const label =
                  filters.salesGroupBy === "method" ? t(METHOD_LABELS[row.label] ?? "common.dash") : row.label;
                return (
                  <tr
                    key={row.key}
                    className={cn("border-b border-line last:border-b-0", drillable && "cursor-pointer hover:bg-hover")}
                    onClick={drillable ? () => void openDetail(row.key, label) : undefined}
                  >
                    <td className="px-3 py-1.5">{label}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{row.count}</td>
                    {filters.salesGroupBy === "product" || filters.salesGroupBy === "group" ? (
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{row.qty}</td>
                    ) : null}
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(row.netCents)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(row.taxCents)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{money(row.grossCents)}</td>
                    {showCosts ? (
                      <>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{money(row.costCents)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">
                          {money(row.marginCents)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right font-mono font-bold tabular-nums",
                            (row.marginPct ?? 0) < 0 && "text-danger-ink",
                          )}
                        >
                          {row.marginPct === null || row.marginPct === undefined
                            ? "—"
                            : `${row.marginPct.toFixed(1).replace(".", ",")} %`}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse/40" onClick={() => setDetail(null)}>
          <div
            className="max-h-[80vh] w-[720px] overflow-hidden rounded-[3px] border border-line-strong bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center border-b border-line px-3.5 py-2.5">
              <div className="text-[13px] font-bold">{t("rep2.sales.detail", { label: detail.label })}</div>
              <div className="flex-1" />
              <GhostButton onClick={() => setDetail(null)}>{t("common.cancel")}</GhostButton>
            </div>
            <div className="max-h-[68vh] overflow-y-auto">
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {detail.rows.map((r, i) => (
                    <tr
                      key={`${r.documentId}-${i}`}
                      className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hover"
                      onClick={() => setPeekDocId(r.documentId)}
                    >
                      <td className="px-3 py-1.5 font-mono tabular-nums">{r.docNumber ?? "—"}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{dayStamp(r.atMs)}</td>
                      <td className="px-3 py-1.5">{r.description}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">
                        {formatCents(r.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
      {peekDocId ? <TicketPeekModal docId={peekDocId} onClose={() => setPeekDocId(null)} /> : null}
    </ReportShell>
  );
}
