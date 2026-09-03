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
  groupNameKey,
  type GroupRef,
  isLowStock,
  isMissingData,
  isUsedProductName,
  mutate,
  normalizeScanCode,
  toOplogJson,
  uuidv7,
  type CatalogAddCodeRequest,
  type CatalogAddCodeResponse,
  type CatalogListRequest,
  type CatalogRemoval,
  type CatalogRemoveResponse,
  type CatalogSaveRequest,
  type CatalogSaveResponse,
  type MutationCtx,
  type ProductCode,
  type ProductRow,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { productsHoldingCode } from "./scan";
import { getSettings } from "./settings";

const { products, productCodes, productGroups, productStock, units, documentLines, stockMovements, repairLines, usedPurchases } =
  schema;

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
      groupNameEn: productGroups.nameEn,
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

export function listGroups(db: ArkomDb, ctx: MutationCtx): GroupRef[] {
  return db
    .select({ id: productGroups.id, name: productGroups.name, nameEn: productGroups.nameEn })
    .from(productGroups)
    .where(eq(productGroups.tenantId, ctx.tenantId))
    .orderBy(asc(productGroups.sortOrder))
    .all();
}

/**
 * Create a group, or rename one — ADR-0017.
 *
 * The unique index on (tenant, name) is the real guarantee; this check exists
 * so the shop gets DUPLICATE_NAME with the offending name rather than a
 * constraint violation, and so "Fundas" collides with "fundas " the way a
 * person expects it to. Accents are NOT collapsed: "Móviles" and "Moviles" are
 * different words and refusing the second would be wrong.
 */
function findByName(tx: DbTx, ctx: MutationCtx, name: string, exceptId?: string) {
  const key = groupNameKey(name);
  return tx
    .select({ id: productGroups.id, name: productGroups.name })
    .from(productGroups)
    .where(eq(productGroups.tenantId, ctx.tenantId))
    .all()
    .find((g) => groupNameKey(g.name) === key && g.id !== exceptId);
}

export function createGroup(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { name: string; nameEn?: string | null },
): GroupRef {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const name = input.name.trim().replace(/\s+/g, " ");
    const clash = findByName(tx, ctx, name);
    if (clash) throw appError("DUPLICATE_NAME", `Ya existe un grupo llamado "${clash.name}".`, "name");

    /* new groups go to the end. The starter five carry 0–4, so a shop's own
       group never lands in the middle of a list it did not choose the order of */
    const last = tx
      .select({ sortOrder: productGroups.sortOrder })
      .from(productGroups)
      .where(eq(productGroups.tenantId, ctx.tenantId))
      .all()
      .reduce((max, g) => Math.max(max, g.sortOrder), -1);

    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      name,
      nameEn: input.nameEn?.trim() || null,
      sortOrder: last + 1,
      isDemo: false,
      createdAt: new Date(),
    };
    tx.insert(productGroups).values(row).run();
    log({ entity: "product_group", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });
    return { id: row.id, name: row.name, nameEn: row.nameEn };
  });
}

export function renameGroup(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { id: string; name: string; nameEn?: string | null },
): GroupRef {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const name = input.name.trim().replace(/\s+/g, " ");
    const existing = tx
      .select()
      .from(productGroups)
      .where(and(eq(productGroups.tenantId, ctx.tenantId), eq(productGroups.id, input.id)))
      .all()[0];
    if (!existing) throw appError("VALIDATION", "Ese grupo no existe.", "id");

    const clash = findByName(tx, ctx, name, input.id);
    if (clash) throw appError("DUPLICATE_NAME", `Ya existe un grupo llamado "${clash.name}".`, "name");

    const nameEn = input.nameEn === undefined ? existing.nameEn : input.nameEn?.trim() || null;
    tx.update(productGroups).set({ name, nameEn }).where(eq(productGroups.id, input.id)).run();
    /* every product points at the ID, so the rename reaches the catalog list,
       the inventory filter and both reports without touching another row */
    log({
      entity: "product_group",
      entityId: input.id,
      action: "update",
      before: { name: existing.name, nameEn: existing.nameEn },
      after: { name, nameEn },
    });
    return { id: input.id, name, nameEn };
  });
}

export function listProducts(db: ArkomDb, ctx: MutationCtx, filters: CatalogListRequest): ProductRow[] {
  const conds: SQL[] = [];
  const f = filters ?? {};
  const search = f.search?.trim().replace(/[%_]/g, "");
  if (search && search.length >= 2) {
    // name, primary barcode OR any additional code — otherwise a box code the
    // shop attached would find nothing here while working everywhere else
    conds.push(
      or(
        like(products.name, `%${search}%`),
        like(products.barcode, `%${search}%`),
        sql`exists (select 1 from product_codes pc
              where pc.product_id = ${products}.id
                and pc.tenant_id = ${ctx.tenantId}
                and pc.code like ${`%${search}%`})`,
      )!,
    );
  }
  if (f.groupId) conds.push(eq(products.groupId, f.groupId));
  if (f.itemType) conds.push(eq(products.itemType, f.itemType));

  let rows = selectRows(db, ctx, conds.length ? and(...conds) : undefined);
  // low-stock / missing-data live in core (single source of truth); P1 catalog
  // sizes make post-filtering in JS the simpler correct choice.
  /* Second-hand products are bookkeeping the buy screen creates, not stock the
     owner maintains, so the management list leaves them out unless asked. The
     Sale screen asks. */
  /* Second-hand products are bookkeeping the buy screen creates, so the default
     management list leaves them out. But once the shop has picked a GROUP it is
     asking what is on that shelf, and answering "nothing" about a shelf it can
     see in the dropdown is not an answer (ADR-0013 §"the catalog list"). */
  if (!f.includeUsed && !f.groupId) rows = rows.filter((r) => r.itemType !== "used_device");
  /* An archived article is out of every list — Venta's grid, the code-attach
     picker, the management table — unless the catalogue asks for the archive
     by name. Filtered HERE so no caller has to remember (v0.18.0). */
  if (!f.includeArchived) rows = rows.filter((r) => r.active);
  if (f.lowStockOnly) rows = rows.filter((r) => isLowStock(r));
  if (f.missingDataOnly) rows = rows.filter((r) => isMissingData(r));
  return rows;
}

export function getProduct(db: Reader, ctx: MutationCtx, id: string): ProductRow {
  const row = selectRows(db, ctx, eq(products.id, id))[0];
  if (!row) throw appError("VALIDATION", "Artículo no encontrado.");
  return row;
}

/* ------------------------- additional product codes ------------------------- */

export function listCodes(db: ArkomDb, ctx: MutationCtx, productId: string): ProductCode[] {
  return db
    .select({ id: productCodes.id, code: productCodes.code, createdAt: productCodes.createdAt })
    .from(productCodes)
    .where(and(eq(productCodes.tenantId, ctx.tenantId), eq(productCodes.productId, productId)))
    .orderBy(asc(productCodes.createdAt))
    .all()
    .map((row) => ({ id: row.id, code: row.code, createdAtMs: row.createdAt.getTime() }));
}

export function addCode(db: ArkomDb, ctx: MutationCtx, input: CatalogAddCodeRequest): CatalogAddCodeResponse {
  const code = normalizeScanCode(input.code);
  if (code === "") throw appError("VALIDATION", "Código vacío.", "code");

  const product = db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, input.productId)))
    .all()[0];
  if (!product) throw appError("VALIDATION", "Artículo no encontrado.");
  if (product.barcode === code) {
    throw appError("VALIDATION", "Ese código ya es el código principal de este artículo.", "code");
  }
  if (listCodes(db, ctx, input.productId).some((c) => c.code === code)) {
    throw appError("VALIDATION", "Ese código ya está en este artículo.", "code");
  }

  // shared-code check runs BEFORE the transaction: a warning is not a mutation
  const conflicts = productsHoldingCode(db, ctx, code, input.productId);
  if (conflicts.length > 0 && !input.confirmed) {
    return { kind: "sharedWarning", code, conflicts };
  }

  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      productId: input.productId,
      code,
      createdAt: new Date(),
    };
    tx.insert(productCodes).values(row).run();
    log({ entity: "product_code", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });
  });
  return { kind: "added", codes: listCodes(db, ctx, input.productId) };
}

export function removeCode(db: ArkomDb, ctx: MutationCtx, productId: string, codeId: string): ProductCode[] {
  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const row = tx
      .select()
      .from(productCodes)
      .where(
        and(
          eq(productCodes.tenantId, ctx.tenantId),
          eq(productCodes.productId, productId),
          eq(productCodes.id, codeId),
        ),
      )
      .all()[0];
    if (!row) throw appError("VALIDATION", "Código no encontrado.");
    tx.delete(productCodes).where(eq(productCodes.id, codeId)).run();
    log({ entity: "product_code", entityId: codeId, action: "delete", before: toOplogJson(row), after: null });
  });
  return listCodes(db, ctx, productId);
}

export function saveProduct(db: ArkomDb, ctx: MutationCtx, input: CatalogSaveRequest): CatalogSaveResponse {
  const { vatRateBp } = getSettings(db, ctx);
  // req 4.4 (amended): a barcode already in use WARNS; the client confirms.
  // Checked outside the transaction — a warning must not open (or abort) one.
  const typedBarcode = normalizeScanCode(input.barcode ?? "");
  const priorBarcode = input.id
    ? (db
        .select({ barcode: products.barcode })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, input.id)))
        .all()[0]?.barcode ?? null)
    : null;
  // only warn about a barcode the user actually typed/changed — once two
  // products legitimately share a code, editing anything else must not re-nag
  if (typedBarcode !== "" && typedBarcode !== priorBarcode && !input.confirmed) {
    const conflicts = productsHoldingCode(db, ctx, typedBarcode, input.id ?? undefined);
    if (conflicts.length > 0) return { kind: "barcodeWarning", code: typedBarcode, conflicts };
  }

  const product = mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const name = input.name.trim();
    let barcode = input.barcode?.trim() || null;

    /* the regime follows the type (ADR-0007 A1): a used article sells under the
       margin scheme and nothing else does. Checked here and not only in the
       editor, because the editor is a courtesy and this is the rule */
    const regimeForType = input.itemType === "used_device" ? "REBU" : "IVA21";
    if (input.taxRegime !== regimeForType) {
      throw appError(
        "VALIDATION",
        input.itemType === "used_device"
          ? "Un artículo usado se vende en régimen de margen (REBU)."
          : "Solo un artículo usado puede ir en régimen de margen (REBU).",
        "taxRegime",
      );
    }

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

    // A typed barcode may now be shared (the caller already confirmed the
    // warning). Codes WE generate must still be unique across both spaces.
    const codeTaken = (code: string): boolean =>
      tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.tenantId, ctx.tenantId), eq(products.barcode, code), notSelf))
        .all().length > 0 ||
      tx
        .select({ id: productCodes.id })
        .from(productCodes)
        .where(and(eq(productCodes.tenantId, ctx.tenantId), eq(productCodes.code, code)))
        .all().length > 0;

    if (!barcode) {
      // req 4.2: blank barcode → internal EAN-13, unique within tenant
      do {
        barcode = generateInternalEan13();
      } while (codeTaken(barcode));
    }

    const values = {
      name,
      barcode,
      groupId: input.groupId,
      itemType: input.itemType,
      costCents: input.costCents,
      priceCents: input.priceCents,
      taxRegime: input.taxRegime,
      // the rate is the till's setting, never a figure the renderer sent (ADR-0007 A1)
      taxRateBp: input.taxRegime === "REBU" ? 0 : vatRateBp,
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
  return { kind: "saved", product };
}

/* ------------------------------------------------- removing an article (v0.18.0) */

/**
 * Whether anything in the books points at this product.
 *
 * A sale line, a stock movement, a unit, a repair part, a used-device purchase:
 * each is a fact the shop recorded, and deleting the row it names would leave
 * that fact pointing at nothing. A product with none of them was a typo, and a
 * typo may be deleted.
 */
function hasHistory(db: Reader, productId: string): boolean {
  const count = (q: { all(): { n: number }[] }) => q.all()[0]!.n;
  const n = sql<number>`count(*)`;
  return (
    count(db.select({ n }).from(documentLines).where(eq(documentLines.productId, productId))) > 0 ||
    count(db.select({ n }).from(stockMovements).where(eq(stockMovements.productId, productId))) > 0 ||
    count(db.select({ n }).from(units).where(eq(units.productId, productId))) > 0 ||
    count(db.select({ n }).from(repairLines).where(eq(repairLines.productId, productId))) > 0 ||
    count(db.select({ n }).from(usedPurchases).where(eq(usedPurchases.productId, productId))) > 0
  );
}

function onHandOf(db: Reader, ctx: MutationCtx, productId: string): number {
  return (
    db
      .select({ onHand: productStock.onHand })
      .from(productStock)
      .where(and(eq(productStock.productId, productId), eq(productStock.locationId, ctx.locationId)))
      .all()[0]?.onHand ?? 0
  );
}

/**
 * What Eliminar would do to this row. Asked before the confirm, so the dialog
 * can say "delete" or "archive" and mean it — and answered again inside the
 * transaction, so a sale that landed in between cannot turn an archive into a
 * delete.
 */
export function removalOf(db: Reader, ctx: MutationCtx, id: string): CatalogRemoval {
  const row = db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, id)))
    .all()[0];
  if (!row) throw appError("VALIDATION", "Artículo no encontrado.");
  const history = hasHistory(db, id);
  const onHand = onHandOf(db, ctx, id);
  /* history + stock on the shelf: archiving would hide units the shop still
     owns. The stock has to be adjusted to zero first, and that is a movement
     with a reason, not something a delete button does on the side */
  const kind = !history ? "delete" : onHand > 0 ? "blocked" : "archive";
  return { kind, hasHistory: history, onHand };
}

export function removeProduct(db: ArkomDb, ctx: MutationCtx, id: string): CatalogRemoveResponse {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const existing = tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, id)))
      .all()[0];
    if (!existing) throw appError("VALIDATION", "Artículo no encontrado.");
    const removal = removalOf(tx, ctx, id);

    if (removal.kind === "blocked") {
      throw appError("VALIDATION", `Tiene ${removal.onHand} en stock; ajusta el stock a cero antes de archivarlo.`);
    }

    if (removal.kind === "delete") {
      // its own rows only — the history check above is what makes this safe
      tx.delete(productCodes).where(eq(productCodes.productId, id)).run();
      tx.delete(productStock).where(eq(productStock.productId, id)).run();
      tx.delete(products).where(eq(products.id, id)).run();
      log({ entity: "product", entityId: id, action: "delete", before: toOplogJson(existing), after: null });
      return { kind: "deleted", product: null };
    }

    if (!existing.active) return { kind: "archived", product: getProduct(tx, ctx, id) };
    const now = new Date();
    tx.update(products).set({ active: false, updatedAt: now }).where(eq(products.id, id)).run();
    const after = tx.select().from(products).where(eq(products.id, id)).all()[0]!;
    log({ entity: "product", entityId: id, action: "archive", before: toOplogJson(existing), after: toOplogJson(after) });
    return { kind: "archived", product: getProduct(tx, ctx, id) };
  });
}

/** Back onto the lists. The history it kept is the reason it was only archived. */
export function restoreProduct(db: ArkomDb, ctx: MutationCtx, id: string): ProductRow {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const existing = tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, id)))
      .all()[0];
    if (!existing) throw appError("VALIDATION", "Artículo no encontrado.");
    if (existing.active) return getProduct(tx, ctx, id);
    const now = new Date();
    tx.update(products).set({ active: true, updatedAt: now }).where(eq(products.id, id)).run();
    const after = tx.select().from(products).where(eq(products.id, id)).all()[0]!;
    log({ entity: "product", entityId: id, action: "restore", before: toOplogJson(existing), after: toOplogJson(after) });
    return getProduct(tx, ctx, id);
  });
}
