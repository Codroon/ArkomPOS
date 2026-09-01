/**
 * Sale repository — §3/§4. Drafts are real `documents` rows created lazily on
 * the first addLine (no empty-draft rows); every money figure is computed in
 * core and persisted server-side (the renderer only displays SaleState).
 * Completion is ONE transaction: revalidate totals + tenders, sale_out
 * movements through the ledger guard, units → sold, gap-free number
 * allocation (ADR-0008), oplog rows for every write — NEGATIVE_STOCK /
 * UNIT_NOT_AVAILABLE roll everything back and leave the sale open.
 */
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import {
  appError,
  applyMovements,
  allocateNumber,
  buildMovement,
  computeDocumentTotals,
  computeLine,
  isValidImei,
  mutate,
  stockKey,
  toOplogJson,
  uuidv7,
  validateCompletion,
  type CompletedSale,
  type MovementDraft,
  type LogFn,
  type MutationCtx,
  type TenderDraft,
  type SaleAddLineRequest,
  type SaleAddLineResponse,
  type ParkedSale,
  type SaleState,
  type StockLevels,
  type TicketPeek,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { currentShiftId } from "./shift";

const {
  documents,
  documentLines,
  documentTenders,
  products,
  productStock,
  stockMovements,
  storeCreditVouchers,
  units,
  numberSeries,
} = schema;

type Reader = ArkomDb | DbTx;

/* ------------------------------- reads ------------------------------- */

function loadLines(db: Reader, docId: string) {
  return db
    .select({
      line: documentLines,
      barcode: products.barcode,
      originalPriceCents: products.priceCents,
      imei: units.imei,
    })
    .from(documentLines)
    .leftJoin(products, eq(documentLines.productId, products.id))
    .leftJoin(units, eq(documentLines.unitId, units.id))
    .where(eq(documentLines.documentId, docId))
    .orderBy(asc(documentLines.lineNo))
    .all();
}

export function loadState(db: Reader, docId: string): SaleState {
  const doc = db.select().from(documents).where(eq(documents.id, docId)).all()[0];
  if (!doc || (doc.status !== "draft" && doc.status !== "parked")) {
    throw appError("VALIDATION", "Ticket no encontrado.");
  }
  const lines = loadLines(db, docId).map(({ line, barcode, originalPriceCents, imei }) => ({
    id: line.id,
    lineNo: line.lineNo,
    lineType: line.lineType,
    productId: line.productId,
    unitId: line.unitId,
    description: line.description,
    barcode,
    imei,
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    priceOverridden: line.priceOverridden,
    overrideReason: line.overrideReason,
    originalPriceCents,
    taxRegime: line.taxRegime,
    taxRateBp: line.taxRateBp,
    baseCents: line.baseCents,
    taxCents: line.taxCents,
    totalCents: line.totalCents,
  }));
  return {
    docId: doc.id,
    status: doc.status,
    lines,
    subtotalCents: doc.subtotalCents,
    taxCents: doc.taxCents,
    totalCents: doc.totalCents,
  };
}

/** The terminal's live draft, if any (boot restore / power-cut behavior). */
export function currentDraft(db: ArkomDb, ctx: MutationCtx): SaleState | null {
  const doc = db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, ctx.tenantId),
        eq(documents.terminalId, ctx.terminalId),
        eq(documents.status, "draft"),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .all()[0];
  return doc ? loadState(db, doc.id) : null;
}

/* ------------------------------ helpers ------------------------------ */

/** Recompute + persist document totals from its lines; logs the doc update. */
function refreshTotals(
  tx: DbTx,
  log: (draft: { entity: string; entityId: string; action: string; before: unknown; after: unknown }) => void,
  docId: string,
): void {
  const before = tx.select().from(documents).where(eq(documents.id, docId)).all()[0]!;
  const lines = tx.select().from(documentLines).where(eq(documentLines.documentId, docId)).all();
  const totals = computeDocumentTotals(lines);
  tx.update(documents)
    .set({ subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, totalCents: totals.totalCents })
    .where(eq(documents.id, docId))
    .run();
  const after = tx.select().from(documents).where(eq(documents.id, docId)).all()[0]!;
  log({ entity: "document", entityId: docId, action: "update", before: toOplogJson(before), after: toOplogJson(after) });
}

function requireDraft(tx: Reader, ctx: MutationCtx, docId: string) {
  const doc = tx
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, docId)))
    .all()[0];
  if (!doc) throw appError("VALIDATION", "Ticket no encontrado.");
  if (doc.status !== "draft") throw appError("VALIDATION", "El ticket no está en curso.");
  return doc;
}

function nextLineNo(tx: Reader, docId: string): number {
  const row = tx
    .select({ max: sql<number | null>`max(${documentLines.lineNo})` })
    .from(documentLines)
    .where(eq(documentLines.documentId, docId))
    .all()[0];
  return (row?.max ?? 0) + 1;
}

interface SellableProduct {
  id: string;
  name: string;
  itemType: string;
  priceCents: number;
  taxRegime: "IVA21" | "REBU";
  taxRateBp: number;
}

/**
 * Phase 1 sells two regimes, and they are not alternatives — they describe
 * different goods.
 *
 * **IVA21** is everything the shop buys from a distributor: the shelf price
 * includes 21% and the ticket breaks it out.
 *
 * **REBU** is a second-hand device bought from a private individual (ADR-0013
 * §5). Under the margin scheme the shop pays VAT on its margin, not on the sale,
 * and the customer's document must NOT show VAT for that line — so the line is
 * snapshotted at a zero rate and its full price lands in the base. The ticket
 * prints the regime's mention instead. What the shop owes on the margin is an
 * accounting matter its gestor settles from the purchase and sale prices, both
 * of which this app records.
 */
function assertSellable(product: typeof products.$inferSelect): SellableProduct {
  if (!product.active) throw appError("VALIDATION", "Artículo inactivo; no se puede vender.");
  if (product.priceCents == null || product.taxRegime == null || product.taxRateBp == null) {
    throw appError("VALIDATION", "Artículo incompleto (PVP/IVA); complétalo en Catálogo.");
  }
  if (product.taxRegime !== "IVA21" && product.taxRegime !== "REBU") {
    throw appError("VALIDATION", "Régimen de IVA no disponible en Fase 1.");
  }
  return {
    id: product.id,
    name: product.name,
    itemType: product.itemType,
    priceCents: product.priceCents,
    taxRegime: product.taxRegime,
    taxRateBp: product.taxRegime === "REBU" ? 0 : product.taxRateBp,
  };
}

/* ------------------------------ addLine ------------------------------ */

export function addLine(db: ArkomDb, ctx: MutationCtx, req: SaleAddLineRequest): SaleAddLineResponse {
  // resolve OUTSIDE any transaction: the unit-pick path is a pure read
  let unitToAdd: (typeof units.$inferSelect) | null = null;
  let productToAdd: SellableProduct | null = null;

  if (req.unitId) {
    unitToAdd = db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, ctx.tenantId), eq(units.id, req.unitId)))
      .all()[0] ?? null;
    if (!unitToAdd) throw appError("VALIDATION", "Unidad no encontrada.");
  } else if (req.productId || req.barcode) {
    const product = db
      .select()
      .from(products)
      .where(
        and(
          eq(products.tenantId, ctx.tenantId),
          req.productId ? eq(products.id, req.productId) : eq(products.barcode, req.barcode!),
        ),
      )
      .all()[0];
    if (product) {
      const sellable = assertSellable(product);
      if (sellable.itemType === "serialized") {
        // handoff 01: scanning/tapping a serialized product opens the unit-pick modal
        const options = db
          .select({
            unitId: units.id,
            imei: units.imei,
            createdAt: units.createdAt,
            grade: units.grade,
            salePriceCents: units.salePriceCents,
          })
          .from(units)
          .where(and(eq(units.productId, product.id), eq(units.status, "in_stock")))
          .orderBy(asc(units.createdAt))
          .all();
        if (options.length === 0) throw appError("UNIT_NOT_AVAILABLE", "Sin unidades en stock de este modelo.");
        return {
          kind: "unitPick",
          productId: product.id,
          productName: product.name,
          units: options.map((u) => ({
            unitId: u.unitId,
            imei: u.imei,
            createdAtMs: u.createdAt.getTime(),
            grade: u.grade,
            salePriceCents: u.salePriceCents,
          })),
        };
      }
      productToAdd = sellable;
    } else if (req.barcode && isValidImei(req.barcode.trim())) {
      // handoff 01: scanning an IMEI directly adds that unit
      unitToAdd = db
        .select()
        .from(units)
        .where(and(eq(units.tenantId, ctx.tenantId), eq(units.imei, req.barcode.trim())))
        .all()[0] ?? null;
      if (!unitToAdd) throw appError("VALIDATION", "Sin resultados.", "barcode");
    } else {
      throw appError("VALIDATION", "Sin resultados.", "barcode");
    }
  }

  const state = mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();

    // lazy draft: use the given doc, else the terminal's existing draft, else create
    let docId = req.docId ?? null;
    if (docId) {
      requireDraft(tx, ctx, docId);
    } else {
      const existing = tx
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.tenantId, ctx.tenantId),
            eq(documents.terminalId, ctx.terminalId),
            eq(documents.status, "draft"),
          ),
        )
        .orderBy(desc(documents.createdAt))
        .all()[0];
      if (existing) {
        docId = existing.id;
      } else {
        docId = uuidv7();
        const doc = {
          id: docId,
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          terminalId: ctx.terminalId,
          docType: "ticket" as const,
          status: "draft" as const,
          seriesId: null,
          number: null,
          docNumber: null,
          parkedLabel: null,
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
          shiftId: null,
          userId: ctx.userId,
          fiscalHash: null,
          prevFiscalHash: null,
          fiscalStatus: null,
          createdAt: now,
          completedAt: null,
        };
        tx.insert(documents).values(doc).run();
        log({ entity: "document", entityId: docId, action: "create", before: null, after: toOplogJson(doc) });
      }
    }

    if (unitToAdd) {
      if (unitToAdd.status !== "in_stock") {
        throw appError("UNIT_NOT_AVAILABLE", "Esa unidad no está disponible.");
      }
      const product = tx.select().from(products).where(eq(products.id, unitToAdd.productId)).all()[0]!;
      const sellable = assertSellable(product);
      /* The unit's price wins when it has one, which is the schema's rule read
         forwards: NULL means "inherit the product's" and every phone bought
         over the counter is priced individually. Without this a used device
         would sell at its product's price, which is zero. */
      const unitPriceCents = unitToAdd.salePriceCents ?? sellable.priceCents;
      const money = computeLine({ qty: 1, unitPriceCents, taxRateBp: sellable.taxRateBp });
      const line = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        documentId: docId,
        lineNo: nextLineNo(tx, docId),
        lineType: "serialized_unit" as const,
        productId: product.id,
        unitId: unitToAdd.id,
        description: product.name, // snapshot (ADR-0007 spirit)
        qty: 1,
        unitPriceCents,
        priceOverridden: false,
        overrideReason: null,
        taxRegime: sellable.taxRegime,
        taxRateBp: sellable.taxRateBp,
        ...money,
        createdAt: now,
      };
      tx.insert(documentLines).values(line).run();
      log({ entity: "document_line", entityId: line.id, action: "create", before: null, after: toOplogJson(line) });

      const unitBefore = toOplogJson(unitToAdd);
      tx.update(units).set({ status: "reserved", updatedAt: now }).where(eq(units.id, unitToAdd.id)).run();
      const unitAfter = tx.select().from(units).where(eq(units.id, unitToAdd.id)).all()[0]!;
      log({ entity: "unit", entityId: unitToAdd.id, action: "reserve", before: unitBefore, after: toOplogJson(unitAfter) });
    } else if (productToAdd) {
      const qty = req.qty ?? 1;
      const existingLine = tx
        .select()
        .from(documentLines)
        .where(
          and(
            eq(documentLines.documentId, docId),
            eq(documentLines.lineType, "product"),
            eq(documentLines.productId, productToAdd.id),
            eq(documentLines.priceOverridden, false),
          ),
        )
        .all()[0];
      if (existingLine) {
        const newQty = existingLine.qty + qty;
        const money = computeLine({
          qty: newQty,
          unitPriceCents: existingLine.unitPriceCents,
          taxRateBp: existingLine.taxRateBp,
        });
        tx.update(documentLines).set({ qty: newQty, ...money }).where(eq(documentLines.id, existingLine.id)).run();
        const after = tx.select().from(documentLines).where(eq(documentLines.id, existingLine.id)).all()[0]!;
        log({
          entity: "document_line",
          entityId: existingLine.id,
          action: "update",
          before: toOplogJson(existingLine),
          after: toOplogJson(after),
        });
      } else {
        const money = computeLine({ qty, unitPriceCents: productToAdd.priceCents, taxRateBp: productToAdd.taxRateBp });
        const line = {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          documentId: docId,
          lineNo: nextLineNo(tx, docId),
          lineType: "product" as const,
          productId: productToAdd.id,
          unitId: null,
          description: productToAdd.name,
          qty,
          unitPriceCents: productToAdd.priceCents,
          priceOverridden: false,
          overrideReason: null,
          taxRegime: productToAdd.taxRegime,
          taxRateBp: productToAdd.taxRateBp,
          ...money,
          createdAt: now,
        };
        tx.insert(documentLines).values(line).run();
        log({ entity: "document_line", entityId: line.id, action: "create", before: null, after: toOplogJson(line) });
      }
    }

    refreshTotals(tx, log, docId);
    return loadState(tx, docId);
  });

  return { kind: "state", state };
}

/* --------------------- line mutations on the draft --------------------- */

function loadLine(tx: Reader, docId: string, lineId: string) {
  const line = tx
    .select()
    .from(documentLines)
    .where(and(eq(documentLines.documentId, docId), eq(documentLines.id, lineId)))
    .all()[0];
  if (!line) throw appError("VALIDATION", "Línea no encontrada.");
  return line;
}

export function setQty(db: ArkomDb, ctx: MutationCtx, req: { docId: string; lineId: string; qty: number }): SaleState {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    requireDraft(tx, ctx, req.docId);
    const line = loadLine(tx, req.docId, req.lineId);
    if (line.lineType !== "product") {
      throw appError("VALIDATION", "Una unidad serializada es siempre cantidad 1.", "qty");
    }
    const money = computeLine({ qty: req.qty, unitPriceCents: line.unitPriceCents, taxRateBp: line.taxRateBp });
    tx.update(documentLines).set({ qty: req.qty, ...money }).where(eq(documentLines.id, line.id)).run();
    const after = tx.select().from(documentLines).where(eq(documentLines.id, line.id)).all()[0]!;
    log({ entity: "document_line", entityId: line.id, action: "update", before: toOplogJson(line), after: toOplogJson(after) });
    refreshTotals(tx, log, req.docId);
    return loadState(tx, req.docId);
  });
}

export function removeLine(db: ArkomDb, ctx: MutationCtx, req: { docId: string; lineId: string }): SaleState {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    requireDraft(tx, ctx, req.docId);
    const line = loadLine(tx, req.docId, req.lineId);
    if (line.unitId) {
      // release the reservation
      const unit = tx.select().from(units).where(eq(units.id, line.unitId)).all()[0]!;
      tx.update(units).set({ status: "in_stock", updatedAt: new Date() }).where(eq(units.id, unit.id)).run();
      const after = tx.select().from(units).where(eq(units.id, unit.id)).all()[0]!;
      log({ entity: "unit", entityId: unit.id, action: "release", before: toOplogJson(unit), after: toOplogJson(after) });
    }
    tx.delete(documentLines).where(eq(documentLines.id, line.id)).run();
    log({ entity: "document_line", entityId: line.id, action: "delete", before: toOplogJson(line), after: null });
    refreshTotals(tx, log, req.docId);
    return loadState(tx, req.docId);
  });
}

export function overridePrice(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { docId: string; lineId: string; newPriceCents: number; reason: string },
): SaleState {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    requireDraft(tx, ctx, req.docId);
    const line = loadLine(tx, req.docId, req.lineId);
    const money = computeLine({ qty: line.qty, unitPriceCents: req.newPriceCents, taxRateBp: line.taxRateBp });
    tx.update(documentLines)
      .set({ unitPriceCents: req.newPriceCents, priceOverridden: true, overrideReason: req.reason.trim(), ...money })
      .where(eq(documentLines.id, line.id))
      .run();
    const after = tx.select().from(documentLines).where(eq(documentLines.id, line.id)).all()[0]!;
    // req 2.4: oplog entry for the override with before/after
    log({
      entity: "document_line",
      entityId: line.id,
      action: "price_override",
      before: toOplogJson(line),
      after: toOplogJson(after),
    });
    refreshTotals(tx, log, req.docId);
    return loadState(tx, req.docId);
  });
}

/* ----------------------------- park / resume ----------------------------- */

function defaultParkLabel(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getDate())}/${p(now.getMonth() + 1)} ${p(now.getHours())}:${p(now.getMinutes())}`;
}

export function park(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { docId: string; label?: string | null },
): { docId: string; parkedLabel: string } {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const doc = requireDraft(tx, ctx, req.docId);
    const lineCount = tx.select({ id: documentLines.id }).from(documentLines).where(eq(documentLines.documentId, doc.id)).all().length;
    if (lineCount === 0) throw appError("VALIDATION", "No se puede aparcar un ticket vacío.");
    const parkedLabel = req.label?.trim() || defaultParkLabel(new Date());
    tx.update(documents).set({ status: "parked", parkedLabel }).where(eq(documents.id, doc.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, doc.id)).all()[0]!;
    log({ entity: "document", entityId: doc.id, action: "park", before: toOplogJson(doc), after: toOplogJson(after) });
    return { docId: doc.id, parkedLabel };
  });
}

export function resume(db: ArkomDb, ctx: MutationCtx, req: { docId: string }): SaleState {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const target = tx
      .select()
      .from(documents)
      .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, req.docId)))
      .all()[0];
    if (!target || target.status !== "parked") throw appError("VALIDATION", "Ese ticket no está aparcado.");

    // the terminal's current draft: auto-park it if it has lines, drop it if empty
    const current = tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, ctx.tenantId),
          eq(documents.terminalId, ctx.terminalId),
          eq(documents.status, "draft"),
        ),
      )
      .all()[0];
    if (current) {
      const lineCount = tx
        .select({ id: documentLines.id })
        .from(documentLines)
        .where(eq(documentLines.documentId, current.id))
        .all().length;
      if (lineCount > 0) {
        const parkedLabel = defaultParkLabel(new Date());
        tx.update(documents).set({ status: "parked", parkedLabel }).where(eq(documents.id, current.id)).run();
        const after = tx.select().from(documents).where(eq(documents.id, current.id)).all()[0]!;
        log({ entity: "document", entityId: current.id, action: "park", before: toOplogJson(current), after: toOplogJson(after) });
      } else {
        tx.delete(documents).where(eq(documents.id, current.id)).run();
        log({ entity: "document", entityId: current.id, action: "delete", before: toOplogJson(current), after: null });
      }
    }

    tx.update(documents).set({ status: "draft", parkedLabel: null }).where(eq(documents.id, target.id)).run();
    const after = tx.select().from(documents).where(eq(documents.id, target.id)).all()[0]!;
    log({ entity: "document", entityId: target.id, action: "resume", before: toOplogJson(target), after: toOplogJson(after) });
    return loadState(tx, target.id);
  });
}

export function listParked(db: ArkomDb, ctx: MutationCtx): ParkedSale[] {
  return db
    .select({
      docId: documents.id,
      label: documents.parkedLabel,
      totalCents: documents.totalCents,
      createdAt: documents.createdAt,
      // NOTE: must be `${documents}.id`, not `${documents.id}` — in a join-free
      // select drizzle renders the latter unqualified ("id"), which SQLite then
      // resolves to dl.id inside the subquery and the count is always 0.
      lineCount: sql<number>`(select count(*) from document_lines dl where dl.document_id = ${documents}.id)`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, ctx.tenantId),
        eq(documents.terminalId, ctx.terminalId),
        eq(documents.status, "parked"),
      ),
    )
    .orderBy(desc(documents.createdAt))
    .all()
    .map((r) => ({
      docId: r.docId,
      label: r.label ?? "",
      lineCount: r.lineCount,
      totalCents: r.totalCents,
      createdAtMs: r.createdAt.getTime(),
    }));
}

/* ------------------------------ completion ------------------------------ */

export function complete(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { docId: string; tenders: TenderDraft[] },
): CompletedSale {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const doc = requireDraft(tx, ctx, req.docId);
    const lines = tx.select().from(documentLines).where(eq(documentLines.documentId, doc.id)).all();

    // revalidate totals from the lines (exact Σ, ADR-0006) and gate completion
    const totals = computeDocumentTotals(lines);
    const { changeCents } = validateCompletion({ lineCount: lines.length, totalCents: totals.totalCents, tenders: req.tenders });

    // ledger: one sale_out per stocked line, one per unit line — guard enforces req 5.3
    const drafts: { draft: MovementDraft; line: (typeof lines)[number]; costCents: number | null }[] = [];
    for (const line of lines) {
      const product = tx.select().from(products).where(eq(products.id, line.productId!)).all()[0]!;
      if (line.lineType === "serialized_unit") {
        const unit = tx.select().from(units).where(eq(units.id, line.unitId!)).all()[0];
        if (!unit || unit.status !== "reserved") {
          throw appError("UNIT_NOT_AVAILABLE", `La unidad de "${line.description}" ya no está disponible.`);
        }
        drafts.push({
          line,
          costCents: unit.costCents,
          draft: buildMovement({
            productId: line.productId!,
            locationId: ctx.locationId,
            movementType: "sale_out",
            qty: -1,
            unitId: unit.id,
          }),
        });
      } else {
        drafts.push({
          line,
          costCents: product.costCents,
          draft: buildMovement({
            productId: line.productId!,
            locationId: ctx.locationId,
            movementType: "sale_out",
            qty: -line.qty,
          }),
        });
      }
    }
    const productIds = [...new Set(lines.map((l) => l.productId!))];
    const levels: StockLevels = {};
    for (const pid of productIds) {
      const row = tx
        .select({ onHand: productStock.onHand })
        .from(productStock)
        .where(and(eq(productStock.productId, pid), eq(productStock.locationId, ctx.locationId)))
        .all()[0];
      levels[stockKey(pid, ctx.locationId)] = row?.onHand ?? 0;
    }
    const finalLevels = applyMovements(levels, drafts.map((d) => d.draft)); // NEGATIVE_STOCK → rollback, sale stays open

    // units → sold
    for (const { line } of drafts) {
      if (line.unitId) {
        const unit = tx.select().from(units).where(eq(units.id, line.unitId)).all()[0]!;
        tx.update(units)
          .set({ status: "sold", soldDocumentId: doc.id, updatedAt: now })
          .where(eq(units.id, unit.id))
          .run();
        const after = tx.select().from(units).where(eq(units.id, unit.id)).all()[0]!;
        log({ entity: "unit", entityId: unit.id, action: "sold", before: toOplogJson(unit), after: toOplogJson(after) });
      }
    }

    // movements (+ one oplog row each) linked to the document and line
    for (const { draft, line, costCents } of drafts) {
      const movement = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        productId: draft.productId,
        unitId: draft.unitId,
        movementType: draft.movementType,
        qty: draft.qty,
        unitCostCents: costCents,
        supplierId: null,
        documentId: doc.id,
        documentLineId: line.id,
        reason: null,
        userId: ctx.userId,
        createdAt: now,
      };
      tx.insert(stockMovements).values(movement).run();
      log({ entity: "stock_movement", entityId: movement.id, action: "create", before: null, after: toOplogJson(movement) });
    }

    // cache, same tx (ADR-0004)
    for (const pid of productIds) {
      const level = finalLevels[stockKey(pid, ctx.locationId)]!;
      const existing = tx
        .select({ onHand: productStock.onHand })
        .from(productStock)
        .where(and(eq(productStock.productId, pid), eq(productStock.locationId, ctx.locationId)))
        .all()[0];
      if (existing) {
        tx.update(productStock)
          .set({ onHand: level, updatedAt: now })
          .where(and(eq(productStock.productId, pid), eq(productStock.locationId, ctx.locationId)))
          .run();
      } else {
        tx.insert(productStock).values({ productId: pid, locationId: ctx.locationId, onHand: level, updatedAt: now }).run();
      }
    }

    // gap-free number, allocated inside this same transaction (ADR-0008)
    const series = tx
      .select()
      .from(numberSeries)
      .where(and(eq(numberSeries.terminalId, ctx.terminalId), eq(numberSeries.docType, "ticket")))
      .all()[0];
    if (!series) throw appError("VALIDATION", "Serie de numeración no configurada para este terminal.");
    const allocation = allocateNumber({ prefix: series.prefix, nextNumber: series.nextNumber });
    tx.update(numberSeries).set({ nextNumber: allocation.next.nextNumber }).where(eq(numberSeries.id, series.id)).run();

    // tenders
    for (const tender of req.tenders) {
      const row = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        documentId: doc.id,
        method: tender.method,
        amountCents: tender.amountCents,
        cardReference: tender.cardReference?.trim() || null,
        createdAt: now,
      };
      tx.insert(documentTenders).values(row).run();
      log({ entity: "document_tender", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });

      /* Store credit is spent HERE, inside the sale's own transaction, by a
         conditional update that only matches a voucher still marked issued
         (ADR-0013 §4). Reading the status first and writing it second would
         leave a window between the two; matching on it makes a second
         redemption fail rather than be unlikely — and if it fails, the whole
         sale rolls back with it. */
      if (tender.method === "store_credit") {
        redeemVoucher(tx, ctx, tender.voucherId!, doc.id, tender.amountCents, now, log);
      }
    }

    // finalize the document
    tx.update(documents)
      .set({
        status: "completed",
        /* stamped at COMPLETION, not when the draft was started: a ticket begun
           before the shift opened and charged after it belongs to the shift that
           took the money (ADR-0015 §9) */
        shiftId: currentShiftId(tx, ctx),
        seriesId: series.id,
        number: allocation.number,
        docNumber: allocation.docNumber,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        completedAt: now,
      })
      .where(eq(documents.id, doc.id))
      .run();
    const after = tx.select().from(documents).where(eq(documents.id, doc.id)).all()[0]!;
    log({ entity: "document", entityId: doc.id, action: "complete", before: toOplogJson(doc), after: toOplogJson(after) });

    return {
      docId: doc.id,
      docNumber: allocation.docNumber,
      number: allocation.number,
      totalCents: totals.totalCents,
      changeCents,
      completedAtMs: now.getTime(),
    };
  });
}

/* ------------------------------- peek ------------------------------- */

export function peek(db: ArkomDb, ctx: MutationCtx, docId: string): TicketPeek {
  const doc = db
    .select()
    .from(documents)
    .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, docId)))
    .all()[0];
  if (!doc) throw appError("VALIDATION", "Ticket no encontrado.");
  const lines = loadLines(db, docId);
  const tenders = db.select().from(documentTenders).where(eq(documentTenders.documentId, docId)).all();
  const paid = tenders.reduce((a, t) => a + t.amountCents, 0);
  return {
    docId: doc.id,
    docNumber: doc.docNumber,
    status: doc.status,
    completedAtMs: doc.completedAt?.getTime() ?? null,
    lines: lines.map(({ line, imei }) => ({
      description: line.description,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      totalCents: line.totalCents,
      imei,
      priceOverridden: line.priceOverridden,
      taxRegime: line.taxRegime,
    })),
    subtotalCents: doc.subtotalCents,
    taxCents: doc.taxCents,
    totalCents: doc.totalCents,
    tenders: tenders.map((t) => ({ method: t.method, amountCents: t.amountCents, cardReference: t.cardReference })),
    changeCents: Math.max(0, paid - doc.totalCents),
  };
}


/* ------------------------- store credit (ADR-0013) ------------------------ */

/**
 * Spend a voucher, once.
 *
 * The guarantee is the WHERE clause: the update matches only a row that is
 * still `issued`, so two tills — or two clicks — cannot both succeed. If it
 * matches nothing the sale throws, and because this runs inside the completion
 * transaction, nothing else about the sale survives either. There is no state
 * in which the goods left the shop and the voucher stayed spendable.
 *
 * The amount is checked against what the voucher actually holds rather than
 * trusted from the payload: a renderer could otherwise offer 80 € of credit
 * against a voucher worth 50 €.
 */
function redeemVoucher(
  tx: DbTx,
  ctx: MutationCtx,
  voucherId: string,
  documentId: string,
  amountCents: number,
  now: Date,
  log: LogFn,
): void {
  const voucher = tx
    .select()
    .from(storeCreditVouchers)
    .where(and(eq(storeCreditVouchers.tenantId, ctx.tenantId), eq(storeCreditVouchers.id, voucherId)))
    .all()[0];
  if (!voucher) throw appError("VALIDATION", "Ese vale no existe.", "voucherId");
  if (voucher.status !== "issued") {
    throw appError("VALIDATION", "Ese vale ya no se puede usar.", "voucherId");
  }
  if (amountCents > voucher.remainingCents) {
    throw appError("VALIDATION", "El vale no tiene saldo suficiente.", "voucherId");
  }

  /* A voucher may be spent in parts (2026-08-29): a customer with 50 € of
     credit buying a 10 € protector keeps 40 € on the slip. It is only finished
     when nothing is left, and only then does it point at the sale that closed
     it — a partially spent voucher belongs to no single ticket. */
  const remainingAfter = voucher.remainingCents - amountCents;
  const spent = remainingAfter === 0;

  const result = tx
    .update(storeCreditVouchers)
    .set({
      status: spent ? "redeemed" : "issued",
      remainingCents: remainingAfter,
      ...(spent ? { redeemedDocumentId: documentId, redeemedAt: now } : {}),
      updatedAt: now,
    })
    /* The guarantee, unchanged and now doing more work: the row must still be
       issued AND still hold what we are about to take. Two tills spending the
       same 50 € voucher on 40 € each cannot both match. */
    .where(
      and(
        eq(storeCreditVouchers.id, voucherId),
        eq(storeCreditVouchers.status, "issued"),
        gte(storeCreditVouchers.remainingCents, amountCents),
      ),
    )
    .run();

  if (result.changes !== 1) {
    throw appError("VALIDATION", "Ese vale acaba de usarse en otra venta.", "voucherId");
  }

  log({
    entity: "store_credit_voucher",
    entityId: voucherId,
    action: spent ? "redeem" : "redeem_partial",
    before: { status: "issued", remainingCents: voucher.remainingCents },
    after: {
      status: spent ? "redeemed" : "issued",
      spentCents: amountCents,
      remainingCents: remainingAfter,
      documentId,
    },
  });
}
