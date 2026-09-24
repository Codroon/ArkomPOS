/**
 * Resumen — what the shop did, for the period in the top bar.
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
import { dateTime, euros  } from "../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, Stat, TD, TH, TR, Table } from "../../src/ui";
import { MixChart, TakingsChart } from "./charts";

export const dynamic = "force-dynamic";

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const period = parseRange((await searchParams).range);

  const [totals, byDay, mix, top, shifts, tills] = await Promise.all([
    periodTotals(account.id, period.days),
    takingsByDay(account.id, period.days),
    paymentMix(account.id, period.days),
    topProducts(account.id, period.days, 8),
    recentShifts(account.id, 6),
    tillsForAccount(account.id),
  ]);

  if (tills.length === 0) {
    return (
      <Card>
        <EmptyState title={t("till.none")} hint={t("till.noneHint")} />
      </Card>
    );
  }

  const chartData = byDay.map((row) => ({
    ...row,
    label: `${row.day.slice(8, 10)}/${row.day.slice(5, 7)}`,
  }));
  const hasMovement = byDay.some((row) => row.documents > 0);

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ kpis */}
      <Card className="flex flex-wrap divide-line sm:divide-x">
        <Stat
          label={t("kpi.net")}
          value={euros(totals.current.netCents)}
          delta={totals.delta.net}
          sub={t("kpi.vsPrevious")}
        />
        <Stat
          label={t("kpi.documents")}
          value={String(totals.current.documents)}
          delta={totals.delta.documents}
          sub={t("kpi.vsPrevious")}
        />
        <Stat
          label={t("kpi.average")}
          value={euros(totals.current.averageCents)}
          delta={totals.delta.average}
          sub={t("kpi.vsPrevious")}
        />
        <Stat
          label={t("kpi.tax")}
          value={euros(totals.current.taxCents)}
          delta={totals.delta.tax}
          sub={t("kpi.vsPrevious")}
        />
      </Card>

      {/* ---------------------------------------------------------- charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title={t("chart.takings")} hint={t("chart.takingsHint")} />
          <CardBody>
            {hasMovement ? (
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
              <MixChart
                data={mix.map((row) => ({
                  label: labelFor(t, "tender", row.method),
                  amountCents: row.amountCents,
                }))}
                currency="€"
              />
            ) : (
              <EmptyState title={t("empty.noData")} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------------------------- top + shifts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={t("chart.topProducts")} hint={t("chart.topProductsHint")} />
          {top.length === 0 ? (
            <EmptyState title={t("empty.noData")} />
          ) : (
            <CardBody className="pt-1">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("doc.concept")}</TH>
                    <TH right>{t("doc.qty")}</TH>
                    <TH right>{t("doc.total")}</TH>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => (
                    <TR key={row.description}>
                      <TD>{row.description}</TD>
                      <TD right>{row.qty}</TD>
                      <TD right>{euros(row.totalCents)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHead title={t("shift.title")} hint={t("shift.hint")} />
          {shifts.length === 0 ? (
            <EmptyState title={t("empty.noData")} />
          ) : (
            <CardBody className="pt-1">
              <Table>
                <thead>
                  <tr>
                    <TH>Z</TH>
                    <TH>{t("doc.when")}</TH>
                    <TH right>{t("shift.expected")}</TH>
                    <TH right>{t("shift.counted")}</TH>
                    <TH right>{t("shift.variance")}</TH>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <TR key={`${shift.zDocNumber}-${shift.closedAt.getTime()}`}>
                      <TD className="tabular">{shift.zDocNumber ?? "—"}</TD>
                      <TD>{dateTime(shift.closedAt)}</TD>
                      <TD right>{euros(shift.expectedCashCents)}</TD>
                      <TD right>{euros(shift.countedCashCents)}</TD>
                      <TD right>
                        {shift.varianceCents === 0 ? (
                          <span className="text-muted">{euros(0)}</span>
                        ) : (
                          <Chip tone="bad">{euros(shift.varianceCents)}</Chip>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}
