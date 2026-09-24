/**
 * Informes — the reports the till has at nav 10, answered from the stream.
 *
 * Same rules as the till's own (ADR-0016): completed documents only, dated by
 * `completed_at`, aggregated in SQL, and the tax figures are the ones
 * SNAPSHOTTED onto the lines rather than recomputed from a rate. A report that
 * re-derives tax is a report that can disagree with the receipt in somebody's
 * hand, and the receipt is the fiscal record.
 *
 * Stock is a sum of movements here too, never a stored figure — so valuation
 * and dead stock cannot drift away from what the catalogue screen says.
 */
import { sql } from "drizzle-orm";
import { db as defaultDb, type CloudDb } from "./client";

const ZONE = "Europe/Madrid";

const mine = (accountId: string) => sql`
  (select t.id from tenants t where t.account_id = ${accountId})
`;

/* ------------------------------------------------------------------ tax -- */

export interface TaxRow {
  regime: string;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  lines: number;
}

/**
 * What the gestor asks for: base and IVA per regime.
 *
 * Grouped by the regime that was SNAPSHOTTED on each line, so a used device
 * sold under REBU sits in its own row and never gets averaged into the general
 * rate — which is the entire reason the regime is on the line at all.
 */
export async function taxByRegime(
  accountId: string,
  days: number,
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
    with docs as (
      select distinct on (e.after->>'id')
        e.after->>'id' as id,
        to_timestamp((e.after->>'completedAt')::bigint / 1000.0) as completed_at
      from sync_entries e
      where e.tenant_id in ${mine(accountId)}
        and e.entity = 'document'
        and e.after->>'status' = 'completed'
        and e.after->>'completedAt' is not null
      order by e.after->>'id', e.seq desc
    ),
    lines as (
      select distinct on (e.after->>'id')
        e.after->>'documentId'           as document_id,
        coalesce(e.after->>'taxRegime', 'IVA21') as regime,
        (e.after->>'baseCents')::bigint  as base_cents,
        (e.after->>'taxCents')::bigint   as tax_cents,
        (e.after->>'totalCents')::bigint as total_cents
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'document_line'
      order by e.after->>'id', e.seq desc
    )
    select l.regime,
           coalesce(sum(l.base_cents), 0)  as base_cents,
           coalesce(sum(l.tax_cents), 0)   as tax_cents,
           coalesce(sum(l.total_cents), 0) as total_cents,
           count(*)::int                   as lines
    from lines l
    join docs d on d.id = l.document_id
    where (d.completed_at at time zone ${ZONE})::date
          > (now() at time zone ${ZONE})::date - ${days}::int
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

/* ------------------------------------------------------------ valuation -- */

export interface ValuationRow {
  group: string;
  items: number;
  units: number;
  atCostCents: number;
  atRetailCents: number;
}

/** What is on the shelves, at cost and at what it would sell for. */
export async function valuation(accountId: string, handle?: CloudDb): Promise<ValuationRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    group_name: string | null;
    items: number;
    units: string | null;
    at_cost_cents: string | null;
    at_retail_cents: string | null;
  }>(sql`
    with products as (
      select distinct on (e.after->>'id')
        e.after->>'id'                   as id,
        e.after->>'groupId'              as group_id,
        (e.after->>'costCents')::bigint  as cost_cents,
        (e.after->>'priceCents')::bigint as price_cents,
        coalesce((e.after->>'active')::boolean, true) as active
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'product'
      order by e.after->>'id', e.seq desc
    ),
    groups as (
      select distinct on (e.after->>'id') e.after->>'id' as id, e.after->>'name' as name
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'product_group'
      order by e.after->>'id', e.seq desc
    ),
    stock as (
      select e.after->>'productId' as product_id, sum((e.after->>'qty')::bigint) as on_hand
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'stock_movement'
      group by 1
    )
    select g.name                                          as group_name,
           count(*)::int                                   as items,
           coalesce(sum(s.on_hand), 0)                     as units,
           coalesce(sum(s.on_hand * p.cost_cents), 0)      as at_cost_cents,
           coalesce(sum(s.on_hand * p.price_cents), 0)     as at_retail_cents
    from products p
    left join groups g on g.id = p.group_id
    join stock s on s.product_id = p.id
    where p.active and s.on_hand > 0
    group by g.name
    order by coalesce(sum(s.on_hand * p.cost_cents), 0) desc
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
 * "Never sold" counts — a line that has been on the shelf since the shop
 * opened is the most dead stock there is, and a report that only listed things
 * with a sale date would quietly leave it out.
 */
export async function deadStock(
  accountId: string,
  days = 90,
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
    with products as (
      select distinct on (e.after->>'id')
        e.after->>'id'                  as id,
        e.after->>'name'                as name,
        e.after->>'groupId'             as group_id,
        (e.after->>'costCents')::bigint as cost_cents,
        coalesce((e.after->>'active')::boolean, true) as active
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'product'
      order by e.after->>'id', e.seq desc
    ),
    groups as (
      select distinct on (e.after->>'id') e.after->>'id' as id, e.after->>'name' as name
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'product_group'
      order by e.after->>'id', e.seq desc
    ),
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
    select p.name,
           g.name                       as group_name,
           m.on_hand                    as on_hand,
           m.on_hand * p.cost_cents     as at_cost_cents,
           case when m.last_sold_ms is null then null
                else to_timestamp(m.last_sold_ms / 1000.0) end as last_sold_at
    from products p
    join movements m on m.product_id = p.id
    left join groups g on g.id = p.group_id
    where p.active
      and m.on_hand > 0
      and (
        m.last_sold_ms is null
        or to_timestamp(m.last_sold_ms / 1000.0) < now() - (${days} || ' days')::interval
      )
    order by m.on_hand * p.cost_cents desc
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
 * Vouchers the shop still owes against.
 *
 * Store credit is a liability, not takings — a voucher is a tender, never a
 * line (ADR-0013), so what is outstanding here is money the shop has already
 * received for goods it has not yet handed over.
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
    with vouchers as (
      select distinct on (e.after->>'id') e.after as row
      from sync_entries e
      where e.tenant_id in ${mine(accountId)} and e.entity = 'store_credit_voucher'
      order by e.after->>'id', e.seq desc
    )
    select v.row->>'id'                       as id,
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
