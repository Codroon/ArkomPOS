/**
 * Inventory repository — reads over the product_stock cache (ADR-0004) and
 * the stock:add mutation. All ledger math lives in @arkom/core (movement
 * builders, negative-stock guard, last-cost); this file fetches and persists.
 */
import { and, asc, desc, eq, like, lt, or, sql, type SQL } from "drizzle-orm";
import {
  isSerializedItem,
  appError,
  applyMovements,
  buildMovement,
  isLowStock,
  validateImeiBatch,
  mutate,
  nextCostCents,
  stockKey,
  toOplogJson,
  uuidv7,
  type InventoryListRequest,
  type InventoryMovementsResponse,
  type InventoryRow,
  type MovementDraft,
  type MutationCtx,
  type StockAddRequest,
  type StockAddResponse,
  type StockLevels,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { resolveScanCode } from "./scan";

const { products, productGroups, productStock, stockMovements, units, documents } = schema;

const MOVEMENTS_PAGE = 50;

export function listInventory(db: ArkomDb, ctx: MutationCtx, filters: InventoryListRequest): InventoryRow[] {
  const f = filters ?? {};
  const conds: SQL[] = [];
  const search = f.search?.trim().replace(/[%_]/g, "");
  if (search && search.length >= 2) {
    conds.push(or(like(products.name, `%${search}%`), like(products.barcode, `%${search}%`))!);
  }
  if (f.groupId) conds.push(eq(products.groupId, f.groupId));
  if (f.itemType) conds.push(eq(products.itemType, f.itemType));

  // serialized valuation = Σ in-stock unit costs; stocked = onHand × cost (0 if cost unknown)
  const unitValuation = sql<number>`(
    select coalesce(sum(${units.costCents}), 0) from ${units}
    where ${units.productId} = ${products.id} and ${units.status} = 'in_stock'
  )`;
  const rows = db
    .select({
      productId: products.id,
      name: products.name,
      barcode: products.barcode,
      groupId: products.groupId,
      groupName: productGroups.name,
      itemType: products.itemType,
      onHand: sql<number>`coalesce(${productStock.onHand}, 0)`,
      reorderPoint: products.reorderPoint,
      lowStockThreshold: products.lowStockThreshold,
      costCents: products.costCents,
      valuationCents: sql<number>`case when ${products.itemType} = 'serialized'
        then ${unitValuation}
        else coalesce(${productStock.onHand}, 0) * coalesce(${products.costCents}, 0) end`,
      active: products.active,
    })
    .from(products)
    .leftJoin(productGroups, eq(products.groupId, productGroups.id))
    .leftJoin(
      productStock,
      and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)),
    )
    .where(conds.length ? and(eq(products.tenantId, ctx.tenantId), ...conds) : eq(products.tenantId, ctx.tenantId))
    .orderBy(asc(products.name))
    .all() as InventoryRow[];

  return f.lowStockOnly ? rows.filter((r) => isLowStock(r)) : rows;
}

export function listMovements(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { productId: string; cursor?: string | null },
): InventoryMovementsResponse {
  const conds = [eq(stockMovements.tenantId, ctx.tenantId), eq(stockMovements.productId, req.productId)];
  if (req.cursor) conds.push(lt(stockMovements.id, req.cursor)); // UUIDv7 ids are time-ordered
  const page = db
    .select({
      id: stockMovements.id,
      createdAt: stockMovements.createdAt,
      movementType: stockMovements.movementType,
      qty: stockMovements.qty,
      unitCostCents: stockMovements.unitCostCents,
      documentId: stockMovements.documentId,
      documentNumber: documents.docNumber,
      documentType: documents.docType,
      imei: units.imei,
      userId: stockMovements.userId,
    })
    .from(stockMovements)
    .leftJoin(documents, eq(stockMovements.documentId, documents.id))
    .leftJoin(units, eq(stockMovements.unitId, units.id))
    .where(and(...conds))
    .orderBy(desc(stockMovements.id))
    .limit(MOVEMENTS_PAGE + 1)
    .all();

  const hasMore = page.length > MOVEMENTS_PAGE;
  const rows = (hasMore ? page.slice(0, MOVEMENTS_PAGE) : page).map((r) => ({
    id: r.id,
    createdAtMs: r.createdAt.getTime(),
    movementType: r.movementType,
    qty: r.qty,
    unitCostCents: r.unitCostCents,
    documentId: r.documentId,
    documentNumber: r.documentNumber,
    documentType: r.documentType,
    imei: r.imei,
    userId: r.userId,
  }));
  return { rows, nextCursor: hasMore ? rows[rows.length - 1]!.id : null };
}

interface ResolvedEntry {
  product: typeof products.$inferSelect;
  unitCostCents: number;
  supplierId: string;
  /** stocked: the quantity received · serialized: how many units (= imeis.length) */
  qty: number;
  /** serialized only: one IMEI per unit this line brings in */
  imeis: string[];
}

/** One ledger movement to write: a stocked line makes one, a serialized line one per unit. */
interface PlannedMovement {
  entry: ResolvedEntry;
  imei: string | null;
  unitId: string | null;
  draft: MovementDraft;
}

/**
 * req 6 — one transaction: purchase_in movements (+ units for IMEI lines),
 * last-cost update, product_stock cache, one oplog row per movement.
 */
export function addStock(db: ArkomDb, ctx: MutationCtx, input: StockAddRequest): StockAddResponse {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();

    /* -- resolve + validate every entry before writing anything -- */
    const resolved: ResolvedEntry[] = [];
    const batchImeis = new Set<string>();
    for (const entry of input.entries) {
      let productId = entry.productId ?? null;
      if (!productId) {
        // same resolver the screens use: primary code ∪ additional codes ∪ IMEIs
        const resolution = resolveScanCode(db, ctx, entry.barcode!);
        if (resolution.kind === "product") productId = resolution.product.productId;
        else if (resolution.kind === "unit") productId = resolution.product.productId;
        else if (resolution.kind === "ambiguous") {
          throw appError("VALIDATION", "Ese código está en varios artículos; elige uno.", "barcode");
        } else throw appError("VALIDATION", "No existe ese código.", "barcode");
      }
      const product = tx
        .select()
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, productId)))
        .all()[0];
      if (!product) throw appError("VALIDATION", "No existe ese código.", "barcode");
      if (!product.active) {
        throw appError("VALIDATION", "Artículo inactivo; no puede recibir stock.", "barcode");
      }

      if (isSerializedItem(product.itemType)) {
        if (entry.expectedQty == null) {
          throw appError("VALIDATION", "Los artículos serializados necesitan un IMEI por unidad.", "imeis");
        }
        // core owns the count/Luhn/in-batch-duplicate rules (req 6.1)
        const imeis = validateImeiBatch({ expectedQty: entry.expectedQty, imeis: entry.imeis ?? [] });
        for (const imei of imeis) {
          if (batchImeis.has(imei)) {
            throw appError("DUPLICATE_IMEI", "Ese IMEI está repetido en la entrada.", "imei");
          }
          const taken = tx
            .select({ id: units.id })
            .from(units)
            .where(and(eq(units.tenantId, ctx.tenantId), eq(units.imei, imei)))
            .all()[0];
          if (taken) throw appError("DUPLICATE_IMEI", "Ese IMEI ya está registrado.", "imei");
          batchImeis.add(imei);
        }
        resolved.push({
          product,
          qty: imeis.length,
          unitCostCents: entry.unitCostCents,
          supplierId: entry.supplierId,
          imeis,
        });
      } else {
        if (entry.imeis && entry.imeis.length > 0) {
          throw appError("VALIDATION", "Este artículo no lleva IMEI.", "imeis");
        }
        if (entry.qty == null) throw appError("VALIDATION", "La cantidad es obligatoria.", "qty");
        resolved.push({
          product,
          qty: entry.qty,
          unitCostCents: entry.unitCostCents,
          supplierId: entry.supplierId,
          imeis: [],
        });
      }
    }

    /* -- ledger math in core: builders + negative guard over current levels -- */
    const productIds = [...new Set(resolved.map((r) => r.product.id))];
    const levels: StockLevels = {};
    for (const pid of productIds) {
      const row = tx
        .select({ onHand: productStock.onHand })
        .from(productStock)
        .where(and(eq(productStock.productId, pid), eq(productStock.locationId, ctx.locationId)))
        .all()[0];
      levels[stockKey(pid, ctx.locationId)] = row?.onHand ?? 0;
    }
    // a serialized line explodes into one +1 movement per unit (ADR-0004)
    const drafts: PlannedMovement[] = [];
    for (const entry of resolved) {
      if (entry.imeis.length > 0) {
        for (const imei of entry.imeis) {
          const unitId = uuidv7();
          drafts.push({
            entry,
            imei,
            unitId,
            draft: buildMovement({
              productId: entry.product.id,
              locationId: ctx.locationId,
              movementType: "purchase_in",
              qty: 1,
              unitCostCents: entry.unitCostCents,
              unitId,
            }),
          });
        }
      } else {
        drafts.push({
          entry,
          imei: null,
          unitId: null,
          draft: buildMovement({
            productId: entry.product.id,
            locationId: ctx.locationId,
            movementType: "purchase_in",
            qty: entry.qty,
            unitCostCents: entry.unitCostCents,
          }),
        });
      }
    }
    const finalLevels = applyMovements(levels, drafts.map((d) => d.draft));

    /* -- writes: units, movements (+oplog each), last-cost, cache -- */
    for (const { entry, draft, unitId, imei } of drafts) {
      if (unitId && imei) {
        const unit = {
          id: unitId,
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          productId: entry.product.id,
          imei,
          status: "in_stock" as const,
          costCents: entry.unitCostCents,
          soldDocumentId: null,
          createdAt: now,
          updatedAt: now,
        };
        tx.insert(units).values(unit).run();
        log({ entity: "unit", entityId: unitId, action: "create", before: null, after: toOplogJson(unit) });
      }
      const movement = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        productId: draft.productId,
        unitId,
        movementType: draft.movementType,
        qty: draft.qty,
        unitCostCents: draft.unitCostCents,
        supplierId: entry.supplierId,
        documentId: null,
        documentLineId: null,
        reason: draft.reason,
        userId: ctx.userId,
        createdAt: now,
      };
      tx.insert(stockMovements).values(movement).run();
      log({
        entity: "stock_movement",
        entityId: movement.id,
        action: "create",
        before: null,
        after: toOplogJson(movement),
      });
    }

    // last-cost rule (req 6.5): the latest confirmed entry per product wins
    for (const pid of productIds) {
      const lastEntry = [...resolved].reverse().find((r) => r.product.id === pid)!;
      const before = tx.select().from(products).where(eq(products.id, pid)).all()[0]!;
      const newCost = nextCostCents(before.costCents, lastEntry.unitCostCents);
      if (newCost !== before.costCents) {
        tx.update(products).set({ costCents: newCost, updatedAt: now }).where(eq(products.id, pid)).run();
        const after = tx.select().from(products).where(eq(products.id, pid)).all()[0]!;
        log({
          entity: "product",
          entityId: pid,
          action: "update",
          before: toOplogJson(before),
          after: toOplogJson(after),
        });
      }
    }

    // derived cache, same tx as the movements (ADR-0004); not oplogged (derivable)
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
        tx.insert(productStock)
          .values({ productId: pid, locationId: ctx.locationId, onHand: level, updatedAt: now })
          .run();
      }
    }

    return { lineCount: input.entries.length, productIds };
  });
}
