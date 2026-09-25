/**
 * What the owner's dashboard reads — the till's own reporting rules, applied to
 * the stream instead of to SQLite.
 *
 * Four of those rules are load-bearing, and getting any of them wrong produces
 * a number that is merely plausible:
 *
 *  1. **Completed documents only, dated by `completedAt`** (ADR-0016 §1). A
 *     draft is a ticket somebody is still building and a parked sale is one
 *     nobody has paid for.
 *  2. **"Completed" is a STATUS, not an action.** A refund's final state
 *     arrives as `document/refund` rather than `document/complete` (ADR-0019),
 *     so filtering by action would silently drop every refund out of takings —
 *     and the day would read HIGHER than the shop took.
 *  3. **Latest state per document.** A document corrected after completion must
 *     count once, at the figure it ended on.
 *  4. **Aggregation is SQL.** Summing in a component would be a second
 *     implementation of the money (ADR-0016 §3).
 *
 * Isolation: every query takes an `accountId` and reaches rows only through
 * `tenants`, so there is no way to ask for a shop the signed-in account does
 * not own. ADR-0009's RLS is the second lock, when tenant #2 arrives.
 *
 * Time zone: a Spanish shop's day ends at midnight in Madrid, not in UTC.
 * Phase 1 is Spain only (ADR-0011 A1), so the zone is a constant rather than a
 * setting nobody has been asked for yet.
 */
import { sql, type SQL } from "drizzle-orm";
import { folded } from "./fold";
import { db as defaultDb, type CloudDb } from "./client";
import { previousPeriod, type Period as Window } from "../lib/range";

const ZONE = "Europe/Madrid";

/** The latest state of every COMPLETED document belonging to an account. */
const completedDocs = (accountId: string) => sql`
  select d.id,
    d.row->>'docNumber'                                    as doc_number,
    d.row->>'docType'                                      as doc_type,
    (d.row->>'totalCents')::bigint                         as total_cents,
    (d.row->>'taxCents')::bigint                           as tax_cents,
    (d.row->>'subtotalCents')::bigint                      as subtotal_cents,
    to_timestamp((d.row->>'completedAt')::bigint / 1000.0) as completed_at
  from (${folded(accountId, "document")}) d
  where d.row->>'status' = 'completed'
    and d.row->>'completedAt' is not null
`;

/**
 * The window, as two shop dates.
 *
 * `between` on a DATE, not a timestamp comparison: a shop's day runs to
 * midnight in Madrid, and the inclusive bounds are what "from the 3rd to the
 * 17th" means to the person who typed it. Resolving the dates once in
 * `parseRange` is what lets a custom range be the same code path as a preset
 * rather than a second one through nine queries.
 */
const within = (period: Window): SQL => sql`
  (completed_at at time zone ${ZONE})::date between ${period.from}::date and ${period.to}::date
`;

/** The window of the same length immediately before it — what we compare to. */
const withinPrevious = (period: Window): SQL => {
  const before = previousPeriod(period);
  return sql`
    (completed_at at time zone ${ZONE})::date between ${before.from}::date and ${before.to}::date
  `;
};

export interface PeriodTotals {
  netCents: number;
  documents: number;
  taxCents: number;
  averageCents: number;
  refundCents: number;
  refunds: number;
}

export interface PeriodComparison {
  current: PeriodTotals;
  previous: PeriodTotals;
  /** percentage change, or null when the previous period had nothing to compare */
  delta: { net: number | null; documents: number | null; average: number | null; tax: number | null };
}

const EMPTY: PeriodTotals = {
  netCents: 0,
  documents: 0,
  taxCents: 0,
  averageCents: 0,
  refundCents: 0,
  refunds: 0,
};

const shape = (row?: {
  net_cents: string | null;
  documents: number;
  tax_cents: string | null;
  refund_cents: string | null;
  refunds: number;
}): PeriodTotals => {
  const documents = Number(row?.documents ?? 0);
  const netCents = Number(row?.net_cents ?? 0);
  return {
    netCents,
    documents,
    taxCents: Number(row?.tax_cents ?? 0),
    /* integer cents, rounded once, at the edge of the query — never a float
       carried around and formatted later */
    averageCents: documents === 0 ? 0 : Math.round(netCents / documents),
    refundCents: Number(row?.refund_cents ?? 0),
    refunds: Number(row?.refunds ?? 0),
  };
};

/** A percentage only means something when there was something before. */
const change = (now: number, before: number): number | null =>
  before === 0 ? null : ((now - before) / Math.abs(before)) * 100;

export async function periodTotals(
  accountId: string,
  period: Window,
  handle?: CloudDb,
): Promise<PeriodComparison> {
  const db = handle ?? defaultDb();
  const totals = sql`
      coalesce(sum(total_cents), 0)                                    as net_cents,
      count(*)::int                                                    as documents,
      coalesce(sum(tax_cents), 0)                                      as tax_cents,
      coalesce(sum(total_cents) filter (where doc_type = 'refund'), 0) as refund_cents,
      count(*) filter (where doc_type = 'refund')::int                 as refunds
  `;

  const rows = await db.execute<{
    window: string;
    net_cents: string | null;
    documents: number;
    tax_cents: string | null;
    refund_cents: string | null;
    refunds: number;
  }>(sql`
    with docs as (${completedDocs(accountId)})
    select 'current' as window, ${totals} from docs where ${within(period)}
    union all
    select 'previous' as window, ${totals} from docs where ${withinPrevious(period)}
  `);

  const current = shape(rows.find((r) => r.window === "current"));
  const previous = shape(rows.find((r) => r.window === "previous"));

  return {
    current: current ?? EMPTY,
    previous: previous ?? EMPTY,
    delta: {
      net: change(current.netCents, previous.netCents),
      documents: change(current.documents, previous.documents),
      average: change(current.averageCents, previous.averageCents),
      tax: change(current.taxCents, previous.taxCents),
    },
  };
}

export interface DayRow {
  day: string;
  netCents: number;
  documents: number;
}

/**
 * Every day in the window, including the ones nothing happened on.
 *
 * A chart with the quiet days missing is a chart that lies about the shape of a
 * week — Sunday closed has to look like Sunday closed, not like it never
 * existed.
 */
export async function takingsByDay(
  accountId: string,
  period: Window,
  handle?: CloudDb,
): Promise<DayRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{ day: string; net_cents: string | null; documents: number }>(sql`
    with docs as (${completedDocs(accountId)}),
    calendar as (
      select generate_series(
        ${period.from}::date,
        ${period.to}::date,
        interval '1 day'
      )::date as day
    ),
    takings as (
      select (completed_at at time zone ${ZONE})::date as day,
             sum(total_cents)                          as net_cents,
             count(*)::int                             as documents
      from docs
      where ${within(period)}
      group by 1
    )
    select to_char(c.day, 'YYYY-MM-DD') as day,
           coalesce(t.net_cents, 0)     as net_cents,
           coalesce(t.documents, 0)     as documents
    from calendar c
    left join takings t on t.day = c.day
    order by c.day
  `);
  return rows.map((r) => ({
    day: r.day,
    netCents: Number(r.net_cents ?? 0),
    documents: Number(r.documents ?? 0),
  }));
}

export interface TenderRow {
  method: string;
  amountCents: number;
  count: number;
}

/**
 * How the shop was paid — from `document_tender` rows, which is where takings
 * live, never from the drawer ledger, which holds only what has no other home
 * (ADR-0015 §3). Counted only for documents that completed, so a draft
 * somebody tendered against and abandoned cannot appear as money.
 */
export async function paymentMix(
  accountId: string,
  period: Window,
  handle?: CloudDb,
): Promise<TenderRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{ method: string; amount_cents: string; n: number }>(sql`
    with docs as (${completedDocs(accountId)}),
    tenders as (
      select x.row->>'documentId'            as document_id,
             x.row->>'method'                as method,
             (x.row->>'amountCents')::bigint as amount_cents
      from (${folded(accountId, "document_tender")}) x
    )
    select t.method, sum(t.amount_cents) as amount_cents, count(*)::int as n
    from tenders t
    join docs d on d.id = t.document_id
    where ${within(period)}
    group by t.method
    order by sum(t.amount_cents) desc
  `);
  return rows.map((r) => ({
    method: r.method,
    amountCents: Number(r.amount_cents),
    count: Number(r.n),
  }));
}

export interface TopProductRow {
  description: string;
  qty: number;
  totalCents: number;
}

/** What actually sells, by value. Lines on completed documents, latest state. */
export async function topProducts(
  accountId: string,
  period: Window,
  limit = 8,
  handle?: CloudDb,
): Promise<TopProductRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{ description: string; qty: string; total_cents: string }>(sql`
    with docs as (${completedDocs(accountId)}),
    lines as (
      select x.row->>'documentId'           as document_id,
             x.row->>'description'          as description,
             (x.row->>'qty')::bigint        as qty,
             (x.row->>'totalCents')::bigint as total_cents
      from (${folded(accountId, "document_line")}) x
    )
    select l.description, sum(l.qty) as qty, sum(l.total_cents) as total_cents
    from lines l
    join docs d on d.id = l.document_id
    where ${within(period)} and l.description is not null
    group by l.description
    order by sum(l.total_cents) desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    description: r.description,
    qty: Number(r.qty),
    totalCents: Number(r.total_cents),
  }));
}

export interface DocumentRow {
  id: string;
  docNumber: string;
  docType: string;
  totalCents: number;
  taxCents: number;
  completedAt: Date;
}

/** The document list, with the period and an optional search applied in SQL. */
export async function documentsInPeriod(
  accountId: string,
  period: Window,
  options: { search?: string; docType?: string; limit?: number } = {},
  handle?: CloudDb,
): Promise<DocumentRow[]> {
  const db = handle ?? defaultDb();
  const search = options.search?.trim() ?? "";
  const docType = options.docType?.trim() ?? "";

  const rows = await db.execute<{
    id: string;
    doc_number: string;
    doc_type: string;
    total_cents: string;
    tax_cents: string;
    completed_at: Date;
  }>(sql`
    with docs as (${completedDocs(accountId)})
    select id, doc_number, doc_type, total_cents, tax_cents, completed_at
    from docs
    where ${within(period)}
      and (${search === ""} or doc_number ilike ${"%" + search + "%"})
      and (${docType === ""} or doc_type = ${docType})
    order by completed_at desc
    limit ${options.limit ?? 300}
  `);

  return rows.map((r) => ({
    id: r.id,
    docNumber: r.doc_number,
    docType: r.doc_type,
    totalCents: Number(r.total_cents),
    taxCents: Number(r.tax_cents),
    completedAt: new Date(r.completed_at),
  }));
}

export interface ShiftRow {
  zDocNumber: string | null;
  openedAt: Date;
  closedAt: Date;
  openingFloatCents: number;
  countedCashCents: number;
  expectedCashCents: number;
  varianceCents: number;
}

/**
 * Closed shifts — the Z history. Only closes: an open shift has no figures to
 * report yet, and a closed one is immutable, so what arrived is final
 * (ADR-0015 §7–8).
 */
/**
 * The closes inside the window on screen.
 *
 * Period-scoped like everything else on this page. It used to be "the last
 * eight, whatever you picked", which meant a dashboard set to January 2020
 * showed 2020's takings of zero beside a Z from last week — a card quietly
 * disagreeing with the control above it is worse than an empty card.
 */
export async function recentShifts(
  accountId: string,
  period: Window,
  limit = 8,
  handle?: CloudDb,
): Promise<ShiftRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    z_doc_number: string | null;
    opened_at: string;
    closed_at: string;
    opening_float_cents: string | null;
    counted_cash_cents: string | null;
    expected_cash_cents: string | null;
    variance_cents: string | null;
  }>(sql`
    select x.row->>'zDocNumber'                             as z_doc_number,
      to_timestamp((x.row->>'openedAt')::bigint / 1000.0) as opened_at,
      to_timestamp((x.row->>'closedAt')::bigint / 1000.0) as closed_at,
      x.row->>'openingFloatCents'                         as opening_float_cents,
      x.row->>'countedCashCents'                          as counted_cash_cents,
      x.row->>'expectedCashCents'                         as expected_cash_cents,
      x.row->>'varianceCents'                             as variance_cents
    from (${folded(accountId, "shift")}) x
    where x.row->>'closedAt' is not null
      and (to_timestamp((x.row->>'closedAt')::bigint / 1000.0) at time zone ${ZONE})::date
          between ${period.from}::date and ${period.to}::date
  `);

  return rows
    .map((r) => ({
      zDocNumber: r.z_doc_number,
      openedAt: new Date(r.opened_at),
      closedAt: new Date(r.closed_at),
      openingFloatCents: Number(r.opening_float_cents ?? 0),
      countedCashCents: Number(r.counted_cash_cents ?? 0),
      expectedCashCents: Number(r.expected_cash_cents ?? 0),
      varianceCents: Number(r.variance_cents ?? 0),
    }))
    .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime())
    .slice(0, limit);
}
