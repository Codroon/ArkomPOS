/**
 * One document, opened up — what the paper said.
 *
 * Lines and tenders arrive as their own ops and can be edited after they are
 * written (`document_line/update` is a real action), so each is taken at its
 * latest state per id, exactly as documents are. A line corrected on the till
 * must read here the way it read on the receipt.
 *
 * The tax figures are NOT recomputed. They were snapshotted onto the line when
 * it was written (ADR-0007 A1) and that snapshot is the fiscal record; working
 * them out again here from a rate would be a second opinion about a number that
 * has already been printed and handed to somebody.
 */
import { sql } from "drizzle-orm";
import { db as defaultDb, type CloudDb } from "./client";

export interface DocumentHead {
  id: string;
  docNumber: string | null;
  docType: string;
  status: string;
  totalCents: number;
  taxCents: number;
  subtotalCents: number;
  completedAt: Date | null;
  shopName: string;
}

export interface LineRow {
  lineNo: number;
  description: string;
  qty: number;
  unitPriceCents: number;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  taxRegime: string;
  priceOverridden: boolean;
}

export interface TenderRow {
  method: string;
  amountCents: number;
}

export interface DocumentDetail {
  head: DocumentHead;
  lines: LineRow[];
  tenders: TenderRow[];
}

export async function documentDetail(
  accountId: string,
  documentId: string,
  handle?: CloudDb,
): Promise<DocumentDetail | null> {
  const db = handle ?? defaultDb();

  const heads = await db.execute<{
    id: string;
    doc_number: string | null;
    doc_type: string;
    status: string;
    total_cents: string;
    tax_cents: string;
    subtotal_cents: string;
    completed_at: string | null;
    shop_name: string;
  }>(sql`
    select distinct on (e.after->>'id')
      e.after->>'id'                      as id,
      e.after->>'docNumber'               as doc_number,
      e.after->>'docType'                 as doc_type,
      e.after->>'status'                  as status,
      (e.after->>'totalCents')::bigint    as total_cents,
      (e.after->>'taxCents')::bigint      as tax_cents,
      (e.after->>'subtotalCents')::bigint as subtotal_cents,
      case when e.after->>'completedAt' is null then null
           else to_timestamp((e.after->>'completedAt')::bigint / 1000.0) end as completed_at,
      t.name                              as shop_name
    from sync_entries e
    join tenants t on t.id = e.tenant_id
    where t.account_id = ${accountId}
      and e.entity = 'document'
      and e.after->>'id' = ${documentId}
    order by e.after->>'id', e.seq desc
  `);

  const head = heads[0];
  if (!head) return null;

  const lines = await db.execute<{
    line_no: string;
    description: string;
    qty: string;
    unit_price_cents: string;
    base_cents: string;
    tax_cents: string;
    total_cents: string;
    tax_regime: string;
    price_overridden: boolean | null;
  }>(sql`
    select distinct on (e.after->>'id')
      (e.after->>'lineNo')::bigint          as line_no,
      e.after->>'description'               as description,
      (e.after->>'qty')::bigint             as qty,
      (e.after->>'unitPriceCents')::bigint  as unit_price_cents,
      (e.after->>'baseCents')::bigint       as base_cents,
      (e.after->>'taxCents')::bigint        as tax_cents,
      (e.after->>'totalCents')::bigint      as total_cents,
      e.after->>'taxRegime'                 as tax_regime,
      (e.after->>'priceOverridden')::boolean as price_overridden
    from sync_entries e
    join tenants t on t.id = e.tenant_id
    where t.account_id = ${accountId}
      and e.entity = 'document_line'
      and e.after->>'documentId' = ${documentId}
    order by e.after->>'id', e.seq desc
  `);

  const tenders = await db.execute<{ method: string; amount_cents: string }>(sql`
    select distinct on (e.after->>'id')
      e.after->>'method'                as method,
      (e.after->>'amountCents')::bigint as amount_cents
    from sync_entries e
    join tenants t on t.id = e.tenant_id
    where t.account_id = ${accountId}
      and e.entity = 'document_tender'
      and e.after->>'documentId' = ${documentId}
    order by e.after->>'id', e.seq desc
  `);

  return {
    head: {
      id: head.id,
      docNumber: head.doc_number,
      docType: head.doc_type,
      status: head.status,
      totalCents: Number(head.total_cents),
      taxCents: Number(head.tax_cents),
      subtotalCents: Number(head.subtotal_cents),
      completedAt: head.completed_at ? new Date(head.completed_at) : null,
      shopName: head.shop_name,
    },
    lines: lines
      .map((l) => ({
        lineNo: Number(l.line_no),
        description: l.description,
        qty: Number(l.qty),
        unitPriceCents: Number(l.unit_price_cents),
        baseCents: Number(l.base_cents),
        taxCents: Number(l.tax_cents),
        totalCents: Number(l.total_cents),
        taxRegime: l.tax_regime,
        priceOverridden: Boolean(l.price_overridden),
      }))
      .sort((a, b) => a.lineNo - b.lineNo),
    tenders: tenders.map((t) => ({ method: t.method, amountCents: Number(t.amount_cents) })),
  };
}
