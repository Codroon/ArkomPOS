/**
 * What the owner's dashboard reads — the till's own reporting rules, applied to
 * the stream instead of to SQLite.
 *
 * Three of those rules are load-bearing here and are worth stating, because
 * getting any of them wrong produces a number that is merely plausible:
 *
 *  1. **Completed documents only, dated by `completedAt`** (ADR-0016 §1). A
 *     draft is a ticket somebody is still building and a parked sale is one
 *     nobody has paid for. `createdAt` answers "when did someone start typing",
 *     which is not a question anybody asks about money.
 *  2. **"Completed" is a STATUS, not an action.** A refund's final state
 *     arrives as `document/refund` rather than `document/complete` (ADR-0019 —
 *     a refund is its own document), so filtering by action would silently drop
 *     every refund out of the day's takings.
 *  3. **Aggregation is SQL.** Summing in a component would be a second
 *     implementation of the money (ADR-0016 §3).
 *
 * Isolation: every query takes an `accountId` and reaches rows only through
 * `tenants`, so there is no way to ask for a shop the signed-in account does
 * not own. ADR-0009's RLS is the second lock, when tenant #2 arrives.
 *
 * Time zone: a Spanish shop's day ends at midnight in Madrid, not in UTC. A
 * sale at 00:30 is 22:30 the previous day in UTC, and bucketing it there would
 * put it on yesterday's takings. Phase 1 is Spain only (ADR-0011 A1), so the
 * zone is a constant rather than a setting nobody has been asked for yet.
 */
import { sql } from "drizzle-orm";
import { db as defaultDb, type CloudDb } from "./client";

const ZONE = "Europe/Madrid";

/**
 * The latest state of every COMPLETED document belonging to an account.
 *
 * `distinct on (id) … order by id, seq desc` takes the newest op per document:
 * a till that pushed a correction later must not leave the earlier figure in a
 * total.
 */
const completedDocs = (accountId: string) => sql`
  select distinct on (e.after->>'id')
    e.after->>'id'                                   as id,
    e.after->>'docNumber'                            as doc_number,
    e.after->>'docType'                              as doc_type,
    (e.after->>'totalCents')::bigint                 as total_cents,
    (e.after->>'taxCents')::bigint                   as tax_cents,
    (e.after->>'subtotalCents')::bigint              as subtotal_cents,
    to_timestamp((e.after->>'completedAt')::bigint / 1000.0) as completed_at,
    e.tenant_id                                      as tenant_id
  from sync_entries e
  where e.tenant_id in (select t.id from tenants t where t.account_id = ${accountId})
    and e.entity = 'document'
    and e.after->>'status' = 'completed'
    and e.after->>'completedAt' is not null
  order by e.after->>'id', e.seq desc
`;

export interface DayTotals {
  /** takings: everything completed, refunds included as the negatives they are */
  netCents: number;
  documents: number;
  refundCents: number;
  refunds: number;
}

export async function todayTotals(accountId: string, handle?: CloudDb): Promise<DayTotals> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    net_cents: string | null;
    documents: number;
    refund_cents: string | null;
    refunds: number;
  }>(sql`
    with docs as (${completedDocs(accountId)})
    select
      coalesce(sum(total_cents), 0)                                        as net_cents,
      count(*)::int                                                        as documents,
      coalesce(sum(total_cents) filter (where doc_type = 'refund'), 0)     as refund_cents,
      count(*) filter (where doc_type = 'refund')::int                     as refunds
    from docs
    where (completed_at at time zone ${ZONE})::date = (now() at time zone ${ZONE})::date
  `);
  const row = rows[0];
  return {
    netCents: Number(row?.net_cents ?? 0),
    documents: Number(row?.documents ?? 0),
    refundCents: Number(row?.refund_cents ?? 0),
    refunds: Number(row?.refunds ?? 0),
  };
}

export interface DayRow {
  day: string;
  netCents: number;
  documents: number;
}

/** The last N days a shop actually sold on, newest first. */
export async function dailyTakings(accountId: string, days = 14, handle?: CloudDb): Promise<DayRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{ day: string; net_cents: string; documents: number }>(sql`
    with docs as (${completedDocs(accountId)})
    select
      to_char((completed_at at time zone ${ZONE})::date, 'YYYY-MM-DD') as day,
      sum(total_cents)                                                 as net_cents,
      count(*)::int                                                    as documents
    from docs
    group by 1
    order by 1 desc
    limit ${days}
  `);
  return rows.map((r) => ({
    day: r.day,
    netCents: Number(r.net_cents),
    documents: Number(r.documents),
  }));
}

export interface DocumentRow {
  docNumber: string;
  docType: string;
  totalCents: number;
  taxCents: number;
  completedAt: Date;
}

export async function recentDocuments(
  accountId: string,
  limit = 12,
  handle?: CloudDb,
): Promise<DocumentRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    doc_number: string;
    doc_type: string;
    total_cents: string;
    tax_cents: string;
    completed_at: Date;
  }>(sql`
    with docs as (${completedDocs(accountId)})
    select doc_number, doc_type, total_cents, tax_cents, completed_at
    from docs
    order by completed_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    docNumber: r.doc_number,
    docType: r.doc_type,
    totalCents: Number(r.total_cents),
    taxCents: Number(r.tax_cents),
    completedAt: new Date(r.completed_at),
  }));
}

export interface TenderRow {
  method: string;
  amountCents: number;
  count: number;
}

/**
 * How the shop was paid.
 *
 * Read from `document_tender` rows, which is where takings live — never from
 * the drawer ledger, which holds only what has no other home (ADR-0015 §3).
 * Tenders are only counted for documents that actually completed, so a draft
 * somebody tendered and abandoned cannot appear as money.
 */
export async function tenderSplit(accountId: string, days = 30, handle?: CloudDb): Promise<TenderRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{ method: string; amount_cents: string; n: number }>(sql`
    with docs as (${completedDocs(accountId)}),
    tenders as (
      select distinct on (e.after->>'id')
        e.after->>'id'                   as id,
        e.after->>'documentId'           as document_id,
        e.after->>'method'               as method,
        (e.after->>'amountCents')::bigint as amount_cents
      from sync_entries e
      where e.tenant_id in (select t.id from tenants t where t.account_id = ${accountId})
        and e.entity = 'document_tender'
      order by e.after->>'id', e.seq desc
    )
    select t.method, sum(t.amount_cents) as amount_cents, count(*)::int as n
    from tenders t
    join docs d on d.id = t.document_id
    where d.completed_at >= now() - (${days} || ' days')::interval
    group by t.method
    order by sum(t.amount_cents) desc
  `);
  return rows.map((r) => ({
    method: r.method,
    amountCents: Number(r.amount_cents),
    count: Number(r.n),
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
 * Closed shifts — the Z history.
 *
 * Only closes: an open shift has no figures to report yet, and a closed one is
 * immutable, so what arrived is final (ADR-0015 §7–8).
 */
export async function recentShifts(accountId: string, limit = 8, handle?: CloudDb): Promise<ShiftRow[]> {
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
    select distinct on (e.after->>'id')
      e.after->>'zDocNumber'                                  as z_doc_number,
      to_timestamp((e.after->>'openedAt')::bigint / 1000.0)   as opened_at,
      to_timestamp((e.after->>'closedAt')::bigint / 1000.0)   as closed_at,
      e.after->>'openingFloatCents'                           as opening_float_cents,
      e.after->>'countedCashCents'                            as counted_cash_cents,
      e.after->>'expectedCashCents'                           as expected_cash_cents,
      e.after->>'varianceCents'                               as variance_cents
    from sync_entries e
    where e.tenant_id in (select t.id from tenants t where t.account_id = ${accountId})
      and e.entity = 'shift'
      and e.action = 'close'
      and e.after->>'closedAt' is not null
    order by e.after->>'id', e.seq desc
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
