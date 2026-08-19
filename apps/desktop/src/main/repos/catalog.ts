/**
 * Catalog repository — drizzle reads + the catalog:save mutation. No business
 * math here: flags, guards and rates come from @arkom/core; every write goes
 * through mutate() (§3).
 */
import { and, asc, eq, like, ne, or, sql, type SQL } from "drizzle-orm";
import {
  appError,
  assertTypeChangeAllowed,
  generateInternalEan13,
  isLowStock,
  isMissingData,
  mutate,
  toOplogJson,
  uuidv7,
  TAX_RATE_BP,
  type CatalogListRequest,
  type CatalogSaveRequest,
  type MutationCtx,
  type ProductRow,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";

const { products, productGroups, productStock, units } = schema;

type Reader = ArkomDb | DbTx;

/** Shared row projection: product + group name + on-hand at this location. */
function selectRows(db: Reader, ctx: MutationCtx, extra?: SQL): ProductRow[] {
  const rows = db
    .select({
      id: products.id,
      name: products.name,
      barcode: products.barcode,
      groupId: products.groupId,
      groupName: productGroups.name,
      itemType: products.itemType,
      costCents: products.costCents,
      priceCents: products.priceCents,
      taxRegime: products.taxRegime,
      taxRateBp: products.taxRateBp,
      onHand: sql<number>`coalesce(${productStock.onHand}, 0)`,
      reorderPoint: products.reorderPoint,
      lowStockThreshold: products.lowStockThreshold,
      active: products.active,
    })
    .from(products)
    .leftJoin(productGroups, eq(products.groupId, productGroups.id))
    .leftJoin(
      productStock,
      and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)),
    )
    .where(extra ? and(eq(products.tenantId, ctx.tenantId), extra) : eq(products.tenantId, ctx.tenantId))
    .orderBy(asc(products.name))
    .all();
  return rows as ProductRow[];
}

export function listGroups(db: ArkomDb, ctx: MutationCtx): { id: string; name: string }[] {
  return db
    .select({ id: productGroups.id, name: productGroups.name })
    .from(productGroups)
    .where(eq(productGroups.tenantId, ctx.tenantId))
    .orderBy(asc(productGroups.sortOrder))
    .all();
}

export function listProducts(db: ArkomDb, ctx: MutationCtx, filters: CatalogListRequest): ProductRow[] {
  const conds: SQL[] = [];
  const f = filters ?? {};
  const search = f.search?.trim().replace(/[%_]/g, "");
  if (search && search.length >= 2) {
    conds.push(or(like(products.name, `%${search}%`), like(products.barcode, `%${search}%`))!);
  }
  if (f.groupId) conds.push(eq(products.groupId, f.groupId));
  if (f.itemType) conds.push(eq(products.itemType, f.itemType));

  let rows = selectRows(db, ctx, conds.length ? and(...conds) : undefined);
  // low-stock / missing-data live in core (single source of truth); P1 catalog
  // sizes make post-filtering in JS the simpler correct choice.
  if (f.lowStockOnly) rows = rows.filter((r) => isLowStock(r));
  if (f.missingDataOnly) rows = rows.filter((r) => isMissingData(r));
  return rows;
}

export function getProduct(db: Reader, ctx: MutationCtx, id: string): ProductRow {
  const row = selectRows(db, ctx, eq(products.id, id))[0];
  if (!row) throw appError("VALIDATION", "Artículo no encontrado.");
  return row;
}

export function saveProduct(db: ArkomDb, ctx: MutationCtx, input: CatalogSaveRequest): ProductRow {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const name = input.name.trim();
    let barcode = input.barcode?.trim() || null;

    // group must exist in this tenant (friendlier than a raw FK failure)
    const group = tx
      .select({ id: productGroups.id })
      .from(productGroups)
      .where(and(eq(productGroups.tenantId, ctx.tenantId), eq(productGroups.id, input.groupId)))
      .all()[0];
    if (!group) throw appError("VALIDATION", "Grupo no válido.", "groupId");

    // load existing row (update path) and guard the type switch (req 4.3)
    const existing = input.id
      ? tx
          .select()
          .from(products)
          .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, input.id)))
          .all()[0]
      : undefined;
    if (input.id && !existing) throw appError("VALIDATION", "Artículo no encontrado.");
    if (existing) {
      const onHand =
        tx
          .select({ onHand: productStock.onHand })
          .from(productStock)
          .where(and(eq(productStock.productId, existing.id), eq(productStock.locationId, ctx.locationId)))
          .all()[0]?.onHand ?? 0;
      const unitCount = tx
        .select({ n: sql<number>`count(*)` })
        .from(units)
        .where(eq(units.productId, existing.id))
        .all()[0]!.n;
      assertTypeChangeAllowed({
        fromType: existing.itemType,
        toType: input.itemType,
        onHand,
        unitCount,
      });
    }

    // req 4.4 — duplicates within tenant, field-level typed errors
    const notSelf = existing ? ne(products.id, existing.id) : undefined;
    const nameClash = tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.tenantId, ctx.tenantId),
          sql`lower(${products.name}) = lower(${name})`,
          notSelf,
        ),
      )
      .all()[0];
    if (nameClash) throw appError("DUPLICATE_NAME", "Ya existe un artículo con ese nombre.", "name");

    const barcodeTaken = (code: string): boolean =>
      tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.barcode, code), notSelf))
        .all().length > 0;

    if (barcode) {
      if (barcodeTaken(barcode)) {
        throw appError("DUPLICATE_BARCODE", "Ese código de barras ya existe.", "barcode");
      }
    } else {
      // req 4.2: blank barcode → internal EAN-13, unique within tenant
      do {
        barcode = generateInternalEan13();
      } while (barcodeTaken(barcode));
    }

    const values = {
      name,
      barcode,
      groupId: input.groupId,
      itemType: input.itemType,
      costCents: input.costCents,
      priceCents: input.priceCents,
      taxRegime: input.taxRegime,
      taxRateBp: TAX_RATE_BP[input.taxRegime], // snapshot source, derived server-side
      reorderPoint: input.reorderPoint,
      lowStockThreshold: input.lowStockThreshold,
      active: input.active,
      updatedAt: now,
    };

    let id: string;
    if (existing) {
      id = existing.id;
      tx.update(products).set(values).where(eq(products.id, id)).run();
      const after = tx.select().from(products).where(eq(products.id, id)).all()[0]!;
      log({
        entity: "product",
        entityId: id,
        action: "update",
        before: toOplogJson(existing),
        after: toOplogJson(after),
      });
    } else {
      id = uuidv7();
      const row = { id, tenantId: ctx.tenantId, createdAt: now, ...values };
      tx.insert(products).values(row).run();
      log({ entity: "product", entityId: id, action: "create", before: null, after: toOplogJson(row) });
    }

    return getProduct(tx, ctx, id);
  });
}
