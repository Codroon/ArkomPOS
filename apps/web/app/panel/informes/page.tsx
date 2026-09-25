/**
 * Informes — the same five reports the till has at nav 10.
 *
 * Deliberately mirrors `apps/desktop/src/renderer/src/screens/reports/`: a
 * figure has to mean the same thing whether the owner reads it on the counter
 * or on a phone. Two reports with the same name and different columns is how a
 * shop learns to trust neither.
 *
 * The tabs scroll sideways on a phone rather than wrapping onto a second line —
 * six of them wrapped is two rows of chrome above a fiscal figure, and the one
 * you are on can end up on the line you are not looking at. Sideways, the
 * current tab is always the anchor.
 *
 * The tab lives in the URL so a link opens on the report it was sent about.
 */
import Link from "next/link";
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor, plural } from "../../../src/i18n";
import { parseRange, rangeParams, type Period } from "../../../src/lib/range";
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
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Stat,
  StatGrid,
  cn,
  ghostClass,
  type Column,
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
  const { t, locale } = await getT();
  const params = await searchParams;
  const period = parseRange(params.range, params.from, params.to);

  const asked = typeof params.report === "string" ? params.report : "";
  const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : "sales";

  /* a preset is one parameter, a custom window is three — `rangeParams` keeps
     tab links and the export on the SAME window the screen is showing */
  const carry = new URLSearchParams(rangeParams(period));
  const href = (next: Tab) => {
    const query = new URLSearchParams(carry);
    query.set("report", next);
    return `/panel/informes?${query.toString()}`;
  };
  const exportHref = (next: Tab) => {
    const query = new URLSearchParams(carry);
    query.set("report", next);
    return `/panel/informes/export?${query.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3 border-b border-line">
        {/* -mx-4 so the strip bleeds to the screen edge on a phone: a tab that
            is half cut off at the edge is the affordance that says "scroll me" */}
        <nav className="-mx-4 flex min-w-0 flex-1 gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {TABS.map((key) => (
            <Link
              key={key}
              href={href(key)}
              aria-current={key === tab ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-3 text-[13px] whitespace-nowrap",
                key === tab
                  ? "border-ink font-semibold text-ink"
                  : "border-transparent text-muted hover:text-ink-2",
              )}
            >
              {t(`inf.tab.${key}` as "inf.tab.sales")}
            </Link>
          ))}
        </nav>
        {/* re-runs the same query this tab just ran, for the same period.
            cn() and not a template string: `ghostClass` already sets a display,
            and two display utilities in one class attribute are resolved by
            whichever Tailwind emitted last — which is how this button rendered
            TWICE on a phone. twMerge drops the loser. */}
        <a
          className={cn(ghostClass, "mb-1.5 hidden shrink-0 sm:inline-flex")}
          href={exportHref(tab)}
        >
          {t("sales.export")}
        </a>
      </div>

      <a
        className={cn(ghostClass, "flex w-full sm:hidden")}
        href={exportHref(tab)}
      >
        {t("sales.export")}
      </a>

      {tab === "sales" ? <SalesReport accountId={account.id} period={period} t={t} locale={locale} /> : null}
      {tab === "repairs" ? <RepairsReport accountId={account.id} t={t} /> : null}
      {tab === "used" ? <UsedReport accountId={account.id} t={t} /> : null}
      {tab === "valuation" ? <ValuationReport accountId={account.id} t={t} locale={locale} /> : null}
      {tab === "dead" ? <DeadStockReport accountId={account.id} t={t} locale={locale} /> : null}
    </div>
  );
}

type T = Awaited<ReturnType<typeof getT>>["t"];
type L = Awaited<ReturnType<typeof getT>>["locale"];

/* ---------------------------------------------------------------- sales -- */

async function SalesReport({
  accountId,
  period,
  t,
  locale,
}: {
  accountId: string;
  period: Period;
  t: T;
  locale: L;
}) {
  const [summary, groups, tax] = await Promise.all([
    salesSummary(accountId, period),
    salesByGroup(accountId, period, locale),
    taxByRegime(accountId, period),
  ]);

  if (summary.tickets === 0 && summary.refundCount === 0) {
    return (
      <Card>
        <EmptyState title={t("empty.noData")} />
      </Card>
    );
  }

  const taxColumns: Column<(typeof tax)[number]>[] = [
    {
      key: "regime",
      header: t("inf.regime"),
      card: "title",
      render: (r) => labelFor(t, "regime", r.regime),
    },
    { key: "lines", header: t("inf.lines"), align: "right", card: "meta", render: (r) => r.lines },
    {
      key: "base",
      header: t("doc.base"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.baseCents),
    },
    {
      key: "tax",
      header: t("doc.tax"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.taxCents),
    },
    {
      key: "total",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.totalCents),
    },
  ];

  const groupColumns: Column<(typeof groups)[number]>[] = [
    { key: "group", header: t("cat.group"), card: "title", render: (r) => r.label },
    {
      key: "count",
      header: t("inf.sales.count"),
      align: "right",
      card: "meta",
      render: (r) => r.count,
    },
    { key: "qty", header: t("inf.sales.qty"), align: "right", card: "meta", render: (r) => r.qty },
    {
      key: "base",
      header: t("doc.base"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.netCents),
    },
    {
      key: "tax",
      header: t("doc.tax"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.taxCents),
    },
    {
      key: "total",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.grossCents),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid cols={6}>
        <Stat label={t("inf.sales.tickets")} value={String(summary.tickets)} />
        <Stat label={t("inf.sales.net")} value={euros(summary.netCents)} />
        <Stat label={t("inf.sales.tax")} value={euros(summary.taxCents)} />
        <Stat label={t("inf.sales.gross")} value={euros(summary.grossCents)} />
        <Stat label={t("inf.sales.average")} value={euros(summary.averageTicketCents)} />
        <Stat
          label={t("inf.sales.refunds")}
          value={euros(summary.refundsCents)}
          sub={plural(t, "inf.sales.refundCount", summary.refundCount)}
        />
      </StatGrid>

      <Card>
        <CardHead title={t("inf.tax")} hint={t("inf.taxHint")} />
        <DataTable
          rows={tax}
          columns={taxColumns}
          rowKey={(r) => r.regime}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>

      <Card>
        <CardHead title={t("inf.sales.byGroup")} hint={t("inf.sales.byGroupHint")} />
        <DataTable
          rows={groups}
          columns={groupColumns}
          rowKey={(r) => r.key}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- repairs -- */

async function RepairsReport({ accountId, t }: { accountId: string; t: T }) {
  const [open, closed] = await Promise.all([repairsOpen(accountId), repairsClosed(accountId)]);

  const openColumns: Column<(typeof open)[number]>[] = [
    { key: "device", header: t("rp.device"), card: "title", render: (r) => r.device },
    { key: "customer", header: t("rp.customer"), card: "sub", render: (r) => r.customerName },
    {
      key: "status",
      header: t("rp.status"),
      card: "badge",
      render: (r) => <Chip>{labelFor(t, "rps", r.status)}</Chip>,
    },
    {
      key: "promised",
      header: t("rp.promised"),
      card: "meta",
      render: (r) =>
        r.overdue ? <Chip tone="bad">{t("inf.rep.overdue")}</Chip> : (r.promisedDate ?? "—"),
    },
    {
      key: "days",
      header: t("inf.rep.days"),
      align: "right",
      card: "figure",
      render: (r) => r.daysSinceIntake,
    },
  ];

  const closedColumns: Column<(typeof closed)[number]>[] = [
    { key: "device", header: t("rp.device"), card: "title", render: (r) => r.device },
    { key: "customer", header: t("rp.customer"), card: "sub", render: (r) => r.customerName },
    {
      key: "status",
      header: t("rp.status"),
      card: "badge",
      render: (r) => <Chip>{labelFor(t, "rps", r.status)}</Chip>,
    },
    {
      key: "turnaround",
      header: t("inf.rep.turnaround"),
      align: "right",
      card: "meta",
      render: (r) => r.turnaroundDays ?? "—",
    },
    {
      key: "parts",
      header: t("inf.rep.parts"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.partsCostCents),
    },
    {
      key: "labour",
      header: t("inf.rep.labour"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.labourCents),
    },
    {
      key: "charged",
      header: t("inf.rep.charged"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.chargedCents),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={t("inf.rep.open")} hint={t("inf.rep.openHint")} />
        <DataTable
          rows={open}
          columns={openColumns}
          rowKey={(r) => r.ticketId}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>

      <Card>
        <CardHead title={t("inf.rep.closed")} hint={t("inf.rep.closedHint")} />
        <DataTable
          rows={closed}
          columns={closedColumns}
          rowKey={(r) => r.ticketId}
          empty={<EmptyState title={t("empty.noData")} />}
        />
        {/* said on the screen rather than quietly omitted */}
        {closed.length > 0 ? (
          <div className="border-t border-line px-4 py-2.5 text-[11px] text-subtle sm:px-5">
            {t("inf.rep.noMargin")}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- used -- */

async function UsedReport({ accountId, t }: { accountId: string; t: T }) {
  const held = await usedHolding(accountId);
  const tiedUp = held.reduce((sum, row) => sum + row.costCents, 0);
  const oldest = held.reduce((most, row) => Math.max(most, row.daysHeld), 0);

  const columns: Column<(typeof held)[number]>[] = [
    { key: "device", header: t("us.device"), card: "title", render: (r) => r.model },
    { key: "grade", header: t("us.grade"), card: "sub", render: (r) => r.grade ?? "—" },
    {
      key: "state",
      header: t("us.state"),
      card: "badge",
      render: (r) => <Chip>{labelFor(t, "uss", r.state)}</Chip>,
    },
    {
      key: "days",
      header: t("inf.used.days"),
      align: "right",
      card: "figure",
      render: (r) => r.daysHeld,
    },
    {
      key: "cost",
      header: t("inf.used.cost"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.costCents),
    },
    {
      key: "price",
      header: t("us.price"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => (r.salePriceCents === null ? "—" : euros(r.salePriceCents)),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("us.holdingCount")} value={String(held.length)} />
        <Stat label={t("inf.used.cost")} value={euros(tiedUp)} />
        <Stat label={t("inf.used.days")} value={String(oldest)} sub={t("inf.used.oldestHint")} />
      </StatGrid>

      <Card>
        <CardHead title={t("inf.used.title")} hint={t("inf.used.hint")} />
        <DataTable
          rows={held}
          columns={columns}
          rowKey={(r) => r.purchaseId}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ valuation -- */

async function ValuationReport({ accountId, t, locale }: { accountId: string; t: T; locale: L }) {
  const [stock, vouchers] = await Promise.all([valuation(accountId, locale), outstandingCredit(accountId)]);
  const atCost = stock.reduce((sum, row) => sum + row.atCostCents, 0);
  const atRetail = stock.reduce((sum, row) => sum + row.atRetailCents, 0);
  const owed = vouchers.reduce((sum, row) => sum + row.remainingCents, 0);

  const stockColumns: Column<(typeof stock)[number]>[] = [
    { key: "group", header: t("cat.group"), card: "title", render: (r) => r.group },
    { key: "items", header: t("inf.items"), align: "right", card: "meta", render: (r) => r.items },
    { key: "units", header: t("inf.units"), align: "right", card: "meta", render: (r) => r.units },
    {
      key: "cost",
      header: t("inf.atCost"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.atCostCents),
    },
    {
      key: "retail",
      header: t("inf.atRetail"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.atRetailCents),
    },
  ];

  const voucherColumns: Column<(typeof vouchers)[number]>[] = [
    { key: "when", header: t("doc.when"), card: "title", render: (r) => dateTime(r.createdAt) },
    {
      key: "issued",
      header: t("inf.issued"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.amountCents),
    },
    {
      key: "left",
      header: t("inf.remaining"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.remainingCents),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("inf.atCost")} value={euros(atCost)} />
        <Stat label={t("inf.atRetail")} value={euros(atRetail)} />
        <Stat label={t("inf.credit")} value={euros(owed)} sub={t("inf.creditShort")} />
      </StatGrid>

      <Card>
        <CardHead title={t("inf.valuation")} hint={t("inf.valuationHint")} />
        <DataTable
          rows={stock}
          columns={stockColumns}
          rowKey={(r) => r.group}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>

      {vouchers.length > 0 ? (
        <Card>
          <CardHead title={t("inf.credit")} hint={t("inf.creditHint")} />
          <DataTable rows={vouchers} columns={voucherColumns} rowKey={(r) => r.id} />
        </Card>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- dead stock -- */

async function DeadStockReport({ accountId, t, locale }: { accountId: string; t: T; locale: L }) {
  const dead = await deadStock(accountId, 90, locale);
  const stuck = dead.reduce((sum, row) => sum + row.atCostCents, 0);
  const never = dead.filter((row) => !row.lastSoldAt).length;

  const columns: Column<(typeof dead)[number]>[] = [
    { key: "item", header: t("cat.item"), card: "title", render: (r) => r.name },
    { key: "group", header: t("cat.group"), card: "sub", render: (r) => r.group ?? "—" },
    {
      key: "last",
      header: t("inf.lastSold"),
      card: "badge",
      render: (r) =>
        r.lastSoldAt ? (
          <span className="text-[11.5px] text-muted">{dateTime(r.lastSoldAt)}</span>
        ) : (
          <Chip tone="warn">{t("inf.never")}</Chip>
        ),
    },
    {
      key: "stock",
      header: t("cat.stock"),
      align: "right",
      card: "figure",
      render: (r) => r.onHand,
    },
    {
      key: "cost",
      header: t("inf.atCost"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (r) => euros(r.atCostCents),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("inf.items")} value={String(dead.length)} />
        <Stat label={t("inf.atCost")} value={euros(stuck)} sub={t("inf.deadShort")} />
        <Stat label={t("inf.never")} value={String(never)} />
      </StatGrid>

      <Card>
        <CardHead title={t("inf.dead")} hint={t("inf.deadHint")} />
        <DataTable
          rows={dead}
          columns={columns}
          rowKey={(r) => r.name}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>
    </div>
  );
}
