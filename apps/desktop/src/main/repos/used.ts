/**
 * Used-device repository (ADR-0013).
 *
 * The gate's database half, and the write that turns a filled form into a
 * purchase. The rules themselves live in `@arkom/core/used` — this file finds
 * rows, writes rows, and lets core decide what is allowed.
 */
import { and, eq } from "drizzle-orm";
import {
  allocateNumber,
  appError,
  applyMovements,
  assertGatePassed,
  buildMovement,
  evaluateGate,
  isValidImei,
  mutate,
  planIntake,
  stockKey,
  suggestedSellPriceCents,
  toOplogJson,
  unitCostCents,
  usedProductName,
  uuidv7,
  type LogFn,
  type MutationCtx,
  type UsedCheckImeiResponse,
  type UsedLogRequest,
  type UsedLogResponse,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { discardPurchasePhotos, savePurchasePhotos } from "../photos";

const {
  documents,
  numberSeries,
  productGroups,
  productStock,
  products,
  purchasePhotos,
  stockMovements,
  storeCreditVouchers,
  units,
  usedPurchases,
} = schema;

/** The group used devices are filed under, created the first time one is bought. */
const USED_GROUP_NAME = "Usados";

/**
 * Has this device been through the shop before?
 *
 * Two places to look, and both matter:
 *
 *   - **units** — bought, or received from a supplier, whatever its status.
 *     Including `sold`: a phone we sold and are now being offered again is the
 *     one case where the cashier most wants to be told, not blocked silently.
 *   - **used_purchases** — an intake still on hold, which has a unit but is
 *     worth naming by its purchase number instead, because that is what the
 *     cashier will find in the drawer.
 *
 * The reply names what was found and nothing else. No seller, no price: a
 * cashier without `usedDevices.viewSeller` must not be able to learn who sold
 * us a phone by typing IMEIs into this field.
 */
export function checkImei(db: ArkomDb, ctx: MutationCtx, rawImei: string): UsedCheckImeiResponse {
  const imei = rawImei.trim();

  // the same rule serialized stock entry uses — one definition of "an IMEI"
  if (!isValidImei(imei)) {
    return { ok: false, rejection: "format", existing: null };
  }

  const purchase = db
    .select({
      id: usedPurchases.id,
      number: documents.number,
      brand: usedPurchases.brand,
      model: usedPurchases.model,
    })
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.imei, imei)))
    .limit(1)
    .all()[0];

  if (purchase) {
    const number = purchase.number ?? "";
    const device = `${purchase.brand} ${purchase.model}`.trim();
    return {
      ok: false,
      rejection: "duplicate_purchase",
      existing: {
        kind: "purchase",
        id: purchase.id,
        label: number ? `${number} · ${device}` : device,
      },
    };
  }

  const unit = db
    .select({ id: units.id, name: products.name, status: units.status })
    .from(units)
    .innerJoin(products, eq(products.id, units.productId))
    .where(and(eq(units.tenantId, ctx.tenantId), eq(units.imei, imei)))
    .limit(1)
    .all()[0];

  if (unit) {
    return {
      ok: false,
      rejection: "duplicate_unit",
      existing: { kind: "unit", id: unit.id, label: unit.name },
    };
  }

  return { ok: true, rejection: null, existing: null };
}

/**
 * Record that someone was offered a device the shop already knows.
 *
 * An oplog entry with no business row of its own, the same shape auth events
 * use. It exists because the refusal is the interesting event: the phone in
 * front of the counter is one we have already bought, sold, or are holding, and
 * six months later "did we ever see this IMEI?" should have an answer even
 * though no purchase was ever created.
 */
export function logGateRejection(
  db: ArkomDb,
  ctx: MutationCtx,
  imei: string,
  reason: "duplicate_unit" | "duplicate_purchase",
  existingId: string | null,
): void {
  mutate(makeMutateRunner(db), ctx, (_tx, log) => {
    log({
      entity: "used_purchase",
      entityId: imei,
      action: "gate_rejected",
      before: null,
      after: { reason, existingId },
    });
  });
}

/* ---------------------------------------------------------------- writing */

/**
 * The C- series for this till.
 *
 * Created on demand rather than at first-run, because a shop that never buys a
 * used phone should not carry an empty series — and because tills installed
 * before v0.11.0 have no such row and must not need a data migration to get one.
 */
function purchaseSeries(tx: DbTx, ctx: MutationCtx) {
  const existing = tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.terminalId, ctx.terminalId), eq(numberSeries.docType, "purchase")))
    .all()[0];
  if (existing) return existing;

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    locationId: ctx.locationId,
    terminalId: ctx.terminalId,
    docType: "purchase" as const,
    prefix: "C-",
    nextNumber: 1,
  };
  tx.insert(numberSeries).values(row).run();
  return row;
}

/**
 * Find or create the catalogue product a used device is filed under.
 *
 * One product per brand+model+storage+colour (ADR-0013), NOT one per physical
 * phone: grade, battery and price live on the unit, because two identical
 * models are rarely in identical condition. The "(usado)" suffix in the name is
 * the marker — it is what hides the product from the Catálogo management list
 * and what a cashier sees in Sale search when the shop stocks the same model
 * new and second-hand.
 */
function findOrCreateUsedProduct(
  tx: DbTx,
  ctx: MutationCtx,
  log: LogFn,
  device: UsedLogRequest["device"],
  now: Date,
): string {
  const name = usedProductName(device);
  const found = tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.name, name)))
    .limit(1)
    .all()[0];
  if (found) return found.id;

  let group = tx
    .select({ id: productGroups.id })
    .from(productGroups)
    .where(and(eq(productGroups.tenantId, ctx.tenantId), eq(productGroups.name, USED_GROUP_NAME)))
    .limit(1)
    .all()[0];
  if (!group) {
    const groupRow = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      name: USED_GROUP_NAME,
      sortOrder: 90,
      createdAt: now,
    };
    tx.insert(productGroups).values(groupRow).run();
    log({ entity: "product_group", entityId: groupRow.id, action: "create", before: null, after: toOplogJson(groupRow) });
    group = { id: groupRow.id };
  }

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    groupId: group.id,
    name,
    itemType: "serialized" as const,
    priceCents: 0, // the unit carries the price; a used product has no list price
    /* REBU: the margin scheme for second-hand goods bought from private
       individuals. Snapshotted onto the sale line by ADR-0007's existing
       mechanism, so nothing about the sale path changes. */
    taxRegime: "REBU" as const,
    taxRateBp: 2100,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  tx.insert(products).values(row).run();
  log({ entity: "product", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });
  return row.id;
}

export interface LogPurchaseResult extends UsedLogResponse {
  /** absolute paths written before the transaction — see the note in logPurchase */
  photoPaths: string[];
}

/**
 * Log a purchase: one transaction, one oplog envelope.
 *
 * Order matters here. The gate is re-evaluated in MAIN from the database, not
 * trusted from the payload (spec V4): a renderer that has been open for ten
 * minutes may be looking at a device someone else bought in the meantime, and
 * "the UI disabled the button" is not a control.
 *
 * Photos are written to disk BEFORE the transaction opens, under the id we are
 * about to insert. If the transaction then fails, some JPEGs are orphaned in a
 * folder nothing references — recoverable, and the cheap direction of the
 * trade. The other way round leaves rows pointing at files that were never
 * written, which is a broken record rather than a stray file.
 */
export async function logPurchase(
  db: ArkomDb,
  ctx: MutationCtx,
  req: UsedLogRequest,
): Promise<LogPurchaseResult> {
  /* ---- the gate, decided here and not by the caller ---- */
  const conflict = checkImei(db, ctx, req.device.imei);
  assertGatePassed(
    evaluateGate({
      imei: req.device.imei,
      existingUnitId: conflict.rejection === "duplicate_unit" ? conflict.existing?.id : null,
      existingPurchaseId: conflict.rejection === "duplicate_purchase" ? conflict.existing?.id : null,
      confirmed: req.gateConfirmed,
    }),
  );

  if (req.action === "inventory" && (req.sellPriceCents === undefined || req.sellPriceCents <= 0)) {
    throw appError("VALIDATION", "Indica el precio de venta.", "sellPriceCents");
  }
  if (req.payout === "transfer" && !req.payoutReference?.trim()) {
    throw appError("VALIDATION", "Indica la referencia de la transferencia.", "payoutReference");
  }
  if (req.barcode) assertBarcodeFree(db, ctx, req.barcode);

  const purchaseId = uuidv7();
  const unitId = uuidv7();
  const photos = await savePurchasePhotos(purchaseId, req.photos);

  let result: UsedLogResponse;
  try {
    result = mutate(makeMutateRunner(db), ctx, (tx, log) => {
      const now = new Date();
      const productId = findOrCreateUsedProduct(tx, ctx, log, req.device, now);

      /* ---- the numbered document (ADR-0008: allocated in THIS transaction) ---- */
      const series = purchaseSeries(tx, ctx);
      const allocation = allocateNumber({ prefix: series.prefix, nextNumber: series.nextNumber });
      tx.update(numberSeries).set({ nextNumber: allocation.next.nextNumber }).where(eq(numberSeries.id, series.id)).run();

      const docRow = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        docType: "purchase" as const,
        status: "completed" as const,
        seriesId: series.id,
        number: allocation.number,
        docNumber: allocation.docNumber,
        /* money OUT of the shop. Left at zero on the document and carried on the
           purchase row instead: documents.total_cents means "what the customer
           paid us", and a purchase would invert its sign in every sales report
           that has ever been written against it. */
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        userId: ctx.userId ?? null,
        createdAt: now,
        completedAt: now,
      };
      tx.insert(documents).values(docRow).run();
      log({ entity: "document", entityId: docRow.id, action: "create", before: null, after: toOplogJson(docRow) });

      /* ---- status and movements, decided together (the slice-1 invariant) ---- */
      const intake = planIntake({
        target: req.action === "inventory" ? "in_stock" : "held",
        productId,
        locationId: ctx.locationId,
        unitId,
        buyPriceCents: req.buyPriceCents,
      });

      const purchaseRow = {
        id: purchaseId,
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        documentId: docRow.id,
        unitId,
        productId,
        brand: req.device.brand,
        model: req.device.model,
        storage: req.device.storage,
        color: req.device.color,
        grade: req.device.grade,
        batteryPct: req.device.batteryPct,
        imei: req.device.imei.trim(),
        accessories: req.device.accessories,
        barcode: req.barcode,
        sellerName: req.seller.name,
        sellerPhone: req.seller.phone,
        sellerIdType: req.seller.idType,
        sellerIdNumber: req.seller.idNumber,
        sellerAddress: null,
        acquisitionChannel: req.seller.channel,
        buyPriceCents: req.buyPriceCents,
        refurbCostCents: 0,
        payoutMethod: req.payout,
        payoutReference: req.payoutReference,
        needsReview: false,
        purchasedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(usedPurchases).values(purchaseRow).run();
      /* the seller block is personal data and the oplog is readable by anyone who
         can read the file, so the entry records the purchase, not the person */
      log({
        entity: "used_purchase",
        entityId: purchaseId,
        action: "create",
        before: null,
        after: {
          docNumber: allocation.docNumber,
          device: `${req.device.brand} ${req.device.model}`,
          imei: purchaseRow.imei,
          grade: req.device.grade,
          buyPriceCents: req.buyPriceCents,
          payout: req.payout,
          action: req.action,
        },
      });

      const unitRow = {
        id: unitId,
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        productId,
        imei: purchaseRow.imei,
        status: intake.unitStatus,
        costCents: unitCostCents(req.buyPriceCents),
        purchaseId,
        salePriceCents: req.action === "inventory" ? req.sellPriceCents! : null,
        grade: req.device.grade,
        batteryPct: req.device.batteryPct,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(units).values(unitRow).run();
      log({ entity: "unit", entityId: unitId, action: "create", before: null, after: toOplogJson(unitRow) });

      for (const movement of intake.movements) {
        postMovement(tx, ctx, log, movement, now);
      }

      for (const photo of photos) {
        const photoRow = {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          purchaseId,
          kind: photo.kind,
          path: photo.relativePath,
          createdAt: now,
        };
        tx.insert(purchasePhotos).values(photoRow).run();
        log({ entity: "purchase_photo", entityId: photoRow.id, action: "create", before: null, after: toOplogJson(photoRow) });
      }

      /* ---- store credit: money the shop now owes ---- */
      let voucherId: string | null = null;
      if (req.payout === "store_credit") {
        const voucherRow = {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          purchaseId,
          amountCents: req.buyPriceCents,
          remainingCents: req.buyPriceCents,
          status: "issued" as const,
          createdAt: now,
          updatedAt: now,
        };
        tx.insert(storeCreditVouchers).values(voucherRow).run();
        log({ entity: "store_credit_voucher", entityId: voucherRow.id, action: "issue", before: null, after: toOplogJson(voucherRow) });
        voucherId = voucherRow.id;
      }

      return {
        purchaseId,
        docNumber: allocation.docNumber,
        unitId,
        productId,
        voucherId,
        status: intake.unitStatus,
      };
    });
  } catch (err) {
    // the rows never landed, so the JPEGs on disk belong to nothing
    await discardPurchasePhotos(purchaseId);
    throw err;
  }

  return { ...result, photoPaths: photos.map((p) => p.absolutePath) };
}

/** A code may belong to exactly one thing in the shop. */
function assertBarcodeFree(db: ArkomDb, ctx: MutationCtx, code: string): void {
  const taken =
    db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, ctx.tenantId), eq(products.barcode, code)))
      .limit(1)
      .all().length > 0 ||
    db
      .select({ id: usedPurchases.id })
      .from(usedPurchases)
      .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.barcode, code)))
      .limit(1)
      .all().length > 0;
  if (taken) throw appError("DUPLICATE_BARCODE", "Ese código ya está en uso.", "barcode");
}

/**
 * Insert one movement and move the on-hand cache with it.
 *
 * The cache is written in the same transaction as the movement it summarises,
 * which is the whole reason `db:audit` can assert the two agree.
 */
function postMovement(
  tx: DbTx,
  ctx: MutationCtx,
  log: LogFn,
  movement: ReturnType<typeof buildMovement>,
  now: Date,
): void {
  const key = stockKey(movement.productId, movement.locationId);
  const current = tx
    .select({ onHand: productStock.onHand })
    .from(productStock)
    .where(and(eq(productStock.productId, movement.productId), eq(productStock.locationId, movement.locationId)))
    .all()[0];

  const levels = applyMovements({ [key]: current?.onHand ?? 0 }, [movement]);

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    locationId: movement.locationId,
    terminalId: ctx.terminalId,
    productId: movement.productId,
    unitId: movement.unitId,
    movementType: movement.movementType,
    qty: movement.qty,
    unitCostCents: movement.unitCostCents,
    reason: movement.reason,
    userId: ctx.userId ?? null,
    createdAt: now,
  };
  tx.insert(stockMovements).values(row).run();
  log({ entity: "stock_movement", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });

  if (current) {
    tx.update(productStock)
      .set({ onHand: levels[key]!, updatedAt: now })
      .where(and(eq(productStock.productId, movement.productId), eq(productStock.locationId, movement.locationId)))
      .run();
  } else {
    tx.insert(productStock)
      .values({
        productId: movement.productId,
        locationId: movement.locationId,
        onHand: levels[key]!,
        updatedAt: now,
      })
      .run();
  }

  // the last confirmed entry sets the product's cost (PRD 6.5)
  if (movement.unitCostCents !== null) {
    tx.update(products)
      .set({ costCents: movement.unitCostCents, updatedAt: now })
      .where(eq(products.id, movement.productId))
      .run();
  }
}

/** What the suggested selling price would be — the modal prefills from this. */
export function suggestedPrice(buyPriceCents: number, refurbCostCents: number, marginPct: number): number {
  return suggestedSellPriceCents(unitCostCents(buyPriceCents, refurbCostCents), marginPct);
}
