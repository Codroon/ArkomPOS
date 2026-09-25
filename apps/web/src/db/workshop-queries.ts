/**
 * Repairs, used devices and transfers — the three parts of the shop the
 * dashboard could not see until now.
 *
 * Each reads the same way as everything else: latest state per id, scoped to
 * the account through `tenants`, aggregated in SQL.
 *
 * Two things carry over from the till and are not negotiable here:
 *
 *  · **A repair's status is derived, never assigned** (ADR-0014 §1). The till
 *    computes it from the ticket's own facts and stores it; this reads the
 *    stored column rather than recomputing, because recomputing in a second
 *    place is how two answers to one question start.
 *  · **The device passcode never arrives.** It is stripped before the row is
 *    queued (ADR-0020 §3), so there is no column here to hold it and no field
 *    to select. A repair screen that wanted it would be asking for something
 *    that deliberately does not exist.
 */
import { sql } from "drizzle-orm";
import { folded } from "./fold";
import { db as defaultDb, type CloudDb } from "./client";

/** The current state of every row of an entity — see `./fold`. */
const latest = (accountId: string, entity: string) => folded(accountId, entity);

/* ------------------------------------------------------------- repairs -- */

export interface RepairRow {
  id: string;
  customerName: string | null;
  device: string;
  imei: string | null;
  fault: string | null;
  status: string;
  depositCents: number;
  promisedDate: string | null;
  createdAt: Date | null;
  readyAt: Date | null;
  parts: number;
  quotedCents: number;
}

export async function repairsForAccount(
  accountId: string,
  handle?: CloudDb,
): Promise<RepairRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    id: string;
    customer_name: string | null;
    device: string;
    imei: string | null;
    fault: string | null;
    status: string;
    deposit_cents: string | null;
    promised_date: string | null;
    created_at: string | null;
    ready_at: string | null;
    parts: number;
    quoted_cents: string | null;
  }>(sql`
    with tickets as (${latest(accountId, "repair_ticket")}),
    customers as (${latest(accountId, "customer")}),
    lines as (${latest(accountId, "repair_line")})
    select
      t.row->>'id'                                  as id,
      c.row->>'name'                                as customer_name,
      coalesce(t.row->>'deviceDescription', '—')    as device,
      t.row->>'imei'                                as imei,
      t.row->>'reportedFault'                       as fault,
      coalesce(t.row->>'status', 'received')        as status,
      coalesce((t.row->>'depositCents')::bigint, 0) as deposit_cents,
      t.row->>'promisedDate'                        as promised_date,
      case when t.row->>'createdAt' is null then null
           else to_timestamp((t.row->>'createdAt')::bigint / 1000.0) end as created_at,
      case when t.row->>'readyAt' is null then null
           else to_timestamp((t.row->>'readyAt')::bigint / 1000.0) end   as ready_at,
      (select count(*)::int from lines l where l.row->>'ticketId' = t.row->>'id')          as parts,
      (select coalesce(sum((l.row->>'chargeCents')::bigint), 0)
         from lines l where l.row->>'ticketId' = t.row->>'id')                             as quoted_cents
    from tickets t
    left join customers c on c.row->>'id' = t.row->>'customerId'
    order by (t.row->>'createdAt')::bigint desc nulls last
  `);

  return rows.map((r) => ({
    id: r.id,
    customerName: r.customer_name,
    device: r.device,
    imei: r.imei,
    fault: r.fault,
    status: r.status,
    depositCents: Number(r.deposit_cents ?? 0),
    promisedDate: r.promised_date,
    createdAt: r.created_at ? new Date(r.created_at) : null,
    readyAt: r.ready_at ? new Date(r.ready_at) : null,
    parts: Number(r.parts ?? 0),
    quotedCents: Number(r.quoted_cents ?? 0),
  }));
}

export interface RepairLineRow {
  kind: string;
  description: string | null;
  qty: number;
  chargeCents: number;
  supplier: string | null;
  orderedAt: Date | null;
  receivedAt: Date | null;
}

export async function repairDetail(
  accountId: string,
  ticketId: string,
  handle?: CloudDb,
): Promise<{ ticket: RepairRow; lines: RepairLineRow[] } | null> {
  const all = await repairsForAccount(accountId, handle);
  const ticket = all.find((row) => row.id === ticketId);
  if (!ticket) return null;

  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    kind: string;
    description: string | null;
    qty: string | null;
    charge_cents: string | null;
    supplier: string | null;
    ordered_at: string | null;
    received_at: string | null;
  }>(sql`
    with lines as (${latest(accountId, "repair_line")})
    select
      coalesce(l.row->>'kind', 'labor')                  as kind,
      l.row->>'description'                              as description,
      (l.row->>'qty')::bigint                            as qty,
      (l.row->>'chargeCents')::bigint                    as charge_cents,
      l.row->>'supplierText'                             as supplier,
      case when l.row->>'orderedAt' is null then null
           else to_timestamp((l.row->>'orderedAt')::bigint / 1000.0) end  as ordered_at,
      case when l.row->>'receivedAt' is null then null
           else to_timestamp((l.row->>'receivedAt')::bigint / 1000.0) end as received_at
    from lines l
    where l.row->>'ticketId' = ${ticketId}
    order by l.first_seq
  `);

  return {
    ticket,
    lines: rows.map((r) => ({
      kind: r.kind,
      description: r.description,
      qty: Number(r.qty ?? 1),
      chargeCents: Number(r.charge_cents ?? 0),
      supplier: r.supplier,
      orderedAt: r.ordered_at ? new Date(r.ordered_at) : null,
      receivedAt: r.received_at ? new Date(r.received_at) : null,
    })),
  };
}

/* -------------------------------------------------------- used devices -- */

export interface UsedRow {
  id: string;
  device: string;
  imei: string | null;
  grade: string | null;
  batteryPct: number | null;
  sellerName: string | null;
  buyPriceCents: number;
  refurbCostCents: number;
  purchasedAt: Date | null;
  needsReview: boolean;
  /** the unit's own state: held, in_stock, reserved or sold */
  unitStatus: string | null;
  salePriceCents: number | null;
}

export async function usedForAccount(accountId: string, handle?: CloudDb): Promise<UsedRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    id: string;
    device: string;
    imei: string | null;
    grade: string | null;
    battery_pct: string | null;
    seller_name: string | null;
    buy_price_cents: string | null;
    refurb_cost_cents: string | null;
    purchased_at: string | null;
    needs_review: boolean | null;
    unit_status: string | null;
    sale_price_cents: string | null;
  }>(sql`
    with purchases as (${latest(accountId, "used_purchase")}),
    units as (${latest(accountId, "unit")})
    select
      p.row->>'id'                                                          as id,
      trim(both ' ' from concat_ws(' ', p.row->>'brand', p.row->>'model',
                                        p.row->>'storage', p.row->>'color')) as device,
      p.row->>'imei'                                                        as imei,
      p.row->>'grade'                                                       as grade,
      p.row->>'batteryPct'                                                  as battery_pct,
      p.row->>'sellerName'                                                  as seller_name,
      (p.row->>'buyPriceCents')::bigint                                     as buy_price_cents,
      (p.row->>'refurbCostCents')::bigint                                   as refurb_cost_cents,
      case when p.row->>'purchasedAt' is null then null
           else to_timestamp((p.row->>'purchasedAt')::bigint / 1000.0) end  as purchased_at,
      (p.row->>'needsReview')::boolean                                      as needs_review,
      u.row->>'status'                                                      as unit_status,
      (u.row->>'salePriceCents')::bigint                                    as sale_price_cents
    from purchases p
    left join units u on u.row->>'id' = p.row->>'unitId'
    order by (p.row->>'purchasedAt')::bigint desc nulls last
  `);

  return rows.map((r) => ({
    id: r.id,
    device: r.device || "—",
    imei: r.imei,
    grade: r.grade,
    batteryPct: r.battery_pct === null ? null : Number(r.battery_pct),
    sellerName: r.seller_name,
    buyPriceCents: Number(r.buy_price_cents ?? 0),
    refurbCostCents: Number(r.refurb_cost_cents ?? 0),
    purchasedAt: r.purchased_at ? new Date(r.purchased_at) : null,
    needsReview: Boolean(r.needs_review),
    unitStatus: r.unit_status,
    salePriceCents: r.sale_price_cents === null ? null : Number(r.sale_price_cents),
  }));
}

/* ----------------------------------------------------------- transfers -- */

export interface TransferRow {
  id: string;
  kind: string;
  status: string;
  mtcn: string | null;
  senderName: string | null;
  receiverName: string | null;
  countryCode: string | null;
  principalCents: number;
  feeCents: number;
  method: string | null;
  createdAt: Date | null;
  cancelledAt: Date | null;
}

/**
 * The Western Union shadow log — ADR-0018.
 *
 * The PRINCIPAL is pass-through money and never the shop's revenue; only the
 * fee is. The screen adds them up separately for that reason, and a cancelled
 * transfer contributes neither.
 */
export async function transfersForAccount(
  accountId: string,
  handle?: CloudDb,
): Promise<TransferRow[]> {
  const db = handle ?? defaultDb();
  const rows = await db.execute<{
    id: string;
    kind: string;
    status: string;
    mtcn: string | null;
    sender_name: string | null;
    receiver_name: string | null;
    country_code: string | null;
    principal_cents: string | null;
    fee_cents: string | null;
    method: string | null;
    created_at: string | null;
    cancelled_at: string | null;
  }>(sql`
    with t as (${latest(accountId, "transfer")})
    select
      t.row->>'id'                    as id,
      coalesce(t.row->>'kind', '—')   as kind,
      coalesce(t.row->>'status', '—') as status,
      t.row->>'mtcn'                  as mtcn,
      t.row->>'senderName'            as sender_name,
      t.row->>'receiverName'          as receiver_name,
      t.row->>'countryCode'           as country_code,
      (t.row->>'principalCents')::bigint as principal_cents,
      (t.row->>'feeCents')::bigint       as fee_cents,
      t.row->>'method'                as method,
      case when t.row->>'createdAt' is null then null
           else to_timestamp((t.row->>'createdAt')::bigint / 1000.0) end   as created_at,
      case when t.row->>'cancelledAt' is null then null
           else to_timestamp((t.row->>'cancelledAt')::bigint / 1000.0) end as cancelled_at
    from t
    order by (t.row->>'createdAt')::bigint desc nulls last
  `);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    mtcn: r.mtcn,
    senderName: r.sender_name,
    receiverName: r.receiver_name,
    countryCode: r.country_code,
    principalCents: Number(r.principal_cents ?? 0),
    feeCents: Number(r.fee_cents ?? 0),
    method: r.method,
    createdAt: r.created_at ? new Date(r.created_at) : null,
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at) : null,
  }));
}
