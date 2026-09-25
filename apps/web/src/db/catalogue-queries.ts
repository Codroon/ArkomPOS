/**
 * The shop's catalogue, and what is on its shelves — read from the stream.
 *
 * On-hand is a SUM of `stock_movements`, never a stored figure, which is the
 * same rule the till keeps for itself: stock changes are inserts only, never an
 * UPDATE to a quantity (CLAUDE.md, ADR-0004). Quantities are signed — a
 * purchase is +4, a sale is −2, a return is +1 — so the shelf is the sum and a
 * reversal is just another row. The till maintains a cache of this figure and
 * `db:audit` asserts the cache equals the sum; here there is no cache to be
 * wrong, because the answer is computed every time it is asked for.
 *
 * Scoped by account through `tenants`, like every other query in this app.
 */
import { sql } from "drizzle-orm";
import { folded } from "./fold";
import { db as defaultDb, type CloudDb } from "./client";

export interface ProductRow {
  id: string;
  name: string;
  barcode: string | null;
  group: string | null;
  itemType: string;
  priceCents: number;
  costCents: number;
  taxRegime: string;
  onHand: number;
  lowStockThreshold: number;
  active: boolean;
}

export async function productsForAccount(
  accountId: string,
  handle?: CloudDb,
): Promise<ProductRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    id: string;
    name: string;
    barcode: string | null;
    group_name: string | null;
    item_type: string;
    price_cents: string;
    cost_cents: string;
    tax_regime: string;
    on_hand: string | null;
    low_stock_threshold: string | null;
    active: boolean;
  }>(sql`
    with mine as (select t.id from tenants t where t.account_id = ${accountId}),
    p0 as (${folded(accountId, "product")}),
    products as (
      select id,
             row->>'name'                        as name,
             row->>'barcode'                     as barcode,
             row->>'groupId'                     as group_id,
             row->>'itemType'                    as item_type,
             (row->>'priceCents')::bigint        as price_cents,
             (row->>'costCents')::bigint         as cost_cents,
             row->>'taxRegime'                   as tax_regime,
             (row->>'lowStockThreshold')::bigint as low_stock_threshold,
             coalesce((row->>'active')::boolean, true) as active
      from p0
    ),
    g0 as (${folded(accountId, "product_group")}),
    groups as (select id, row->>'name' as name from g0),
    stock as (
      select e.after->>'productId' as product_id, sum((e.after->>'qty')::bigint) as on_hand
      from sync_entries e
      where e.tenant_id in (select id from mine) and e.entity = 'stock_movement'
      group by 1
    )
    select p.id, p.name, p.barcode, g.name as group_name, p.item_type,
           p.price_cents, p.cost_cents, p.tax_regime, p.low_stock_threshold, p.active,
           s.on_hand
    from products p
    left join groups g on g.id = p.group_id
    left join stock  s on s.product_id = p.id
    order by p.active desc, g.name nulls last, p.name
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    barcode: r.barcode,
    group: r.group_name,
    itemType: r.item_type,
    priceCents: Number(r.price_cents),
    costCents: Number(r.cost_cents),
    taxRegime: r.tax_regime,
    onHand: Number(r.on_hand ?? 0),
    lowStockThreshold: Number(r.low_stock_threshold ?? 0),
    active: r.active,
  }));
}

export interface StockMovementRow {
  productName: string;
  movementType: string;
  qty: number;
  unitCostCents: number;
  createdAt: Date;
}

/** The shelf's history: every movement, newest first. */
export async function recentMovements(
  accountId: string,
  limit = 30,
  handle?: CloudDb,
): Promise<StockMovementRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    product_name: string | null;
    movement_type: string;
    qty: string;
    unit_cost_cents: string | null;
    created_at: string;
  }>(sql`
    with mine as (select t.id from tenants t where t.account_id = ${accountId}),
    p0 as (${folded(accountId, "product")}),
    products as (select id, row->>'name' as name from p0)
    select p.name                                                  as product_name,
           e.after->>'movementType'                                as movement_type,
           (e.after->>'qty')::bigint                               as qty,
           (e.after->>'unitCostCents')::bigint                     as unit_cost_cents,
           to_timestamp((e.after->>'createdAt')::bigint / 1000.0)  as created_at
    from sync_entries e
    left join products p on p.id = e.after->>'productId'
    where e.tenant_id in (select id from mine) and e.entity = 'stock_movement'
    order by (e.after->>'createdAt')::bigint desc
    limit ${limit}
  `);

  return rows.map((r) => ({
    productName: r.product_name ?? "—",
    movementType: r.movement_type,
    qty: Number(r.qty),
    unitCostCents: Number(r.unit_cost_cents ?? 0),
    createdAt: new Date(r.created_at),
  }));
}
