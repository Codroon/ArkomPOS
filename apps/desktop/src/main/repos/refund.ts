/**
 * Giving money back — ADR-0019.
 *
 * A refund is a second document. The original ticket is never touched: it is
 * the fiscal record of a sale that genuinely happened, and a till that can
 * rewrite yesterday has no record at all (ADR-0007). What the original DOES
 * carry is `refunded_qty` per line — the running total of what has been handed
 * back, kept there because that is the only place "you cannot refund more than
 * you sold" can be answered without summing the whole history, and summing is
 * how a race refunds twice.
 *
 * Everything else reuses machinery that already exists: the gap-free series
 * (ADR-0008), the tender rows the drawer reads (ADR-0015 §3), the insert-only
 * stock ledger (ADR-0004), and the voucher the buy screen issues (ADR-0013).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  allocateNumber,
  appError,
  canRestock,
  computeRefund,
  mutate,
  remainingQty,
  returnsToReview,
  toOplogJson,
  uuidv7,
  type MutationCtx,
  type RefundCreateRequest,
  type RefundPeekResponse,
  type RefundableLine,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { requireOpenShift } from "./shift";

const {
  documentLines,
  documentTenders,
  documents,
  numberSeries,
  productStock,
  stockMovements,
  storeCreditVouchers,
  units,
  usedPurchases,
} = schema;

/** Its own series, so a refund number is never confused with a sale's. */
export function refundSeries(tx: DbTx, ctx: MutationCtx) {
  const existing = tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.terminalId, ctx.terminalId), eq(numberSeries.docType, "refund")))
    .all()[0];
  if (existing) return existing;

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    locationId: ctx.locationId,
    terminalId: ctx.terminalId,
    docType: "refund" as const,
    /* "D" for devolución — the word the shop uses, and free: T, R, C and Z are
       taken by tickets, repairs, purchases and shifts (ADR-0019) */
    prefix: "D1-",
    nextNumber: 1,
  };
  tx.insert(numberSeries).values(row).run();
  return row;
}

/* -------------------------------------------------------------- reading */

function toRefundable(l: typeof documentLines.$inferSelect): RefundableLine {
  return {
    id: l.id,
    lineNo: l.lineNo,
    description: l.description,
    qty: l.qty,
    refundedQty: l.refundedQty,
    unitPriceCents: l.unitPriceCents,
    taxRegime: l.taxRegime,
    taxRateBp: l.taxRateBp,
    baseCents: l.baseCents,
    taxCents: l.taxCents,
    totalCents: l.totalCents,
    productId: l.productId,
    unitId: l.unitId,
    lineType: l.lineType,
    unitCostCents: l.unitCostCents,
  };
}

/** What may still be given back on a ticket, and what already has been. */
export function peekRefundable(db: ArkomDb, ctx: MutationCtx, documentId: string): RefundPeekResponse {
  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, documentId)))
    .all()[0];
  if (!doc) throw appError("VALIDATION", "Ese documento no existe.");
  if (doc.status !== "completed") throw appError("VALIDATION", "Solo se pueden devolver tickets completados.");
  if (doc.docType === "refund") throw appError("VALIDATION", "No se devuelve una devolución.");

  const lines = db
    .select()
    .from(documentLines)
    .where(eq(documentLines.documentId, doc.id))
    .orderBy(documentLines.lineNo)
    .all();

  const priorRefunds = db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.refundsDocumentId, doc.id)))
    .orderBy(desc(documents.completedAt))
    .all();

  const rows = lines.map((l) => {
    const line = toRefundable(l);
    return {
      id: line.id,
      lineNo: line.lineNo,
      description: line.description,
      qty: line.qty,
      refundedQty: line.refundedQty,
      remainingQty: remainingQty(line),
      unitPriceCents: line.unitPriceCents,
      taxRegime: line.taxRegime,
      taxRateBp: line.taxRateBp,
      totalCents: line.totalCents,
      lineType: line.lineType,
      productId: line.productId,
      unitId: line.unitId,
      restockable: canRestock(line),
      returnsToReview: returnsToReview(line.lineType, line.unitId),
    };
  });

  return {
    documentId: doc.id,
    docNumber: doc.docNumber ?? "",
    docType: doc.docType,
    completedAtMs: doc.completedAt?.getTime() ?? null,
    totalCents: doc.totalCents,
    lines: rows,
    priorRefunds: priorRefunds.map((r) => ({
      documentId: r.id,
      docNumber: r.docNumber ?? "",
      totalCents: r.totalCents,
      completedAtMs: r.completedAt?.getTime() ?? null,
    })),
    anythingLeft: rows.some((r) => r.remainingQty > 0),
  };
}

/* -------------------------------------------------------------- writing */

export interface RefundResult {
  documentId: string;
  docNumber: string;
  totalCents: number;
  voucherId: string | null;
  restockedCount: number;
  unitsToReviewCount: number;
}

export function createRefund(db: ArkomDb, ctx: MutationCtx, req: RefundCreateRequest): RefundResult {
  /* Cash needs an open drawer for the obvious reason. The others need one too:
     the refund is a completed document and every completed document is stamped
     with the shift it happened in (ADR-0015 §9). */
  const shift = requireOpenShift(db, ctx);

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();

    const original = tx
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, req.documentId)))
      .all()[0];
    if (!original) throw appError("VALIDATION", "Ese documento no existe.");
    if (original.status !== "completed") throw appError("VALIDATION", "Solo se pueden devolver tickets completados.");
    if (original.docType === "refund") throw appError("VALIDATION", "No se devuelve una devolución.");

    /* re-read INSIDE the transaction: the peek the operator saw may be a minute
       old, and a second till may have refunded the same line since */
    const originalLines = tx
      .select()
      .from(documentLines)
      .where(eq(documentLines.documentId, original.id))
      .all()
      .map(toRefundable);

    let computed;
    try {
      computed = computeRefund(originalLines, req.lines);
    } catch (err) {
      /* the domain refuses at the LINE — "that one is already back" is a
         different problem from "this ticket is spent", and only the first tells
         the shop which item to look at */
      throw appError("VALIDATION", err instanceof Error ? err.message : "Devolución no válida.", "lines");
    }

    const series = refundSeries(tx, ctx);
    const allocation = allocateNumber({ prefix: series.prefix, nextNumber: series.nextNumber });
    tx.update(numberSeries).set({ nextNumber: allocation.next.nextNumber }).where(eq(numberSeries.id, series.id)).run();

    const doc = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      docType: "refund" as const,
      status: "completed" as const,
      seriesId: series.id,
      number: allocation.number,
      docNumber: allocation.docNumber,
      parkedLabel: null,
      refundsDocumentId: original.id,
      refundReason: req.reason.trim(),
      subtotalCents: computed.subtotalCents,
      taxCents: computed.taxCents,
      totalCents: computed.totalCents,
      shiftId: shift.id,
      userId: ctx.userId,
      fiscalHash: null,
      prevFiscalHash: null,
      fiscalStatus: null,
      createdAt: now,
      completedAt: now,
    };
    tx.insert(documents).values(doc).run();
    log({
      entity: "document",
      entityId: doc.id,
      action: "refund",
      before: null,
      after: toOplogJson({ ...doc, refundsDocNumber: original.docNumber }),
    });

    let restockedCount = 0;
    let unitsToReviewCount = 0;

    computed.lines.forEach((entry, index) => {
      const src = entry.line;
      const lineRow = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        documentId: doc.id,
        lineNo: index + 1,
        lineType: src.lineType as typeof documentLines.$inferInsert.lineType,
        productId: src.productId,
        unitId: src.unitId,
        description: src.description,
        qty: -entry.qty,
        unitPriceCents: src.unitPriceCents,
        priceOverridden: false,
        overrideReason: null,
        /* THE rule: the reversal carries the ORIGINAL line's snapshot. A phone
           sold under the margin scheme reverses with zero VAT even if the same
           model is bought new today (ADR-0007, ADR-0019). */
        taxRegime: src.taxRegime as typeof documentLines.$inferInsert.taxRegime,
        taxRateBp: src.taxRateBp,
        baseCents: entry.baseCents,
        taxCents: entry.taxCents,
        totalCents: entry.totalCents,
        unitCostCents: src.unitCostCents,
        refundsLineId: src.id,
        refundedQty: 0,
        createdAt: now,
      };
      tx.insert(documentLines).values(lineRow).run();

      /* the running total lives on the ORIGINAL line, so the next refund's
         check is a read of one row rather than a sum over history */
      tx.update(documentLines)
        .set({ refundedQty: src.refundedQty + entry.qty })
        .where(eq(documentLines.id, src.id))
        .run();

      if (!entry.restock || !canRestock(src)) return;

      if (src.unitId) {
        /* A serialized unit never goes straight back to sellable. It left the
           shop and nobody has looked at it since — the same reasoning that puts
           a bought used device on hold pending review (ADR-0013). */
        tx.update(units).set({ status: "held", updatedAt: now }).where(eq(units.id, src.unitId)).run();
        tx.update(usedPurchases)
          .set({ needsReview: true, updatedAt: now })
          .where(eq(usedPurchases.unitId, src.unitId))
          .run();
        log({
          entity: "unit",
          entityId: src.unitId,
          action: "returned",
          before: { status: "sold" },
          after: { status: "held", needsReview: true, refundDocNumber: doc.docNumber },
        });
        unitsToReviewCount += 1;
        return;
      }

      if (!src.productId) return;
      /* stock is INSERT-ONLY: a return is a movement, never an UPDATE of a
         quantity (ADR-0004) */
      const movement = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        productId: src.productId,
        unitId: null,
        movementType: "return_in" as const,
        qty: entry.qty,
        unitCostCents: src.unitCostCents,
        supplierId: null,
        documentId: doc.id,
        documentLineId: lineRow.id,
        reason: null,
        userId: ctx.userId,
        createdAt: now,
      };
      tx.insert(stockMovements).values(movement).run();
      log({ entity: "stock_movement", entityId: movement.id, action: "create", before: null, after: toOplogJson(movement) });

      const stock = tx
        .select()
        .from(productStock)
        .where(and(eq(productStock.productId, src.productId), eq(productStock.locationId, ctx.locationId)))
        .all()[0];
      if (stock) {
        tx.update(productStock)
          .set({ onHand: stock.onHand + entry.qty, updatedAt: now })
          .where(and(eq(productStock.productId, src.productId), eq(productStock.locationId, ctx.locationId)))
          .run();
      } else {
        tx.insert(productStock)
          .values({ productId: src.productId, locationId: ctx.locationId, onHand: entry.qty, updatedAt: now })
          .run();
      }
      restockedCount += 1;
    });

    /* ---- the money ----
       A NEGATIVE tender, so the drawer's existing per-document formula carries
       it without knowing what a refund is (ADR-0015 §3). There is no change to
       compute: a refund is exact by construction. */
    const tender = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      documentId: doc.id,
      method: req.method as typeof documentTenders.$inferInsert.method,
      amountCents: computed.totalCents,
      cardReference: req.cardReference?.trim() || null,
      createdAt: now,
    };
    tx.insert(documentTenders).values(tender).run();
    log({ entity: "document_tender", entityId: tender.id, action: "create", before: null, after: toOplogJson(tender) });

    let voucherId: string | null = null;
    if (req.method === "store_credit") {
      const voucher = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        purchaseId: null,
        refundDocumentId: doc.id,
        amountCents: Math.abs(computed.totalCents),
        remainingCents: Math.abs(computed.totalCents),
        status: "issued" as const,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(storeCreditVouchers).values(voucher).run();
      log({ entity: "store_credit_voucher", entityId: voucher.id, action: "issue", before: null, after: toOplogJson(voucher) });
      voucherId = voucher.id;
    }

    return {
      documentId: doc.id,
      docNumber: doc.docNumber,
      totalCents: computed.totalCents,
      voucherId,
      restockedCount,
      unitsToReviewCount,
    };
  });
}

/** Ticket numbers a refund can be started from — used by the search box. */
export function findRefundableByNumber(db: ArkomDb, ctx: MutationCtx, docNumber: string): string | null {
  const row = db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, ctx.tenantId),
        eq(documents.docNumber, docNumber.trim().toUpperCase()),
        eq(documents.status, "completed"),
        inArray(documents.docType, ["ticket", "invoice"]),
      ),
    )
    .all()[0];
  return row?.id ?? null;
}
