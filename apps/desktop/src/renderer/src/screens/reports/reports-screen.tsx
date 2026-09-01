/**
 * Informes (nav 10) — the hub, and the router between the five reports.
 *
 * **Filters live here, not in the report components**, so drilling into a ticket
 * and coming back finds last month still selected. They are deliberately NOT
 * persisted: tomorrow the report opens on its default, because one silently
 * showing a stale month is how a shop reads the wrong figures and believes them
 * (ADR-0016 §5).
 */
import { useCallback, useEffect, useState } from "react";
import { formatCents, resolvePreset, type DatePreset, type ReportsHubResponse } from "@arkom/core";
import { SectionLabel, cn, useT } from "@arkom/ui";
import { useCan } from "../../lib/use-session";
import { SalesReport } from "./sales-report";
import { RepairsReport } from "./repairs-report";
import { UsedReport } from "./used-report";
import { ValuationReport } from "./valuation-report";
import { DeadStockReport } from "./dead-stock-report";

export type ReportRoute = "hub" | "sales" | "repairs" | "used" | "valuation" | "deadStock";

/** What the reports remember for the life of the session (ADR-0016 §5). */
export interface ReportFilters {
  salesPreset: DatePreset;
  salesFrom: number;
  salesTo: number;
  salesShiftId: string | null;
  salesGroupBy: "day" | "group" | "product" | "user" | "method";
  repairsTab: "open" | "closed";
  repairsStatus: string | null;
  repairsTechnicianId: string | null;
  repairsPreset: DatePreset;
  repairsFrom: number;
  repairsTo: number;
  repairsByTechnician: boolean;
  usedStatus: string | null;
  usedGrade: string | null;
  valuationGroupId: string | null;
  deadGroupId: string | null;
}

function defaultFilters(): ReportFilters {
  const month = resolvePreset("month");
  return {
    salesPreset: "month",
    salesFrom: month.fromMs,
    salesTo: month.toMs,
    salesShiftId: null,
    salesGroupBy: "day",
    repairsTab: "open",
    repairsStatus: null,
    repairsTechnicianId: null,
    repairsPreset: "month",
    repairsFrom: month.fromMs,
    repairsTo: month.toMs,
    repairsByTechnician: false,
    usedStatus: null,
    usedGrade: null,
    valuationGroupId: null,
    deadGroupId: null,
  };
}

function Card({
  label,
  value,
  window: windowLabel,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  window: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[100px] flex-col justify-between rounded-[3px] border border-line-strong bg-card px-3.5 py-3 text-left hover:border-muted"
    >
      <SectionLabel>{label}</SectionLabel>
      <div className={cn("font-display text-[20px] leading-none", tone === "danger" ? "text-danger-ink" : "text-ink")}>
        {value}
      </div>
      <div className="text-[11px] text-muted">{windowLabel}</div>
    </button>
  );
}

export function ReportsScreen() {
  const t = useT();
  const can = useCan();
  const withCosts = can("reports.costs");

  const [route, setRoute] = useState<ReportRoute>("hub");
  const [filters, setFiltersState] = useState<ReportFilters>(defaultFilters);
  const [hub, setHub] = useState<ReportsHubResponse | null>(null);

  const patch = useCallback((next: Partial<ReportFilters>) => setFiltersState((f) => ({ ...f, ...next })), []);

  /* The hub is five aggregates in one call, run on every visit rather than
     cached — cheap by construction is the design, not cheap by memory. */
  useEffect(() => {
    if (route !== "hub") return;
    window.arkom
      .invoke("reports:hub", {})
      .then(setHub)
      .catch((err) => console.error("reports:hub failed", err));
  }, [route]);

  if (route === "sales") {
    return <SalesReport filters={filters} patch={patch} withCosts={withCosts} onBack={() => setRoute("hub")} />;
  }
  if (route === "repairs") {
    return <RepairsReport filters={filters} patch={patch} withCosts={withCosts} onBack={() => setRoute("hub")} />;
  }
  if (route === "used") {
    return <UsedReport filters={filters} patch={patch} onBack={() => setRoute("hub")} />;
  }
  if (route === "valuation") {
    return <ValuationReport filters={filters} patch={patch} onBack={() => setRoute("hub")} />;
  }
  if (route === "deadStock") {
    return <DeadStockReport filters={filters} patch={patch} onBack={() => setRoute("hub")} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-line-strong bg-surface px-4 py-2.5">
        <div className="text-[15px] font-bold">{t("rep2.title")}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-3">
          <Card
            label={t("rep2.card.sales")}
            value={hub ? formatCents(hub.salesNetCents) : "…"}
            window={t("rep2.card.salesWindow")}
            onClick={() => setRoute("sales")}
          />
          <Card
            label={t("rep2.card.repairs")}
            value={
              hub
                ? t("rep2.card.repairsValue", { open: hub.repairsOpen, overdue: hub.repairsOverdue })
                : "…"
            }
            window={t("rep2.now")}
            /* the one number on this screen that changes colour, and only when
               there is something to be alarmed about */
            tone={hub && hub.repairsOverdue > 0 ? "danger" : undefined}
            onClick={() => setRoute("repairs")}
          />

          {/* a card somebody cannot open is not rendered — not greyed out */}
          {withCosts ? (
            <>
              <Card
                label={t("rep2.card.used")}
                value={
                  hub
                    ? t("rep2.card.usedValue", {
                        units: hub.usedUnits ?? 0,
                        cost: formatCents(hub.usedCostCents ?? 0),
                      })
                    : "…"
                }
                window={t("rep2.card.usedWindow")}
                onClick={() => setRoute("used")}
              />
              <Card
                label={t("rep2.card.valuation")}
                value={hub ? formatCents(hub.valuationCents ?? 0) : "…"}
                window={t("rep2.card.valuationWindow")}
                onClick={() => setRoute("valuation")}
              />
              <Card
                label={t("rep2.card.deadStock")}
                value={hub ? t("rep2.card.deadStockValue", { n: hub.deadStockCount ?? 0 }) : "…"}
                window={t("rep2.card.deadStockWindow", { days: hub?.thresholdDays ?? 90 })}
                onClick={() => setRoute("deadStock")}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
