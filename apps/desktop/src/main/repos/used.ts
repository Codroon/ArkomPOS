/**
 * Used-device repository (ADR-0013).
 *
 * The gate's database half, and the write that turns a filled form into a
 * purchase. The rules themselves live in `@arkom/core/used` — this file finds
 * rows, writes rows, and lets core decide what is allowed.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  allocateNumber,
  appError,
  applyMovements,
  assertGatePassed,
  assertVoidable,
  checkRedeemable,
  buildMovement,
  evaluateGate,
  isValidImei,
  mutate,
  planIntake,
  stockKey,
  suggestedSellPriceCents,
  toOplogJson,
  unitCostCents,
  usedDeviceState,
  usedProductName,
  uuidv7,
  type LogFn,
  type MutationCtx,
  type UsedCheckImeiResponse,
  type UsedDeviceDetail,
  type UsedDeviceRow,
  type UsedDeviceState,
  type UsedLogRequest,
  type UsedLogResponse,
  type RedeemRefusal,
  type VoucherRow,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { postMovement } from "./stock-ledger";
import { discardPurchasePhotos, readPhotos, savePurchasePhotos } from "../photos";

const {
  documents,
  oplog,
  users,
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
        postMovement(tx, ctx, log, movement, now, docRow.id);
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


/** What the suggested selling price would be — the modal prefills from this. */
export function suggestedPrice(buyPriceCents: number, refurbCostCents: number, marginPct: number): number {
  return suggestedSellPriceCents(unitCostCents(buyPriceCents, refurbCostCents), marginPct);
}

/* ---------------------------------------------------------------- reading */

/** Everything the list and the detail share, straight off the two tables. */
const listShape = {
  purchase: usedPurchases,
  docNumber: documents.docNumber,
  unitStatus: units.status,
  unitId: units.id,
  sellPriceCents: units.salePriceCents,
  soldDocumentId: units.soldDocumentId,
};

function toRow(row: {
  purchase: typeof usedPurchases.$inferSelect;
  docNumber: string | null;
  unitStatus: string | null;
  unitId: string | null;
  sellPriceCents: number | null;
  soldDocumentId: string | null;
}): UsedDeviceRow {
  const p = row.purchase;
  return {
    purchaseId: p.id,
    docNumber: row.docNumber ?? "",
    unitId: row.unitId,
    brand: p.brand,
    model: p.model,
    storage: p.storage,
    color: p.color,
    grade: p.grade,
    imei: p.imei,
    barcode: p.barcode,
    purchasedAtMs: p.purchasedAt.getTime(),
    buyPriceCents: p.buyPriceCents,
    refurbCostCents: p.refurbCostCents,
    // derived, never stored: the chip cannot disagree with the unit
    state: usedDeviceState(row.unitStatus ?? "held", p.needsReview),
    sellPriceCents: row.sellPriceCents,
    soldDocumentId: row.soldDocumentId,
    soldDocNumber: null,
  };
}

/**
 * The used-devices list.
 *
 * Filtering and searching happen here rather than in SQL: a shop that buys a
 * few phones a week will not have a table where that matters for years, and one
 * query with one shape is easier to keep honest than six. The counts are always
 * over EVERYTHING, because a filter that also changes its own chip counts is a
 * filter nobody can navigate back out of.
 */
export function listUsedDevices(
  db: ArkomDb,
  ctx: MutationCtx,
  filter: { state?: UsedDeviceState; search?: string } = {},
): { rows: UsedDeviceRow[]; counts: Record<UsedDeviceState, number> } {
  const all = db
    .select(listShape)
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .leftJoin(units, eq(units.id, usedPurchases.unitId))
    .where(eq(usedPurchases.tenantId, ctx.tenantId))
    .all()
    .map(toRow)
    .sort((a, b) => b.purchasedAtMs - a.purchasedAtMs);

  /* the sale that sold it, for the link on a sold row */
  const soldIds = all.map((r) => r.soldDocumentId).filter((id): id is string => id !== null);
  if (soldIds.length > 0) {
    const numbers = new Map(
      db
        .select({ id: documents.id, docNumber: documents.docNumber })
        .from(documents)
        .where(inArray(documents.id, soldIds))
        .all()
        .map((d) => [d.id, d.docNumber] as const),
    );
    for (const row of all) {
      if (row.soldDocumentId) row.soldDocNumber = numbers.get(row.soldDocumentId) ?? null;
    }
  }

  const counts: Record<UsedDeviceState, number> = { held: 0, needs_review: 0, in_stock: 0, sold: 0 };
  for (const row of all) counts[row.state] += 1;

  const needle = filter.search?.trim().toLowerCase() ?? "";
  const rows = all.filter((row) => {
    if (filter.state && row.state !== filter.state) return false;
    if (needle === "") return true;
    // one box: IMEI, model, purchase number or the label on the box
    return (
      row.imei.includes(needle) ||
      `${row.brand} ${row.model}`.toLowerCase().includes(needle) ||
      row.docNumber.toLowerCase().includes(needle) ||
      (row.barcode ?? "").toLowerCase().includes(needle)
    );
  });

  return { rows, counts };
}

/** Names for the timeline, resolved once rather than per entry. */
function userNames(db: ArkomDb, ids: ReadonlyArray<string>): Map<string, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, unique))
      .all()
      .map((u) => [u.id, u.name] as const),
  );
}

/**
 * One device, in full.
 *
 * `canViewSeller` decides whether the seller block is in the payload at all.
 * Not a flag the UI honours — the fields are absent (ADR-0012 §5): a value the
 * renderer never receives cannot leak through a CSS mistake or an inspector.
 */
export async function getUsedDevice(
  db: ArkomDb,
  ctx: MutationCtx,
  purchaseId: string,
  canViewSeller: boolean,
): Promise<UsedDeviceDetail> {
  const found = db
    .select(listShape)
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .leftJoin(units, eq(units.id, usedPurchases.unitId))
    .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.id, purchaseId)))
    .limit(1)
    .all()[0];
  if (!found) throw appError("VALIDATION", "Ese dispositivo no existe.");

  const row = toRow(found);
  if (row.soldDocumentId) {
    row.soldDocNumber =
      db
        .select({ docNumber: documents.docNumber })
        .from(documents)
        .where(eq(documents.id, row.soldDocumentId))
        .limit(1)
        .all()[0]?.docNumber ?? null;
  }

  const p = found.purchase;
  const accessories = (p.accessories ?? {}) as Partial<Record<"charger" | "box" | "cable" | "case", boolean>>;

  const voucher = db
    .select({
      id: storeCreditVouchers.id,
      status: storeCreditVouchers.status,
      amountCents: storeCreditVouchers.amountCents,
    })
    .from(storeCreditVouchers)
    .where(eq(storeCreditVouchers.purchaseId, purchaseId))
    .limit(1)
    .all()[0];

  /* the gallery. The seller's ID photo is part of the seller block, so it is
     withheld with it rather than shown to anyone who opens the page. */
  const photoRows = db
    .select()
    .from(purchasePhotos)
    .where(eq(purchasePhotos.purchaseId, purchaseId))
    .all()
    .filter((photo) => canViewSeller || photo.kind !== "seller_id");
  const photos = await readPhotos(photoRows);

  /* The history, newest first: the purchase, the unit it created, and the
     document — prints are logged against the document, and "did that purchase
     slip ever come out?" is exactly what someone opens this pane to answer. */
  const ids = [purchaseId, p.documentId, ...(row.unitId ? [row.unitId] : [])];
  const entries = db
    .select()
    .from(oplog)
    .where(and(eq(oplog.tenantId, ctx.tenantId), inArray(oplog.entityId, ids)))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const names = userNames(
    db,
    entries.flatMap((e) => [e.userId, e.authorizedByUserId].filter((x): x is string => Boolean(x))),
  );

  return {
    ...row,
    batteryPct: p.batteryPct,
    accessories: {
      charger: accessories.charger === true,
      box: accessories.box === true,
      cable: accessories.cable === true,
      case: accessories.case === true,
    },
    payout: p.payoutMethod,
    payoutReference: p.payoutReference,
    voucher: voucher ?? null,
    unitCostCents: unitCostCents(p.buyPriceCents, p.refurbCostCents),
    needsReview: p.needsReview,
    editable: row.state === "held" || row.state === "needs_review",
    photos,
    seller: canViewSeller
      ? {
          name: p.sellerName,
          phone: p.sellerPhone,
          idType: p.sellerIdType,
          idNumber: p.sellerIdNumber,
          channel: p.acquisitionChannel,
        }
      : null,
    canViewSeller,
    timeline: entries.map((e) => ({
      atMs: e.createdAt.getTime(),
      entity: e.entity,
      action: e.action,
      actorName: e.userId ? (names.get(e.userId) ?? null) : null,
      approverName: e.authorizedByUserId ? (names.get(e.authorizedByUserId) ?? null) : null,
    })),
  };
}

/* ---------------------------------------------------------------- editing */

function loadForEdit(db: ArkomDb, ctx: MutationCtx, purchaseId: string) {
  const found = db
    .select(listShape)
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .leftJoin(units, eq(units.id, usedPurchases.unitId))
    .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.id, purchaseId)))
    .limit(1)
    .all()[0];
  if (!found) throw appError("VALIDATION", "Ese dispositivo no existe.");
  return found;
}

/** The "Requiere revisión" switch. A flag on the purchase, not a status. */
export function setNeedsReview(
  db: ArkomDb,
  ctx: MutationCtx,
  purchaseId: string,
  needsReview: boolean,
): void {
  const found = loadForEdit(db, ctx, purchaseId);
  if (found.unitStatus !== "held") {
    throw appError("VALIDATION", "Solo se puede marcar un dispositivo en espera.");
  }
  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    tx.update(usedPurchases)
      .set({ needsReview, updatedAt: new Date() })
      .where(eq(usedPurchases.id, purchaseId))
      .run();
    log({
      entity: "used_purchase",
      entityId: purchaseId,
      action: needsReview ? "flag_review" : "clear_review",
      before: { needsReview: found.purchase.needsReview },
      after: { needsReview },
    });
  });
}

/**
 * Edit what the shop spent putting the device right.
 *
 * Only while it is held. Once it is in stock the figure has been folded into a
 * posted stock movement, and changing it afterwards would mean either rewriting
 * that movement — the one thing an insert-only ledger forbids (ADR-0004) — or
 * letting the unit's cost and its movement disagree. So it freezes, and the
 * screen says why rather than silently disabling a field.
 */
export function setRefurbCost(
  db: ArkomDb,
  ctx: MutationCtx,
  purchaseId: string,
  refurbCostCents: number,
): void {
  const found = loadForEdit(db, ctx, purchaseId);
  if (found.unitStatus !== "held") {
    throw appError(
      "VALIDATION",
      "El coste ya está incluido en el inventario y no se puede cambiar.",
      "refurbCostCents",
    );
  }
  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    tx.update(usedPurchases)
      .set({ refurbCostCents, updatedAt: now })
      .where(eq(usedPurchases.id, purchaseId))
      .run();
    // the unit's cost tracks it while nothing has been posted
    if (found.unitId) {
      tx.update(units)
        .set({ costCents: unitCostCents(found.purchase.buyPriceCents, refurbCostCents), updatedAt: now })
        .where(eq(units.id, found.unitId))
        .run();
    }
    log({
      entity: "used_purchase",
      entityId: purchaseId,
      action: "set_refurb_cost",
      before: { refurbCostCents: found.purchase.refurbCostCents },
      after: { refurbCostCents },
    });
  });
}

/**
 * Send a held device to the shelf.
 *
 * The same transition *Enviar a inventario* performs on the buy screen, reached
 * days later from the detail view: one tradein_in at buy + refurb cost, the unit
 * priced and flipped to in_stock. planIntake() produces the status and the
 * movement together, so this cannot post one without the other.
 */
export function sendToInventory(
  db: ArkomDb,
  ctx: MutationCtx,
  purchaseId: string,
  sellPriceCents: number,
): { unitId: string; sellPriceCents: number; unitCostCents: number } {
  const found = loadForEdit(db, ctx, purchaseId);
  if (found.unitStatus !== "held") {
    throw appError("VALIDATION", "Ese dispositivo ya está en inventario.");
  }
  if (!found.unitId) throw appError("VALIDATION", "Esa compra no tiene unidad.");

  const p = found.purchase;
  const intake = planIntake({
    target: "in_stock",
    productId: p.productId!,
    locationId: p.locationId,
    unitId: found.unitId,
    buyPriceCents: p.buyPriceCents,
    refurbCostCents: p.refurbCostCents,
  });

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    tx.update(units)
      .set({
        status: "in_stock",
        salePriceCents: sellPriceCents,
        costCents: intake.unitCostCents!,
        updatedAt: now,
      })
      .where(eq(units.id, found.unitId!))
      .run();
    log({
      entity: "unit",
      entityId: found.unitId!,
      action: "to_inventory",
      before: { status: "held", salePriceCents: null },
      after: { status: "in_stock", salePriceCents: sellPriceCents, costCents: intake.unitCostCents },
    });

    for (const movement of intake.movements) postMovement(tx, ctx, log, movement, now, p.documentId);

    tx.update(usedPurchases)
      .set({ needsReview: false, updatedAt: now })
      .where(eq(usedPurchases.id, purchaseId))
      .run();

    return {
      unitId: found.unitId!,
      sellPriceCents,
      unitCostCents: intake.unitCostCents!,
    };
  });
}

/* ----------------------------------------------------------- store credit */

/**
 * Find a voucher to pay with.
 *
 * Searched by what the customer is holding: the purchase number printed on the
 * slip, or the slip scanned. NOT by the seller's name unless the session may
 * read it — the handoff drew a name in these results, and shipping that would
 * have turned the payment panel into a way to read the second-hand register.
 *
 * Every row comes back with its `refusal`, so the finder can show a voided or
 * spent voucher greyed out with a reason instead of pretending it does not
 * exist. "That voucher was already used on Tuesday" is an answer; silence is
 * an argument at the counter.
 */
export function findVouchers(
  db: ArkomDb,
  ctx: MutationCtx,
  search: string,
  saleTotalCents: number,
  canViewSeller: boolean,
): { rows: Array<VoucherRow & { refusal: RedeemRefusal | null }> } {
  const needle = search.trim().toLowerCase();
  if (needle === "") return { rows: [] };

  const rows = db
    .select({
      voucher: storeCreditVouchers,
      docNumber: documents.docNumber,
      sellerName: usedPurchases.sellerName,
    })
    .from(storeCreditVouchers)
    .leftJoin(usedPurchases, eq(usedPurchases.id, storeCreditVouchers.purchaseId))
    .leftJoin(documents, eq(documents.id, usedPurchases.documentId))
    .where(eq(storeCreditVouchers.tenantId, ctx.tenantId))
    .all()
    .filter((row) => {
      const number = (row.docNumber ?? "").toLowerCase();
      if (number.includes(needle)) return true;
      // the name is searchable only by those who may see it at all
      return canViewSeller && (row.sellerName ?? "").toLowerCase().includes(needle);
    })
    .slice(0, 12);

  return {
    rows: rows.map((row) => ({
      id: row.voucher.id,
      docNumber: row.docNumber ?? "",
      amountCents: row.voucher.amountCents,
      remainingCents: row.voucher.remainingCents,
      status: row.voucher.status,
      issuedAtMs: row.voucher.createdAt.getTime(),
      sellerName: canViewSeller ? row.sellerName : null,
      refusal: checkRedeemable(
        {
          status: row.voucher.status,
          amountCents: row.voucher.amountCents,
          remainingCents: row.voucher.remainingCents,
        },
        saleTotalCents,
      ),
    })),
  };
}

/**
 * Cancel a voucher the shop is not going to honour.
 *
 * Only from `issued`, only with a reason, and never after it has been spent —
 * voiding a redeemed voucher would erase the record of a payment that was
 * actually made. The reason goes in the oplog, because "why is there 80 € less
 * owed than the purchase says?" needs an answer.
 */
export function voidVoucher(db: ArkomDb, ctx: MutationCtx, voucherId: string, reason: string): void {
  const voucher = db
    .select()
    .from(storeCreditVouchers)
    .where(and(eq(storeCreditVouchers.tenantId, ctx.tenantId), eq(storeCreditVouchers.id, voucherId)))
    .all()[0];
  if (!voucher) throw appError("VALIDATION", "Ese vale no existe.", "voucherId");
  assertVoidable(
    { status: voucher.status, amountCents: voucher.amountCents, remainingCents: voucher.remainingCents },
    reason,
  );

  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const result = tx
      .update(storeCreditVouchers)
      .set({ status: "void", remainingCents: 0, voidReason: reason.trim(), updatedAt: now })
      .where(and(eq(storeCreditVouchers.id, voucherId), eq(storeCreditVouchers.status, "issued")))
      .run();
    if (result.changes !== 1) {
      throw appError("VALIDATION", "Ese vale acaba de cambiar de estado.", "voucherId");
    }
    log({
      entity: "store_credit_voucher",
      entityId: voucherId,
      action: "void",
      before: { status: voucher.status, remainingCents: voucher.remainingCents },
      after: { status: "void", reason: reason.trim() },
    });
  });
}
