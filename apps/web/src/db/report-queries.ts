/**
 * Informes — the same reports the till has at nav 10, answered from the stream.
 *
 * The shapes deliberately mirror `apps/desktop/src/main/repos/reports.ts`: a
 * figure has to mean the same thing whether the owner reads it on the counter
 * or on a phone, and two reports with the same name and different columns is
 * how a shop stops trusting both.
 *
 * Same rules as the till's (ADR-0016): completed documents only, dated by
 * `completed_at`, aggregated in SQL, and the tax figures are the ones
 * SNAPSHOTTED onto the lines rather than recomputed from a rate. Stock is a sum
 * of movements, never a stored figure.
 *
 * Where a column on the till cannot be derived faithfully from the stream it is
 * LEFT OUT rather than approximated — a plausible wrong number in a report is
 * worse than a missing one, and the missing one gets asked about.
 */
import { sql } from "drizzle-orm";
import { folded } from "./fold";
import { groupName, productName } from "./our-words";
import type { Locale } from "../i18n";
import { db as defaultDb, type CloudDb } from "./client";
import type { Period as Window } from "../lib/range";

const ZONE = "Europe/Madrid";

const mine = (accountId: string) => sql`
  (select t.id from tenants t where t.account_id = ${accountId})
`;

/** The current state of every row of an entity — see `./fold`. */
const latest = (accountId: string, entity: string) => folded(accountId, entity);

/** Completed documents in the window, latest state each. */
const completedIn = (accountId: string, period: Window) => sql`
  select * from (
    select f.id,
      f.row->>'docType'                 as doc_type,
      (f.row->>'totalCents')::bigint    as total_cents,
      (f.row->>'taxCents')::bigint      as tax_cents,
      (f.row->>'subtotalCents')::bigint as subtotal_cents,
      to_timestamp((f.row->>'completedAt')::bigint / 1000.0) as completed_at
    from (${folded(accountId, "document")}) f
    where f.row->>'status' = 'completed'
      and f.row->>'completedAt' is not null
  ) d
  where (d.completed_at at time zone ${ZONE})::date
        between ${period.from}::date and ${period.to}::date
`;

/* ---------------------------------------------------------------- sales -- */

export interface SalesSummary {
  tickets: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
  averageTicketCents: number;
  /** margin-scheme sales, on their own line because they carry no VAT */
  usedSalesCents: number;
  /** what was handed back, POSITIVE — already netted out of the figures above */
  refundsCents: number;
  refundCount: number;
}

export async function salesSummary(
  accountId: string,
  period: Window,
  handle?: CloudDb,
): Promise<SalesSummary> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    tickets: number;
    net_cents: string | null;
    tax_cents: string | null;
    gross_cents: string | null;
    refunds_cents: string | null;
    refund_count: number;
    used_cents: string | null;
  }>(sql`
    with docs as (${completedIn(accountId, period)}),
    rebu as (
      select x.row->>'documentId'           as document_id,
             (x.row->>'totalCents')::bigint as total_cents,
             x.row->>'taxRegime'            as regime
      from (${folded(accountId, "document_line")}) x
    )
    select
      count(*) filter (where doc_type <> 'refund')::int      as tickets,
      coalesce(sum(subtotal_cents), 0)                       as net_cents,
      coalesce(sum(tax_cents), 0)                            as tax_cents,
      coalesce(sum(total_cents), 0)                          as gross_cents,
      coalesce(-sum(total_cents) filter (where doc_type = 'refund'), 0) as refunds_cents,
      count(*) filter (where doc_type = 'refund')::int       as refund_count,
      coalesce((select sum(r.total_cents) from rebu r
                join docs d2 on d2.id = r.document_id
                where r.regime = 'REBU'), 0)                 as used_cents
    from docs
  `);

  const row = rows[0];
  const tickets = Number(row?.tickets ?? 0);
  const gross = Number(row?.gross_cents ?? 0);

  return {
    tickets,
    netCents: Number(row?.net_cents ?? 0),
    taxCents: Number(row?.tax_cents ?? 0),
    grossCents: gross,
    /* rounded once, here, in whole cents — never a float carried to a view */
    averageTicketCents: tickets === 0 ? 0 : Math.round(gross / tickets),
    usedSalesCents: Number(row?.used_cents ?? 0),
    refundsCents: Number(row?.refunds_cents ?? 0),
    refundCount: Number(row?.refund_count ?? 0),
  };
}

export interface SalesRow {
  key: string;
  label: string;
  count: number;
  qty: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/** Sales broken down by the shelf they came off, like the till's. */
export async function salesByGroup(
  accountId: string,
  period: Window,
  locale: Locale = "es",
  handle?: CloudDb,
): Promise<SalesRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    key: string;
    label: string;
    count: number;
    qty: string;
    net_cents: string;
    tax_cents: string;
    gross_cents: string;
  }>(sql`
    with docs as (${completedIn(accountId, period)}),
    lines as (
      select x.row->>'documentId'           as document_id,
             x.row->>'productId'            as product_id,
             x.row->>'description'          as description,
             (x.row->>'qty')::bigint        as qty,
             (x.row->>'baseCents')::bigint  as base_cents,
             (x.row->>'taxCents')::bigint   as tax_cents,
             (x.row->>'totalCents')::bigint as total_cents
      from (${folded(accountId, "document_line")}) x
    ),
    products as (${latest(accountId, "product")}),
    groups as (${latest(accountId, "product_group")})
    select
      coalesce(g.id, 'sin-grupo')                  as key,
      coalesce(${groupName("g.row", locale)}, '—') as label,
      count(*)::int                         as count,
      coalesce(sum(l.qty), 0)               as qty,
      coalesce(sum(l.base_cents), 0)        as net_cents,
      coalesce(sum(l.tax_cents), 0)         as tax_cents,
      coalesce(sum(l.total_cents), 0)       as gross_cents
    from lines l
    join docs d on d.id = l.document_id
    left join products p on p.id = l.product_id
    left join groups g on g.id = p.row->>'groupId'
    group by 1, 2
    order by sum(l.total_cents) desc
  `);

  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    count: Number(r.count),
    qty: Number(r.qty),
    netCents: Number(r.net_cents),
    taxCents: Number(r.tax_cents),
    grossCents: Number(r.gross_cents),
  }));
}

export interface TaxRow {
  regime: string;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  lines: number;
}

/** Base and IVA per regime — REBU on its own row, never averaged in. */
export async function taxByRegime(
  accountId: string,
  period: Window,
  handle?: CloudDb,
): Promise<TaxRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    regime: string;
    base_cents: string;
    tax_cents: string;
    total_cents: string;
    lines: number;
  }>(sql`
    with docs as (${completedIn(accountId, period)}),
    lines as (
      select x.row->>'documentId'                   as document_id,
             coalesce(x.row->>'taxRegime', 'IVA21') as regime,
             (x.row->>'baseCents')::bigint          as base_cents,
             (x.row->>'taxCents')::bigint           as tax_cents,
             (x.row->>'totalCents')::bigint         as total_cents
      from (${folded(accountId, "document_line")}) x
    )
    select l.regime,
           coalesce(sum(l.base_cents), 0)  as base_cents,
           coalesce(sum(l.tax_cents), 0)   as tax_cents,
           coalesce(sum(l.total_cents), 0) as total_cents,
           count(*)::int                   as lines
    from lines l
    join docs d on d.id = l.document_id
    group by l.regime
    order by sum(l.total_cents) desc
  `);

  return rows.map((r) => ({
    regime: r.regime,
    baseCents: Number(r.base_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    lines: Number(r.lines),
  }));
}

/* -------------------------------------------------------------- repairs -- */

export interface RepairOpenRow {
  ticketId: string;
  customerName: string;
  device: string;
  status: string;
  daysSinceIntake: number;
  promisedDate: string | null;
  overdue: boolean;
}

/** Still owes the customer something: booked in and not yet handed back. */
const OPEN_STATUSES = ["received", "quoted", "waiting_part", "in_repair", "ready"];

/* An explicit IN list rather than `= any($1)`: a JS array does not bind to an
   array parameter through a raw drizzle template, and the query fails at the
   server rather than at the type checker. */
const openStatusList = sql.join(
  OPEN_STATUSES.map((status) => sql`${status}`),
  sql`, `,
);

export async function repairsOpen(accountId: string, handle?: CloudDb): Promise<RepairOpenRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    ticket_id: string;
    customer_name: string | null;
    device: string;
    status: string;
    days_since_intake: number;
    promised_date: string | null;
  }>(sql`
    with tickets as (${latest(accountId, "repair_ticket")}),
    customers as (${latest(accountId, "customer")})
    select
      t.id                               as ticket_id,
      c.row->>'name'                             as customer_name,
      coalesce(t.row->>'deviceDescription', '—') as device,
      coalesce(t.row->>'status', 'received')     as status,
      greatest(0, extract(day from now() - to_timestamp((t.row->>'createdAt')::bigint / 1000.0))::int)
                                                 as days_since_intake,
      t.row->>'promisedDate'                     as promised_date
    from tickets t
    left join customers c on c.id = t.row->>'customerId'
    where coalesce(t.row->>'status', 'received') in (${openStatusList})
    order by (t.row->>'createdAt')::bigint asc
  `);

  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({
    ticketId: r.ticket_id,
    customerName: r.customer_name ?? "—",
    device: r.device,
    status: r.status,
    daysSinceIntake: Number(r.days_since_intake ?? 0),
    promisedDate: r.promised_date,
    /* promised and not yet handed back: the column the counter actually acts on */
    overdue: Boolean(r.promised_date && r.promised_date < today),
  }));
}

export interface RepairClosedRow {
  ticketId: string;
  customerName: string;
  device: string;
  status: string;
  intakeAt: Date | null;
  closedAt: Date | null;
  turnaroundDays: number | null;
  partsCostCents: number;
  labourCents: number;
  chargedCents: number;
}

/**
 * Repairs that have left the workshop.
 *
 * The till's version also shows MARGIN, worked out against the revenue on the
 * collection ticket. That is left out here rather than approximated: the
 * collection document is a separate `T1-` (ADR-0014), and tying each one back
 * to its ticket from the stream is a join this report cannot make faithfully
 * yet. What is shown is what the lines themselves say — parts at cost, labour,
 * and what the ticket was charged at.
 */
export async function repairsClosed(
  accountId: string,
  handle?: CloudDb,
): Promise<RepairClosedRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    ticket_id: string;
    customer_name: string | null;
    device: string;
    status: string;
    intake_at: string | null;
    closed_at: string | null;
    parts_cost_cents: string | null;
    labour_cents: string | null;
    charged_cents: string | null;
  }>(sql`
    with tickets as (${latest(accountId, "repair_ticket")}),
    customers as (${latest(accountId, "customer")}),
    lines as (${latest(accountId, "repair_line")})
    select
      t.id                               as ticket_id,
      c.row->>'name'                             as customer_name,
      coalesce(t.row->>'deviceDescription', '—') as device,
      coalesce(t.row->>'status', '—')            as status,
      case when t.row->>'createdAt' is null then null
           else to_timestamp((t.row->>'createdAt')::bigint / 1000.0) end as intake_at,
      case when t.row->>'updatedAt' is null then null
           else to_timestamp((t.row->>'updatedAt')::bigint / 1000.0) end as closed_at,
      (select coalesce(sum((l.row->>'unitCostCents')::bigint * (l.row->>'qty')::bigint), 0)
         from lines l where l.row->>'ticketId' = t.id
                        and l.row->>'kind' <> 'labor')            as parts_cost_cents,
      (select coalesce(sum((l.row->>'chargeCents')::bigint), 0)
         from lines l where l.row->>'ticketId' = t.id
                        and l.row->>'kind' = 'labor')             as labour_cents,
      (select coalesce(sum((l.row->>'chargeCents')::bigint), 0)
         from lines l where l.row->>'ticketId' = t.id)    as charged_cents
    from tickets t
    left join customers c on c.id = t.row->>'customerId'
    where coalesce(t.row->>'status', '') in ('collected', 'not_repaired')
    order by (t.row->>'updatedAt')::bigint desc nulls last
  `);

  return rows.map((r) => {
    const intakeAt = r.intake_at ? new Date(r.intake_at) : null;
    const closedAt = r.closed_at ? new Date(r.closed_at) : null;
    return {
      ticketId: r.ticket_id,
      customerName: r.customer_name ?? "—",
      device: r.device,
      status: r.status,
      intakeAt,
      closedAt,
      turnaroundDays:
        intakeAt && closedAt
          ? Math.max(0, Math.round((closedAt.getTime() - intakeAt.getTime()) / 86_400_000))
          : null,
      partsCostCents: Number(r.parts_cost_cents ?? 0),
      labourCents: Number(r.labour_cents ?? 0),
      chargedCents: Number(r.charged_cents ?? 0),
    };
  });
}

/* ------------------------------------------------------------ used held -- */

export interface UsedHoldingRow {
  purchaseId: string;
  model: string;
  grade: string | null;
  state: string;
  costCents: number;
  salePriceCents: number | null;
  daysHeld: number;
}

/** Bought and not yet sold — money on a shelf, with how long it has sat there. */
export async function usedHolding(
  accountId: string,
  handle?: CloudDb,
): Promise<UsedHoldingRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    purchase_id: string;
    model: string;
    grade: string | null;
    state: string;
    cost_cents: string | null;
    sale_price_cents: string | null;
    days_held: number;
  }>(sql`
    with purchases as (${latest(accountId, "used_purchase")}),
    units as (${latest(accountId, "unit")})
    select
      p.id                                                                   as purchase_id,
      p.row->>'device'                                                       as model,
      coalesce(p.row->>'grade', u.row->>'grade')                             as grade,
      coalesce(u.row->>'status',
               case when coalesce((p.row->>'needsReview')::boolean, false)
                    then 'needs_review' else 'held' end)                     as state,
      coalesce((p.row->>'buyPriceCents')::bigint, 0)
        + coalesce((p.row->>'refurbCostCents')::bigint, 0)                   as cost_cents,
      (u.row->>'salePriceCents')::bigint                                     as sale_price_cents,
      greatest(0, extract(day from now()
        - to_timestamp((u.row->>'createdAt')::bigint / 1000.0))::int)        as days_held
    from purchases p
    /* the unit points at the purchase; see usedForAccount for the long version.
       purchasedAt and the brand/model/storage/color fields do not travel — the
       till composes one device string and keeps the seller to itself. */
    left join units u on u.row->>'purchaseId' = p.id
    where coalesce(u.row->>'status', 'held') <> 'sold'
    order by (u.row->>'createdAt')::bigint asc nulls last
  `);

  return rows.map((r) => ({
    purchaseId: r.purchase_id,
    model: r.model || "—",
    grade: r.grade,
    state: r.state,
    costCents: Number(r.cost_cents ?? 0),
    salePriceCents: r.sale_price_cents === null ? null : Number(r.sale_price_cents),
    daysHeld: Number(r.days_held ?? 0),
  }));
}

/* ------------------------------------------------------------ valuation -- */

export interface ValuationRow {
  group: string;
  items: number;
  units: number;
  atCostCents: number;
  atRetailCents: number;
}

export async function valuation(
  accountId: string,
  locale: Locale = "es",
  handle?: CloudDb,
): Promise<ValuationRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    group_name: string | null;
    items: number;
    units: string | null;
    at_cost_cents: string | null;
    at_retail_cents: string | null;
  }>(sql`
    with products as (${latest(accountId, "product")}),
    groups as (${latest(accountId, "product_group")}),
    stock as (
      select e.after->>'productId' as product_id, sum((e.after->>'qty')::bigint) as on_hand
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'stock_movement'
      group by 1
    )
    select ${groupName("g.row", locale)}        as group_name,
           count(*)::int                         as items,
           coalesce(sum(s.on_hand), 0)           as units,
           coalesce(sum(s.on_hand * (p.row->>'costCents')::bigint), 0)  as at_cost_cents,
           coalesce(sum(s.on_hand * (p.row->>'priceCents')::bigint), 0) as at_retail_cents
    from products p
    left join groups g on g.id = p.row->>'groupId'
    join stock s on s.product_id = p.id
    where coalesce((p.row->>'active')::boolean, true) and s.on_hand > 0
    /* by the group's ID, not its name. Grouping by the name broke the moment
       the SELECT became a locale-dependent expression — Postgres wants the
       thing it is grouping on — and two shelves that happened to share a name
       would have been merged into one row before that. */
    group by g.id, ${groupName("g.row", locale)}
    order by coalesce(sum(s.on_hand * (p.row->>'costCents')::bigint), 0) desc
  `);

  return rows.map((r) => ({
    group: r.group_name ?? "—",
    items: Number(r.items),
    units: Number(r.units ?? 0),
    atCostCents: Number(r.at_cost_cents ?? 0),
    atRetailCents: Number(r.at_retail_cents ?? 0),
  }));
}

/* ----------------------------------------------------------- dead stock -- */

export interface DeadStockRow {
  name: string;
  group: string | null;
  onHand: number;
  atCostCents: number;
  lastSoldAt: Date | null;
}

/**
 * Money sitting still: in stock, and not sold within the window.
 *
 * "Never sold" counts — a line that has been on the shelf since the shop opened
 * is the deadest stock there is, and a report keyed on a last-sold date would
 * quietly leave it out.
 */
export async function deadStock(
  accountId: string,
  days = 90,
  locale: Locale = "es",
  handle?: CloudDb,
): Promise<DeadStockRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    name: string;
    group_name: string | null;
    on_hand: string;
    at_cost_cents: string;
    last_sold_at: string | null;
  }>(sql`
    with products as (${latest(accountId, "product")}),
    groups as (${latest(accountId, "product_group")}),
    movements as (
      select e.after->>'productId' as product_id,
             sum((e.after->>'qty')::bigint) as on_hand,
             max((e.after->>'createdAt')::bigint) filter (
               where e.after->>'movementType' = 'sale_out'
             ) as last_sold_ms
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'stock_movement'
      group by 1
    )
    select ${productName("p.row->>'name'", locale)}            as name,
           ${groupName("g.row", locale)}                      as group_name,
           m.on_hand                                         as on_hand,
           m.on_hand * (p.row->>'costCents')::bigint         as at_cost_cents,
           case when m.last_sold_ms is null then null
                else to_timestamp(m.last_sold_ms / 1000.0) end as last_sold_at
    from products p
    join movements m on m.product_id = p.id
    left join groups g on g.id = p.row->>'groupId'
    where coalesce((p.row->>'active')::boolean, true)
      and m.on_hand > 0
      and (
        m.last_sold_ms is null
        or to_timestamp(m.last_sold_ms / 1000.0) < now() - (${days} || ' days')::interval
      )
    order by m.on_hand * (p.row->>'costCents')::bigint desc
  `);

  return rows.map((r) => ({
    name: r.name,
    group: r.group_name,
    onHand: Number(r.on_hand),
    atCostCents: Number(r.at_cost_cents),
    lastSoldAt: r.last_sold_at ? new Date(r.last_sold_at) : null,
  }));
}

/* -------------------------------------------------------- store credit -- */

export interface VoucherRow {
  id: string;
  amountCents: number;
  remainingCents: number;
  status: string;
  createdAt: Date | null;
}

/**
 * Vouchers the shop still owes against — a liability, not takings. A voucher is
 * a tender, never a line (ADR-0013), so what is outstanding here is money
 * already received for goods not yet handed over.
 */
export async function outstandingCredit(
  accountId: string,
  handle?: CloudDb,
): Promise<VoucherRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    id: string;
    amount_cents: string | null;
    remaining_cents: string | null;
    status: string;
    created_at: string | null;
  }>(sql`
    with vouchers as (${latest(accountId, "store_credit_voucher")})
    select v.id                       as id,
           (v.row->>'amountCents')::bigint    as amount_cents,
           (v.row->>'remainingCents')::bigint as remaining_cents,
           coalesce(v.row->>'status', '—')    as status,
           case when v.row->>'createdAt' is null then null
                else to_timestamp((v.row->>'createdAt')::bigint / 1000.0) end as created_at
    from vouchers v
    where coalesce((v.row->>'remainingCents')::bigint, 0) > 0
    order by (v.row->>'createdAt')::bigint desc nulls last
  `);

  return rows.map((r) => ({
    id: r.id,
    amountCents: Number(r.amount_cents ?? 0),
    remainingCents: Number(r.remaining_cents ?? 0),
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at) : null,
  }));
}
