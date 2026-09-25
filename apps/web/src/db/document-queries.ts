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
import { folded } from "./fold";
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
    select f.id,
      f.row->>'docNumber'               as doc_number,
      f.row->>'docType'                 as doc_type,
      f.row->>'status'                  as status,
      (f.row->>'totalCents')::bigint    as total_cents,
      (f.row->>'taxCents')::bigint      as tax_cents,
      (f.row->>'subtotalCents')::bigint as subtotal_cents,
      case when f.row->>'completedAt' is null then null
           else to_timestamp((f.row->>'completedAt')::bigint / 1000.0) end as completed_at,
      (select t.name from tenants t
         join sync_entries e2 on e2.tenant_id = t.id
        where t.account_id = ${accountId}
          and e2.entity = 'document' and e2.entity_id = ${documentId}
        limit 1)                        as shop_name
    from (${folded(accountId, "document")}) f
    where f.id = ${documentId}
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
    select (x.row->>'lineNo')::bigint           as line_no,
      x.row->>'description'                as description,
      (x.row->>'qty')::bigint              as qty,
      (x.row->>'unitPriceCents')::bigint   as unit_price_cents,
      (x.row->>'baseCents')::bigint        as base_cents,
      (x.row->>'taxCents')::bigint         as tax_cents,
      (x.row->>'totalCents')::bigint       as total_cents,
      x.row->>'taxRegime'                  as tax_regime,
      (x.row->>'priceOverridden')::boolean as price_overridden
    from (${folded(accountId, "document_line")}) x
    where x.row->>'documentId' = ${documentId}
  `);

  const tenders = await db.execute<{ method: string; amount_cents: string }>(sql`
    select x.row->>'method'                as method,
           (x.row->>'amountCents')::bigint as amount_cents
    from (${folded(accountId, "document_tender")}) x
    where x.row->>'documentId' = ${documentId}
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
