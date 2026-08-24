/**
 * Scan resolution repository — gathers every row a code could mean (product
 * primary barcodes ∪ additional product codes ∪ in-stock unit IMEIs) and lets
 * core decide. Used by the sale screen, stock entry and catalog search so all
 * three answer a scan identically.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  normalizeScanCode,
  resolveScan,
  type MutationCtx,
  type ScanProductCandidate,
  type ScanResolution,
  type ScanUnitCandidate,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";

const { products, productCodes, productStock, units } = schema;

export function resolveScanCode(db: ArkomDb, ctx: MutationCtx, rawCode: string): ScanResolution {
  const code = normalizeScanCode(rawCode);
  if (code === "") return { kind: "none", code };

  const productShape = {
    productId: products.id,
    name: products.name,
    itemType: products.itemType,
    priceCents: products.priceCents,
    onHand: sql<number>`coalesce(${productStock.onHand}, 0)`,
    active: products.active,
  };

  const primary = db
    .select(productShape)
    .from(products)
    .leftJoin(
      productStock,
      and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)),
    )
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.barcode, code)))
    .all();

  const aliased = db
    .select(productShape)
    .from(productCodes)
    .innerJoin(products, eq(productCodes.productId, products.id))
    .leftJoin(
      productStock,
      and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)),
    )
    .where(and(eq(productCodes.tenantId, ctx.tenantId), eq(productCodes.code, code)))
    .all();

  const unitRows = db
    .select({
      unitId: units.id,
      imei: units.imei,
      status: units.status,
      product: productShape,
    })
    .from(units)
    .innerJoin(products, eq(units.productId, products.id))
    .leftJoin(
      productStock,
      and(eq(productStock.productId, products.id), eq(productStock.locationId, ctx.locationId)),
    )
    .where(and(eq(units.tenantId, ctx.tenantId), eq(units.imei, code)))
    .all();

  const productCandidates: ScanProductCandidate[] = [
    ...primary.map((p) => ({ product: p, matchedVia: "primary" as const })),
    ...aliased.map((p) => ({ product: p, matchedVia: "alias" as const })),
  ];
  const unitCandidates: ScanUnitCandidate[] = unitRows.map((r) => ({
    unit: { unitId: r.unitId, imei: r.imei, status: r.status },
    product: r.product,
  }));

  return resolveScan(code, { products: productCandidates, units: unitCandidates });
}

/** Every product (other than `exceptProductId`) that already answers to `code`. */
export function productsHoldingCode(
  db: ArkomDb,
  ctx: MutationCtx,
  code: string,
  exceptProductId?: string,
): { productId: string; name: string }[] {
  const rows = [
    ...db
      .select({ productId: products.id, name: products.name })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.barcode, code)))
      .all(),
    ...db
      .select({ productId: products.id, name: products.name })
      .from(productCodes)
      .innerJoin(products, eq(productCodes.productId, products.id))
      .where(and(eq(productCodes.tenantId, ctx.tenantId), eq(productCodes.code, code)))
      .all(),
  ];
  const byId = new Map<string, { productId: string; name: string }>();
  for (const row of rows) {
    if (row.productId === exceptProductId) continue;
    byId.set(row.productId, row);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
