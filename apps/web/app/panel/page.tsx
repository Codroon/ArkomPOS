/**
 * Resumen — what the shop did, for the period in the top bar.
 *
 * The question this screen answers is "how did we do, and is that better or
 * worse than last time". So the four figures come first and each carries its own
 * comparison — or says plainly that there is nothing to compare against, which
 * is a fact about the data and not an empty slot. Under them, where the money
 * came from and what it came from.
 *
 * Every figure arrives already computed from SQL. Nothing on this page adds up
 * money: that would be a second implementation of it, and the one in
 * `packages/core` is the one with tests (ADR-0016 §3).
 */
import { requireAccount } from "../../src/auth/session";
import { getT } from "../../src/i18n/server";
import { labelFor } from "../../src/i18n";
import { parseRange } from "../../src/lib/range";
import {
  paymentMix,
  periodTotals,
  recentShifts,
  takingsByDay,
  topProducts,
} from "../../src/db/dashboard-queries";
import { tillsForAccount } from "../../src/db/panel-queries";
import { dateTime, euros } from "../../src/lib/format";
import {
  Card,
  CardBody,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Stat,
  StatGrid,
  type Column,
} from "../../src/ui";
import { BarList } from "../../src/ui/bar-list";
import { TakingsChart } from "./charts";

export const dynamic = "force-dynamic";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const params = await searchParams;
  const period = parseRange(params.range, params.from, params.to);

  const [totals, byDay, mix, top, shifts, tills] = await Promise.all([
    periodTotals(account.id, period),
    takingsByDay(account.id, period),
    paymentMix(account.id, period),
    topProducts(account.id, period, 8),
    recentShifts(account.id, period, 6),
    tillsForAccount(account.id),
  ]);

  if (tills.length === 0) {
    return (
      <Card>
        <EmptyState title={t("till.none")} hint={t("till.noneHint")} />
      </Card>
    );
  }

  /* "frente al periodo anterior" under a blank space promises a comparison
     nobody made. When there is no previous period, say so. */
  const sub = (delta: number | null) =>
    delta === null ? t("kpi.noPrevious") : t("kpi.vsPrevious");

  const chartData = byDay.map((row) => ({
    ...row,
    label: `${row.day.slice(8, 10)}/${row.day.slice(5, 7)}`,
  }));
  const daysWithSales = byDay.filter((row) => row.documents > 0).length;

  const topColumns: Column<(typeof top)[number]>[] = [
    { key: "what", header: t("doc.concept"), card: "title", render: (r) => r.description },
    { key: "qty", header: t("doc.qty"), align: "right", card: "figure", render: (r) => r.qty },
    {
      key: "total",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.totalCents),
    },
  ];

  const shiftColumns: Column<(typeof shifts)[number]>[] = [
    { key: "z", header: "Z", card: "title", className: "tabular", render: (s) => s.zDocNumber ?? "—" },
    { key: "when", header: t("doc.when"), card: "sub", render: (s) => dateTime(s.closedAt) },
    {
      key: "expected",
      header: t("shift.expected"),
      align: "right",
      card: "figure",
      render: (s) => euros(s.expectedCashCents),
    },
    {
      key: "counted",
      header: t("shift.counted"),
      align: "right",
      card: "figure",
      render: (s) => euros(s.countedCashCents),
    },
    {
      key: "variance",
      header: t("shift.variance"),
      align: "right",
      card: "figure",
      render: (s) =>
        s.varianceCents === 0 ? (
          <span className="text-muted">{euros(0)}</span>
        ) : (
          <Chip tone="bad">{euros(s.varianceCents)}</Chip>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat
          label={t("kpi.net")}
          value={euros(totals.current.netCents)}
          delta={totals.delta.net}
          sub={sub(totals.delta.net)}
        />
        <Stat
          label={t("kpi.documents")}
          value={String(totals.current.documents)}
          delta={totals.delta.documents}
          sub={sub(totals.delta.documents)}
        />
        <Stat
          label={t("kpi.average")}
          value={euros(totals.current.averageCents)}
          delta={totals.delta.average}
          sub={sub(totals.delta.average)}
        />
        <Stat
          label={t("kpi.tax")}
          value={euros(totals.current.taxCents)}
          delta={totals.delta.tax}
          sub={sub(totals.delta.tax)}
        />
      </StatGrid>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead
            title={t("chart.takings")}
            hint={t("chart.takingsHint")}
            action={
              daysWithSales > 0 ? (
                <Chip>{t("chart.activeDays", { n: daysWithSales, of: byDay.length })}</Chip>
              ) : undefined
            }
          />
          <CardBody>
            {daysWithSales > 0 ? (
              <TakingsChart data={chartData} currency="€" />
            ) : (
              <EmptyState title={t("empty.noData")} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead title={t("chart.payments")} hint={t("chart.paymentsHint")} />
          <CardBody>
            {mix.length > 0 ? (
              <BarList
                rows={mix.map((row) => ({
                  label: labelFor(t, "tender", row.method),
                  value: row.amountCents,
                }))}
                format={(cents) => euros(cents)}
              />
            ) : (
              <EmptyState title={t("empty.noData")} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* items-start: a card with one Z close should be the height of one Z
          close, not of the eight-row table beside it */}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={t("chart.topProducts")} hint={t("chart.topProductsHint")} />
          <DataTable
            rows={top}
            columns={topColumns}
            rowKey={(r) => r.description}
            empty={<EmptyState title={t("empty.noData")} />}
          />
        </Card>

        <Card>
          <CardHead title={t("shift.title")} hint={t("shift.hint")} />
          <DataTable
            rows={shifts}
            columns={shiftColumns}
            rowKey={(s) => `${s.zDocNumber}-${s.closedAt.getTime()}`}
            empty={<EmptyState title={t("empty.noData")} />}
          />
        </Card>
      </div>
    </div>
  );
}
