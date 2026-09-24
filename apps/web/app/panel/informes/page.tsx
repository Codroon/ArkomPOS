/**
 * Informes — the same five reports the till has at nav 10.
 *
 * Deliberately mirrors `apps/desktop/src/renderer/src/screens/reports/`: a
 * figure has to mean the same thing whether the owner reads it on the counter
 * or on a phone. Two reports with the same name and different columns is how a
 * shop learns to trust neither.
 *
 * The tab lives in the URL so a link opens on the report it was sent about.
 */
import Link from "next/link";
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor } from "../../../src/i18n";
import { parseRange } from "../../../src/lib/range";
import {
  deadStock,
  outstandingCredit,
  repairsClosed,
  repairsOpen,
  salesByGroup,
  salesSummary,
  taxByRegime,
  usedHolding,
  valuation,
} from "../../../src/db/report-queries";
import { dateTime, euros } from "../../../src/lib/format";
import {
  Card,
  CardBody,
  CardHead,
  Chip,
  EmptyState,
  Stat,
  TD,
  TH,
  TR,
  Table,
  cn,
  ghostClass,
} from "../../../src/ui";

export const dynamic = "force-dynamic";

const TABS = ["sales", "repairs", "used", "valuation", "dead"] as const;
type Tab = (typeof TABS)[number];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const params = await searchParams;
  const period = parseRange(params.range);

  const asked = typeof params.report === "string" ? params.report : "";
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : "sales";

  const href = (next: Tab) => `/panel/informes?range=${period.key}&report=${next}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line">
      <nav className="flex flex-wrap gap-1">
        {TABS.map((key) => (
          <Link
            key={key}
            href={href(key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px]",
              key === tab
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-muted hover:text-ink-2",
            )}
          >
            {t(`inf.tab.${key}` as "inf.tab.sales")}
          </Link>
        ))}
      </nav>
        {/* re-runs the same query this tab just ran, for the same period */}
        <a
          className={`${ghostClass} mb-1.5`}
          href={`/panel/informes/export?report=${tab}&range=${period.key}`}
        >
          {t("sales.export")}
        </a>
      </div>

      {tab === "sales" ? <SalesReport accountId={account.id} days={period.days} t={t} /> : null}
      {tab === "repairs" ? <RepairsReport accountId={account.id} t={t} /> : null}
      {tab === "used" ? <UsedReport accountId={account.id} t={t} /> : null}
      {tab === "valuation" ? <ValuationReport accountId={account.id} t={t} /> : null}
      {tab === "dead" ? <DeadStockReport accountId={account.id} t={t} /> : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getT>>["t"];

/* ---------------------------------------------------------------- sales -- */

async function SalesReport({ accountId, days, t }: { accountId: string; days: number; t: T }) {
  const [summary, groups, tax] = await Promise.all([
    salesSummary(accountId, days),
    salesByGroup(accountId, days),
    taxByRegime(accountId, days),
  ]);

  if (summary.tickets === 0 && summary.refundCount === 0) {
    return (
      <Card>
        <EmptyState title={t("empty.noData")} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap divide-line sm:divide-x">
        <Stat label={t("inf.sales.tickets")} value={String(summary.tickets)} />
        <Stat label={t("inf.sales.net")} value={euros(summary.netCents)} />
        <Stat label={t("inf.sales.tax")} value={euros(summary.taxCents)} />
        <Stat label={t("inf.sales.gross")} value={euros(summary.grossCents)} />
        <Stat label={t("inf.sales.average")} value={euros(summary.averageTicketCents)} />
        <Stat
          label={t("inf.sales.refunds")}
          value={euros(summary.refundsCents)}
          sub={`${summary.refundCount}`}
        />
      </Card>

      <Card>
        <CardHead title={t("inf.tax")} hint={t("inf.taxHint")} />
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("inf.regime")}</TH>
                <TH right>{t("inf.lines")}</TH>
                <TH right>{t("doc.base")}</TH>
                <TH right>{t("doc.tax")}</TH>
                <TH right>{t("doc.total")}</TH>
              </tr>
            </thead>
            <tbody>
              {tax.map((row) => (
                <TR key={row.regime}>
                  <TD>{labelFor(t, "regime", row.regime)}</TD>
                  <TD right>{row.lines}</TD>
                  <TD right>{euros(row.baseCents)}</TD>
                  <TD right>{euros(row.taxCents)}</TD>
                  <TD right className="font-semibold">{euros(row.totalCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHead title={t("inf.sales.byGroup")} hint={t("inf.sales.byGroupHint")} />
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("cat.group")}</TH>
                <TH right>{t("inf.sales.count")}</TH>
                <TH right>{t("inf.sales.qty")}</TH>
                <TH right>{t("doc.base")}</TH>
                <TH right>{t("doc.tax")}</TH>
                <TH right>{t("doc.total")}</TH>
              </tr>
            </thead>
            <tbody>
              {groups.map((row) => (
                <TR key={row.key}>
                  <TD>{row.label}</TD>
                  <TD right>{row.count}</TD>
                  <TD right>{row.qty}</TD>
                  <TD right>{euros(row.netCents)}</TD>
                  <TD right>{euros(row.taxCents)}</TD>
                  <TD right className="font-semibold">{euros(row.grossCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- repairs -- */

async function RepairsReport({ accountId, t }: { accountId: string; t: T }) {
  const [open, closed] = await Promise.all([repairsOpen(accountId), repairsClosed(accountId)]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={t("inf.rep.open")} hint={t("inf.rep.openHint")} />
        {open.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("rp.device")}</TH>
                  <TH>{t("rp.customer")}</TH>
                  <TH>{t("rp.status")}</TH>
                  <TH right>{t("inf.rep.days")}</TH>
                  <TH>{t("rp.promised")}</TH>
                </tr>
              </thead>
              <tbody>
                {open.map((row) => (
                  <TR key={row.ticketId}>
                    <TD>{row.device}</TD>
                    <TD>{row.customerName}</TD>
                    <TD>{labelFor(t, "rps", row.status)}</TD>
                    <TD right>{row.daysSinceIntake}</TD>
                    <TD>
                      {row.overdue ? (
                        <Chip tone="bad">{t("inf.rep.overdue")}</Chip>
                      ) : (
                        (row.promisedDate ?? "—")
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHead title={t("inf.rep.closed")} hint={t("inf.rep.closedHint")} />
        {closed.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <>
            <CardBody className="pt-2">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("rp.device")}</TH>
                    <TH>{t("rp.customer")}</TH>
                    <TH>{t("rp.status")}</TH>
                    <TH right>{t("inf.rep.turnaround")}</TH>
                    <TH right>{t("inf.rep.parts")}</TH>
                    <TH right>{t("inf.rep.labour")}</TH>
                    <TH right>{t("inf.rep.charged")}</TH>
                  </tr>
                </thead>
                <tbody>
                  {closed.map((row) => (
                    <TR key={row.ticketId}>
                      <TD>{row.device}</TD>
                      <TD>{row.customerName}</TD>
                      <TD>{labelFor(t, "rps", row.status)}</TD>
                      <TD right>{row.turnaroundDays ?? "—"}</TD>
                      <TD right>{euros(row.partsCostCents)}</TD>
                      <TD right>{euros(row.labourCents)}</TD>
                      <TD right className="font-semibold">{euros(row.chargedCents)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
            {/* said on the screen rather than quietly omitted */}
            <div className="border-t border-line px-4 py-2.5 text-[11px] text-subtle sm:px-5">
              {t("inf.rep.noMargin")}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- used -- */

async function UsedReport({ accountId, t }: { accountId: string; t: T }) {
  const held = await usedHolding(accountId);
  const tiedUp = held.reduce((sum, row) => sum + row.costCents, 0);

  return (
    <Card>
      <CardHead
        title={t("inf.used.title")}
        hint={t("inf.used.hint")}
        action={
          <span className="tabular text-[12px] text-muted">
            {held.length} · {euros(tiedUp)}
          </span>
        }
      />
      {held.length === 0 ? (
        <EmptyState title={t("empty.noData")} />
      ) : (
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("us.device")}</TH>
                <TH>{t("us.grade")}</TH>
                <TH>{t("us.state")}</TH>
                <TH right>{t("inf.used.days")}</TH>
                <TH right>{t("inf.used.cost")}</TH>
                <TH right>{t("us.price")}</TH>
              </tr>
            </thead>
            <tbody>
              {held.map((row) => (
                <TR key={row.purchaseId}>
                  <TD>{row.model}</TD>
                  <TD>{row.grade ?? "—"}</TD>
                  <TD>{labelFor(t, "uss", row.state)}</TD>
                  <TD right>{row.daysHeld}</TD>
                  <TD right>{euros(row.costCents)}</TD>
                  <TD right>{row.salePriceCents === null ? "—" : euros(row.salePriceCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ valuation -- */

async function ValuationReport({ accountId, t }: { accountId: string; t: T }) {
  const [stock, vouchers] = await Promise.all([valuation(accountId), outstandingCredit(accountId)]);
  const atCost = stock.reduce((sum, row) => sum + row.atCostCents, 0);
  const atRetail = stock.reduce((sum, row) => sum + row.atRetailCents, 0);
  const owed = vouchers.reduce((sum, row) => sum + row.remainingCents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHead
          title={t("inf.valuation")}
          hint={t("inf.valuationHint")}
          action={
            <span className="tabular text-[12px] text-muted">
              {euros(atCost)} · {euros(atRetail)}
            </span>
          }
        />
        {stock.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("cat.group")}</TH>
                  <TH right>{t("inf.items")}</TH>
                  <TH right>{t("inf.units")}</TH>
                  <TH right>{t("inf.atCost")}</TH>
                  <TH right>{t("inf.atRetail")}</TH>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <TR key={row.group}>
                    <TD>{row.group}</TD>
                    <TD right>{row.items}</TD>
                    <TD right>{row.units}</TD>
                    <TD right>{euros(row.atCostCents)}</TD>
                    <TD right>{euros(row.atRetailCents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        )}
      </Card>

      {vouchers.length > 0 ? (
        <Card>
          <CardHead
            title={t("inf.credit")}
            hint={t("inf.creditHint")}
            action={<span className="tabular text-[12px] text-muted">{euros(owed)}</span>}
          />
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("doc.when")}</TH>
                  <TH right>{t("inf.issued")}</TH>
                  <TH right>{t("inf.remaining")}</TH>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((row) => (
                  <TR key={row.id}>
                    <TD>{dateTime(row.createdAt)}</TD>
                    <TD right>{euros(row.amountCents)}</TD>
                    <TD right className="font-semibold">{euros(row.remainingCents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- dead stock -- */

async function DeadStockReport({ accountId, t }: { accountId: string; t: T }) {
  const dead = await deadStock(accountId, 90);
  const stuck = dead.reduce((sum, row) => sum + row.atCostCents, 0);

  return (
    <Card>
      <CardHead
        title={t("inf.dead")}
        hint={t("inf.deadHint")}
        action={<span className="tabular text-[12px] text-muted">{euros(stuck)}</span>}
      />
      {dead.length === 0 ? (
        <EmptyState title={t("empty.noData")} />
      ) : (
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("cat.item")}</TH>
                <TH>{t("cat.group")}</TH>
                <TH right>{t("cat.stock")}</TH>
                <TH right>{t("inf.atCost")}</TH>
                <TH>{t("inf.lastSold")}</TH>
              </tr>
            </thead>
            <tbody>
              {dead.map((row) => (
                <TR key={row.name}>
                  <TD>{row.name}</TD>
                  <TD>{row.group ?? "—"}</TD>
                  <TD right>{row.onHand}</TD>
                  <TD right>{euros(row.atCostCents)}</TD>
                  <TD className={row.lastSoldAt ? undefined : "text-muted"}>
                    {row.lastSoldAt ? dateTime(row.lastSoldAt) : t("inf.never")}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
