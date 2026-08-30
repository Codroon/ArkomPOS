/**
 * Repair repository (ADR-0014).
 *
 * The rules live in `@arkom/core/repair`; this file finds rows, writes rows, and
 * lets core decide what the facts mean. In particular **nothing here sets a
 * status** — `syncStatus()` recomputes it from the ticket's own facts inside
 * whatever transaction just changed one, the way `product_stock` is rewritten
 * beside the movement that moved it.
 */
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import {
  allocateNumber,
  appError,
  assertAction,
  assertPhone,
  buildMovement,
  checkAction,
  isOverdue,
  isValidImei,
  isTerminal,
  latestApproval,
  mutate,
  needsPriceOverride,
  normalizePhone,
  quoteTotalCents,
  repairStatus,
  ticketMargin,
  toOplogJson,
  uuidv7,
  workAuthorization,
  type LogFn,
  type MutationCtx,
  type CustomerRow,
  type OrderedPartRow,
  type RepairAddLineRequest,
  type RepairCreateResponse,
  type RepairDetail,
  type RepairFacts,
  type RepairStatus,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { saveRepairPhotos, discardRepairPhotos } from "../photos";
import { postMovement } from "./stock-ledger";
import { getSettings } from "./settings";

const {
  cashMovements,
  customers,
  documents,
  numberSeries,
  products,
  repairApprovals,
  repairLines,
  repairNotifications,
  repairPhotos,
  repairTickets,
  users,
} = schema;

type Reader = ArkomDb | DbTx;

/* ------------------------------------------------------------- customers */

function countRepairs(db: Reader, customerId: string): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(repairTickets)
    .where(eq(repairTickets.customerId, customerId))
    .all()[0]!.n;
}

function toCustomerRow(db: Reader, row: typeof customers.$inferSelect): CustomerRow {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    note: row.note,
    repairCount: countRepairs(db, row.id),
  };
}

/**
 * Find someone by phone or name.
 *
 * The phone is matched on the NORMALIZED form, so a cashier who types
 * "671220918" finds the customer stored as "+34 671 22 09 18". Anything that
 * looks like digits is tried both ways; anything else is a name search.
 */
export function searchCustomers(db: ArkomDb, ctx: MutationCtx, query: string): CustomerRow[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const digits = normalizePhone(trimmed);

  const rows = db
    .select()
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, ctx.tenantId),
        or(
          like(customers.name, `%${trimmed}%`),
          digits.length >= 3 ? like(customers.phoneNormalized, `%${digits}%`) : undefined,
        ),
      ),
    )
    .orderBy(customers.name)
    .limit(8)
    .all();

  return rows.map((row) => toCustomerRow(db, row));
}

/**
 * Find-or-create, deduped on the phone.
 *
 * A shop that ends up with three rows for one number cannot answer "what have we
 * done for this person", which is the only reason to have customers at all. When
 * the number already exists the existing row wins and the name is left alone —
 * silently renaming somebody because a cashier typed a different spelling would
 * be worse than the duplicate.
 */
export function upsertCustomer(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { id?: string; name: string; phone: string; note?: string | null },
): CustomerRow {
  const phoneNormalized = assertPhone(input.phone);

  const existing = db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.phoneNormalized, phoneNormalized)))
    .limit(1)
    .all()[0];

  /* an edit to an existing customer, by id */
  if (input.id) {
    const current = db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, input.id)))
      .limit(1)
      .all()[0];
    if (!current) throw appError("VALIDATION", "Ese cliente no existe.");
    if (existing && existing.id !== input.id) {
      throw appError("DUPLICATE_NAME", "Ya hay otro cliente con ese teléfono.", "phone");
    }
    return mutate(makeMutateRunner(db), ctx, (tx, log) => {
      const now = new Date();
      tx.update(customers)
        .set({ name: input.name, phone: input.phone, phoneNormalized, note: input.note ?? null, updatedAt: now })
        .where(eq(customers.id, input.id!))
        .run();
      const after = tx.select().from(customers).where(eq(customers.id, input.id!)).all()[0]!;
      log({ entity: "customer", entityId: input.id!, action: "update", before: toOplogJson(current), after: toOplogJson(after) });
      return toCustomerRow(tx, after);
    });
  }

  if (existing) return toCustomerRow(db, existing);

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      name: input.name,
      phone: input.phone,
      phoneNormalized,
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(customers).values(row).run();
    log({ entity: "customer", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });
    return toCustomerRow(tx, row);
  });
}

/* ------------------------------------------------------------- the status */

/** Read a ticket's facts. Everything `repairStatus()` needs, and nothing else. */
export function loadFacts(db: Reader, ticketId: string): RepairFacts {
  const ticket = db.select().from(repairTickets).where(eq(repairTickets.id, ticketId)).all()[0];
  if (!ticket) throw appError("VALIDATION", "Esa ficha no existe.");
  return {
    lines: db.select().from(repairLines).where(eq(repairLines.ticketId, ticketId)).all(),
    approvals: db.select().from(repairApprovals).where(eq(repairApprovals.ticketId, ticketId)).all(),
    authorizedCapCents: ticket.authorizedCapCents,
    readyAt: ticket.readyAt,
    collectionDocumentId: ticket.collectionDocumentId,
    notRepairedAt: ticket.notRepairedAt,
    notRepairedReason: ticket.notRepairedReason,
  };
}

/**
 * Recompute the cached status from the facts, in the transaction that changed one.
 *
 * Call this after ANY write that could move a ticket. It is deliberately the only
 * way the column is ever written: there is no `setStatus`, so no code path can
 * assert a status the facts do not support (ADR-0014 §1).
 */
export function syncStatus(tx: DbTx, ticketId: string, log: LogFn): RepairStatus {
  const before = tx.select().from(repairTickets).where(eq(repairTickets.id, ticketId)).all()[0]!;
  const next = repairStatus(loadFacts(tx, ticketId));
  if (next === before.status) return next;

  tx.update(repairTickets)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(repairTickets.id, ticketId))
    .run();
  log({
    entity: "repair_ticket",
    entityId: ticketId,
    action: "status",
    before: { status: before.status },
    after: { status: next },
  });
  return next;
}

/* ------------------------------------------------------------- the R- series */

/**
 * The R- series for this till, created on demand.
 *
 * Same shape as the C- purchase series: a shop that never repairs anything does
 * not carry an empty series, and a till installed before v0.12.0 does not need a
 * data migration to get one.
 */
function repairSeries(tx: DbTx, ctx: MutationCtx) {
  const existing = tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.terminalId, ctx.terminalId), eq(numberSeries.docType, "repair")))
    .all()[0];
  if (existing) return existing;

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    locationId: ctx.locationId,
    terminalId: ctx.terminalId,
    docType: "repair" as const,
    prefix: "R-",
    nextNumber: 1,
  };
  tx.insert(numberSeries).values(row).run();
  return row;
}

/* ---------------------------------------------------------------- intake */

export interface CreateTicketInput {
  customerId: string;
  deviceDescription: string;
  imei?: string | null;
  reportedFault: string;
  conditionAtIntake?: string | null;
  damage: { screen: boolean; back: boolean; dents: boolean; water: boolean };
  damageNote?: string | null;
  accessories?: string | null;
  devicePasscode?: string | null;
  photos: ReadonlyArray<{ kind: "front" | "back" | "extra" | "seller_id"; dataUrl: string }>;
  promisedDate?: number | null;
  promisedHalf?: "morning" | "afternoon" | null;
  depositCents: number;
  authorizedCapCents?: number | null;
  assignedUserId?: string | null;
}

/**
 * Take a device in.
 *
 * One transaction: the numbered R- document, the ticket, its photos, and — when
 * money changed hands — a cash-ledger row. Photos are written to disk BEFORE it
 * opens, under the id about to be inserted, for the reason the purchase path
 * gives: orphaned JPEGs are recoverable, rows pointing at files that were never
 * written are a broken record.
 *
 * **The passcode is stored and never oplogged.** The entry records that one was
 * given, not what it is (ADR-0014 §10).
 */
export async function createTicket(
  db: ArkomDb,
  ctx: MutationCtx,
  input: CreateTicketInput,
): Promise<RepairCreateResponse> {
  const imei = input.imei?.trim() || null;
  // the same rule serialized stock entry uses — but an empty one is fine here,
  // because plenty of devices that need repairing do not have an IMEI at all
  if (imei && !isValidImei(imei)) {
    throw appError("VALIDATION", "El IMEI no es válido.", "imei");
  }

  const customer = db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, input.customerId)))
    .limit(1)
    .all()[0];
  if (!customer) throw appError("VALIDATION", "Ese cliente no existe.", "customerId");

  const settings = getSettings(db, ctx);
  const ticketId = uuidv7();
  const photos = await saveRepairPhotos(ticketId, input.photos);

  try {
    return mutate(makeMutateRunner(db), ctx, (tx, log) => {
      const now = new Date();

      /* the numbered document the customer is handed (ADR-0008) */
      const series = repairSeries(tx, ctx);
      const allocation = allocateNumber({ prefix: series.prefix, nextNumber: series.nextNumber });
      tx.update(numberSeries)
        .set({ nextNumber: allocation.next.nextNumber })
        .where(eq(numberSeries.id, series.id))
        .run();

      const docRow = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        docType: "repair" as const,
        status: "completed" as const,
        seriesId: series.id,
        number: allocation.number,
        docNumber: allocation.docNumber,
        /* a record of custody, not of money — the revenue lives in the T1-
           collection document, if the repair ever gets that far (ADR-0014 §4) */
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
        userId: ctx.userId ?? null,
        createdAt: now,
        completedAt: now,
      };
      tx.insert(documents).values(docRow).run();
      log({ entity: "document", entityId: docRow.id, action: "create", before: null, after: toOplogJson(docRow) });

      const ticketRow = {
        id: ticketId,
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        terminalId: ctx.terminalId,
        documentId: docRow.id,
        customerId: customer.id,
        deviceDescription: input.deviceDescription,
        imei,
        reportedFault: input.reportedFault,
        conditionAtIntake: input.conditionAtIntake ?? null,
        damageScreen: input.damage.screen,
        damageBack: input.damage.back,
        damageDents: input.damage.dents,
        damageWater: input.damage.water,
        damageNote: input.damageNote ?? null,
        accessories: input.accessories ?? null,
        devicePasscode: input.devicePasscode?.trim() || null,
        promisedDate: input.promisedDate ? new Date(input.promisedDate) : null,
        promisedHalf: input.promisedHalf ?? null,
        assignedUserId: input.assignedUserId ?? null,
        depositCents: input.depositCents,
        authorizedCapCents: input.authorizedCapCents ?? null,
        /* snapshots: changing a setting tomorrow must not reach back into a
           ticket taken in today (ADR-0014 §8) */
        diagnosisFeeCents: settings.repairDiagnosisFeeCents,
        warrantyMonths: settings.repairWarrantyMonths,
        readyAt: null,
        notRepairedAt: null,
        notRepairedReason: null,
        collectionDocumentId: null,
        status: "received" as const,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(repairTickets).values(ticketRow).run();
      log({
        entity: "repair_ticket",
        entityId: ticketId,
        action: "create",
        before: null,
        /* everything EXCEPT the passcode. The oplog is readable by anyone who
           can read the file, and this is the one field that must not be in it —
           its presence is recorded, its value never is (ADR-0014 §10). */
        after: {
          ...toOplogJson({ ...ticketRow, devicePasscode: undefined }),
          hasPasscode: Boolean(ticketRow.devicePasscode),
        },
      });

      for (const photo of photos) {
        const photoRow = {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          ticketId,
          kind: photo.kind,
          path: photo.relativePath,
          createdAt: now,
        };
        tx.insert(repairPhotos).values(photoRow).run();
        log({ entity: "repair_photo", entityId: photoRow.id, action: "create", before: null, after: toOplogJson(photoRow) });
      }

      /* money in: cash the shop is holding for the customer, not revenue */
      if (input.depositCents > 0) {
        const cashRow = {
          id: uuidv7(),
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          terminalId: ctx.terminalId,
          amountCents: input.depositCents,
          reason: "repair_deposit" as const,
          documentId: docRow.id,
          ticketId,
          userId: ctx.userId ?? null,
          createdAt: now,
        };
        tx.insert(cashMovements).values(cashRow).run();
        log({ entity: "cash_movement", entityId: cashRow.id, action: "create", before: null, after: toOplogJson(cashRow) });
      }

      // no facts beyond "it exists" yet, so this is Recibido — but it goes
      // through the same function every other transition does
      syncStatus(tx, ticketId, log);

      return {
        ticketId,
        docNumber: allocation.docNumber,
        customerName: customer.name,
        depositCents: input.depositCents,
      };
    });
  } catch (err) {
    // the rows never landed, so the JPEGs on disk belong to nothing
    await discardRepairPhotos(ticketId);
    throw err;
  }
}

/* --------------------------------------------------------------- reading */

/** The ticket rows the intake confirmation and (from slice 4) the list need. */
export function getTicketRow(db: Reader, ctx: MutationCtx, ticketId: string) {
  const row = db
    .select({ ticket: repairTickets, docNumber: documents.docNumber })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .where(and(eq(repairTickets.tenantId, ctx.tenantId), eq(repairTickets.id, ticketId)))
    .limit(1)
    .all()[0];
  if (!row) throw appError("VALIDATION", "Esa ficha no existe.");
  return row;
}

/** Newest first — used by slice 4's list and by the intake screen's "recent". */
export function recentTickets(db: ArkomDb, ctx: MutationCtx, limit = 20) {
  return db
    .select({ ticket: repairTickets, docNumber: documents.docNumber, customerName: customers.name })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .innerJoin(customers, eq(customers.id, repairTickets.customerId))
    .where(eq(repairTickets.tenantId, ctx.tenantId))
    .orderBy(desc(repairTickets.createdAt))
    .limit(limit)
    .all();
}

/* ---------------------------------------------------------------- reading */

/**
 * The whole ticket, as the screen shows it.
 *
 * Every mutation below returns this, so a screen never has to guess what its
 * own write did to the status, the margin or which buttons are now allowed —
 * it re-renders from the answer. The derived fields are computed by the SAME
 * core functions the guards use, so the buttons the UI draws and the actions
 * main will accept cannot disagree.
 *
 * Photos are references, not images: shipping four base64 JPEGs back on every
 * charge edit would be a megabyte of pictures that never change.
 */
export function getDetail(db: Reader, ctx: MutationCtx, ticketId: string, now: Date = new Date()): RepairDetail {
  const row = db
    .select({
      ticket: repairTickets,
      docNumber: documents.docNumber,
      customer: customers,
    })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .innerJoin(customers, eq(customers.id, repairTickets.customerId))
    .where(and(eq(repairTickets.tenantId, ctx.tenantId), eq(repairTickets.id, ticketId)))
    .limit(1)
    .all()[0];
  if (!row) throw appError("VALIDATION", "Esa ficha no existe.");
  const t = row.ticket;

  const lines = db
    .select()
    .from(repairLines)
    .where(eq(repairLines.ticketId, ticketId))
    .orderBy(asc(repairLines.createdAt))
    .all();

  const approvals = db
    .select({ approval: repairApprovals, userName: users.name })
    .from(repairApprovals)
    .leftJoin(users, eq(users.id, repairApprovals.userId))
    .where(eq(repairApprovals.ticketId, ticketId))
    .orderBy(desc(repairApprovals.createdAt))
    .all();

  const notifications = db
    .select({ notification: repairNotifications, userName: users.name })
    .from(repairNotifications)
    .leftJoin(users, eq(users.id, repairNotifications.userId))
    .where(eq(repairNotifications.ticketId, ticketId))
    .orderBy(desc(repairNotifications.createdAt))
    .all();

  const photos = db
    .select({ id: repairPhotos.id, kind: repairPhotos.kind })
    .from(repairPhotos)
    .where(eq(repairPhotos.ticketId, ticketId))
    .orderBy(asc(repairPhotos.createdAt))
    .all();

  const assignee = t.assignedUserId
    ? db.select({ name: users.name }).from(users).where(eq(users.id, t.assignedUserId)).limit(1).all()[0]
    : undefined;

  const collection = t.collectionDocumentId
    ? db
        .select({ docNumber: documents.docNumber })
        .from(documents)
        .where(eq(documents.id, t.collectionDocumentId))
        .limit(1)
        .all()[0]
    : undefined;

  const facts = loadFacts(db, ticketId);
  const status = repairStatus(facts);
  const unresolvedPartCount = lines.filter((l) => l.kind === "inventory_part").length;

  return {
    id: t.id,
    docNumber: row.docNumber ?? "",
    documentId: t.documentId,
    status,

    customer: {
      id: row.customer.id,
      name: row.customer.name,
      phone: row.customer.phone,
      note: row.customer.note,
    },

    device: {
      description: t.deviceDescription,
      imei: t.imei,
      reportedFault: t.reportedFault,
      conditionAtIntake: t.conditionAtIntake,
      damage: {
        screen: t.damageScreen,
        back: t.damageBack,
        dents: t.damageDents,
        water: t.damageWater,
      },
      damageNote: t.damageNote,
      accessories: t.accessories,
    },
    devicePasscode: t.devicePasscode,

    promisedAt: t.promisedDate?.getTime() ?? null,
    promisedHalf: t.promisedHalf,
    assignedUserId: t.assignedUserId,
    assignedUserName: assignee?.name ?? null,

    depositCents: t.depositCents,
    authorizedCapCents: t.authorizedCapCents,
    diagnosisFeeCents: t.diagnosisFeeCents,
    warrantyMonths: t.warrantyMonths,

    readyAt: t.readyAt?.getTime() ?? null,
    notRepairedAt: t.notRepairedAt?.getTime() ?? null,
    notRepairedReason: t.notRepairedReason,
    collectionDocumentId: t.collectionDocumentId,
    collectionDocNumber: collection?.docNumber ?? null,

    createdAt: t.createdAt.getTime(),
    updatedAt: t.updatedAt.getTime(),

    lines: lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      productId: l.productId,
      description: l.description,
      qty: l.qty,
      unitCostCents: l.unitCostCents,
      chargeCents: l.chargeCents,
      supplierText: l.supplierText,
      expectedCostCents: l.expectedCostCents,
      orderedAt: l.orderedAt?.getTime() ?? null,
      receivedAt: l.receivedAt?.getTime() ?? null,
    })),
    approvals: approvals.map((a) => ({
      id: a.approval.id,
      method: a.approval.method,
      approvedTotalCents: a.approval.approvedTotalCents,
      userName: a.userName,
      createdAt: a.approval.createdAt.getTime(),
    })),
    notifications: notifications.map((n) => ({
      id: n.notification.id,
      method: n.notification.method,
      note: n.notification.note,
      userName: n.userName,
      createdAt: n.notification.createdAt.getTime(),
    })),
    photos,

    quoteTotalCents: quoteTotalCents(facts.lines),
    margin: ticketMargin(lines),
    authorization: workAuthorization(facts),
    overdue: isOverdue(t.promisedDate, status, now),
    actions: {
      quote: checkAction(facts, "quote"),
      approve: checkAction(facts, "approve"),
      receive_part: checkAction(facts, "receive_part"),
      mark_ready: checkAction(facts, "mark_ready"),
      collect: checkAction(facts, "collect"),
      // the reason is supplied at the moment of the action; here the question is
      // only whether the parts are resolved, so a placeholder stands in for it
      mark_not_repaired: checkAction(facts, "mark_not_repaired", {
        reason: "unrepairable",
        unresolvedPartCount,
      }),
    },
  };
}

/* ---------------------------------------------------------- quote lines */

/** The ticket row, refusing anything already closed. */
function liveTicket(tx: DbTx, ctx: MutationCtx, ticketId: string) {
  const ticket = tx
    .select()
    .from(repairTickets)
    .where(and(eq(repairTickets.tenantId, ctx.tenantId), eq(repairTickets.id, ticketId)))
    .limit(1)
    .all()[0];
  if (!ticket) throw appError("VALIDATION", "Esa ficha no existe.");
  if (isTerminal(repairStatus(loadFacts(tx, ticketId)))) {
    throw appError("VALIDATION", "Esta ficha ya está cerrada.");
  }
  return ticket;
}

/**
 * Take a part off the shelf for this repair.
 *
 * ONE movement, posted immediately (ADR-0014 §3): the screen is now on the
 * customer's bench, so the shop's on-hand has to say so the moment it leaves.
 * The alternative — deducting at hand-back — means the stock figure is wrong for
 * every day the phone sits in the workshop, which is the figure someone reorders
 * from.
 */
function consumePart(
  tx: DbTx,
  ctx: MutationCtx,
  log: LogFn,
  args: { productId: string; qty: number; documentId: string; now: Date; reason?: string },
): void {
  postMovement(
    tx,
    ctx,
    log,
    buildMovement({
      productId: args.productId,
      locationId: ctx.locationId,
      movementType: "repair_part_out",
      qty: -args.qty,
      reason: args.reason ?? null,
    }),
    args.now,
    args.documentId,
  );
}

/** A quantity article that may be fitted to a repair, or a typed refusal. */
function sellablePart(tx: DbTx, ctx: MutationCtx, productId: string) {
  const product = tx
    .select()
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, productId)))
    .limit(1)
    .all()[0];
  if (!product) throw appError("VALIDATION", "Ese artículo no existe.", "productId");
  if (!product.active) throw appError("VALIDATION", "Ese artículo está inactivo.", "productId");
  /* A serialized article is a phone with an IMEI, not a screen or a battery.
     Fitting one to a repair would need a unit chosen and its identity carried
     onto the ticket, and no shop does that with the part — they sell the phone
     instead (ADR-0014 §3). */
  if (product.itemType === "serialized") {
    throw appError("VALIDATION", "Los artículos serializados no se montan como pieza.", "productId");
  }
  return product;
}

/**
 * Add one line to the quote.
 *
 * Three kinds, and the difference between them is entirely about stock: a part
 * from the shelf leaves it now, a part on order has not been bought yet and
 * touches nothing, and labor is not a thing at all.
 */
export function addLine(
  db: ArkomDb,
  ctx: MutationCtx,
  input: RepairAddLineRequest,
): RepairDetail {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const ticket = liveTicket(tx, ctx, input.ticketId);
    const now = new Date();

    let row: typeof repairLines.$inferInsert;

    if (input.kind === "labor") {
      row = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        kind: "labor",
        productId: null,
        description: input.description,
        qty: 1,
        // labor costs the shop nothing it can put a number on: the technician's
        // hour is not stock, and pretending it is would corrupt every margin
        unitCostCents: null,
        chargeCents: input.chargeCents,
        supplierText: null,
        expectedCostCents: null,
        orderedAt: null,
        receivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    } else if (input.kind === "inventory_part") {
      const product = sellablePart(tx, ctx, input.productId);
      row = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        kind: "inventory_part",
        productId: product.id,
        description: product.name,
        qty: input.qty,
        /* snapshotted now, per unit. The product's cost will move the next time
           a delivery lands, and this ticket's margin must not move with it. */
        unitCostCents: product.costCents ?? 0,
        chargeCents: input.chargeCents ?? (product.priceCents ?? 0) * input.qty,
        supplierText: null,
        expectedCostCents: null,
        orderedAt: null,
        receivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    } else {
      row = {
        id: uuidv7(),
        tenantId: ctx.tenantId,
        ticketId: ticket.id,
        kind: "part_on_order",
        productId: null,
        description: input.description,
        qty: input.qty,
        // it has not been bought yet, so it has no cost — expectedCostCents is a
        // guess and is kept apart from the snapshot for exactly that reason
        unitCostCents: null,
        chargeCents: input.chargeCents,
        supplierText: input.supplierText ?? null,
        expectedCostCents: input.expectedCostCents ?? null,
        orderedAt: now,
        receivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    tx.insert(repairLines).values(row).run();
    log({ entity: "repair_line", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });

    if (row.kind === "inventory_part") {
      consumePart(tx, ctx, log, {
        productId: row.productId!,
        qty: row.qty!,
        documentId: ticket.documentId,
        now,
      });
    }

    syncStatus(tx, ticket.id, log);
    return getDetail(tx, ctx, ticket.id);
  });
}

/**
 * Take a line off the quote.
 *
 * A consumed part goes back on the shelf as a SECOND movement, never by deleting
 * the first (ADR-0004). The pair sits under the same repair document, so the
 * movements drawer tells the whole story: it went out on Tuesday and came back
 * on Wednesday, and here is the ticket that did both.
 */
export function removeLine(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  lineId: string,
): RepairDetail {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const ticket = liveTicket(tx, ctx, ticketId);
    const line = tx
      .select()
      .from(repairLines)
      .where(and(eq(repairLines.ticketId, ticketId), eq(repairLines.id, lineId)))
      .limit(1)
      .all()[0];
    if (!line) throw appError("VALIDATION", "Esa línea no existe.");

    const now = new Date();
    tx.delete(repairLines).where(eq(repairLines.id, lineId)).run();
    log({ entity: "repair_line", entityId: lineId, action: "delete", before: toOplogJson(line), after: null });

    if (line.kind === "inventory_part" && line.productId) {
      postMovement(
        tx,
        ctx,
        log,
        buildMovement({
          productId: line.productId,
          locationId: ctx.locationId,
          movementType: "repair_part_out",
          qty: line.qty,
          reason: "línea de reparación retirada",
        }),
        now,
        ticket.documentId,
      );
    }

    syncStatus(tx, ticketId, log);
    return getDetail(tx, ctx, ticketId);
  });
}

/**
 * Move what a line charges.
 *
 * The cost snapshot never moves — only what the customer pays. Raising it is
 * safe and needs nothing: the total climbs past what was approved, the status
 * falls back to Presupuestado by itself, and nothing can be collected until they
 * approve again.
 *
 * Lowering it after an approval is the direction that needs a control, and it
 * gets the one the sale screen already uses: a reason, and a permission a
 * cashier does not hold by default (ADR-0014 §9a). The permission is checked in
 * the handler; the reason is checked here, because a repo that accepts a silent
 * reduction is a repo the next caller can reach around.
 */
export function setLineCharge(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { ticketId: string; lineId: string; chargeCents: number; reason?: string | null },
): RepairDetail {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const ticket = liveTicket(tx, ctx, input.ticketId);
    const line = tx
      .select()
      .from(repairLines)
      .where(and(eq(repairLines.ticketId, input.ticketId), eq(repairLines.id, input.lineId)))
      .limit(1)
      .all()[0];
    if (!line) throw appError("VALIDATION", "Esa línea no existe.");

    const facts = loadFacts(tx, input.ticketId);
    const change = { lineId: line.id, fromCents: line.chargeCents, toCents: input.chargeCents };
    const reason = input.reason?.trim() || null;
    if (needsPriceOverride(facts, change) && !reason) {
      throw appError("VALIDATION", "Indica el motivo de la rebaja.", "reason");
    }

    const now = new Date();
    tx.update(repairLines)
      .set({ chargeCents: input.chargeCents, updatedAt: now })
      .where(eq(repairLines.id, line.id))
      .run();
    const after = tx.select().from(repairLines).where(eq(repairLines.id, line.id)).all()[0]!;
    log({
      entity: "repair_line",
      entityId: line.id,
      action: "update",
      before: toOplogJson(line),
      // the reason rides ON the entry, so "who cut this and why" is one lookup
      after: reason ? { ...toOplogJson(after), reason } : toOplogJson(after),
    });

    syncStatus(tx, ticket.id, log);
    return getDetail(tx, ctx, ticket.id);
  });
}

/* ------------------------------------------------------------- approval */

/**
 * The customer said yes — to a number.
 *
 * A row, not a flag (ADR-0014 §2). The amount is captured from the quote as it
 * stands at this instant, so a later addition does not retroactively become
 * something they agreed to; the status falls back to Presupuestado and asks
 * again, and BOTH approvals stay on the record, because "they approved 79 € on
 * Monday and 145 € on Wednesday" is the sentence that settles a dispute.
 */
export function recordApproval(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  method: "in_person" | "by_phone",
): RepairDetail {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const ticket = liveTicket(tx, ctx, ticketId);
    const facts = loadFacts(tx, ticketId);
    assertAction(facts, "approve");

    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      ticketId: ticket.id,
      method,
      approvedTotalCents: quoteTotalCents(facts.lines),
      userId: ctx.userId ?? null,
      createdAt: now,
    };
    tx.insert(repairApprovals).values(row).run();
    log({ entity: "repair_approval", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });

    syncStatus(tx, ticket.id, log);
    return getDetail(tx, ctx, ticket.id);
  });
}

/* ---------------------------------------------------------- parts on order */

/**
 * The ordered part arrived.
 *
 * Net effect: one stock-in at what it really cost, and one consumption — because
 * the part goes straight onto the customer's bench, not onto the shelf. Both are
 * posted, rather than netting to nothing, so the delivery is visible in the
 * movements drawer and the shop's cost figure for that article updates from a
 * real invoice.
 *
 * The line becomes an inventory part: from here it behaves like any other fitted
 * part, including its reversal if the line is later removed.
 */
export function receivePart(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { ticketId: string; lineId: string; unitCostCents: number; qty: number; productId?: string | null },
): RepairDetail {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const ticket = liveTicket(tx, ctx, input.ticketId);
    const line = tx
      .select()
      .from(repairLines)
      .where(and(eq(repairLines.ticketId, input.ticketId), eq(repairLines.id, input.lineId)))
      .limit(1)
      .all()[0];
    if (!line) throw appError("VALIDATION", "Esa línea no existe.");
    if (line.kind !== "part_on_order") throw appError("VALIDATION", "Esa línea no es una pieza pedida.");
    if (line.receivedAt) throw appError("VALIDATION", "Esa pieza ya se recibió.");

    /* which article this is. The ordered line may have named one; if it did not,
       the receiver picks one now — a part with no catalogue article cannot be
       stocked in, and inventing a product from free text would fill the
       catalogue with one-off rows nobody maintains */
    const productId = input.productId ?? line.productId;
    if (!productId) {
      throw appError("VALIDATION", "Elige el artículo del catálogo para dar entrada.", "productId");
    }
    const product = sellablePart(tx, ctx, productId);

    const now = new Date();

    /* 1. the delivery: real cost, so the article's cost figure comes from an
          invoice rather than from what someone guessed when they ordered it */
    postMovement(
      tx,
      ctx,
      log,
      buildMovement({
        productId: product.id,
        locationId: ctx.locationId,
        movementType: "purchase_in",
        qty: input.qty,
        unitCostCents: input.unitCostCents,
      }),
      now,
      ticket.documentId,
    );

    /* 2. and straight back out onto the bench */
    consumePart(tx, ctx, log, {
      productId: product.id,
      qty: input.qty,
      documentId: ticket.documentId,
      now,
    });

    tx.update(repairLines)
      .set({
        kind: "inventory_part",
        productId: product.id,
        qty: input.qty,
        unitCostCents: input.unitCostCents,
        receivedAt: now,
        updatedAt: now,
      })
      .where(eq(repairLines.id, line.id))
      .run();
    const after = tx.select().from(repairLines).where(eq(repairLines.id, line.id)).all()[0]!;
    log({ entity: "repair_line", entityId: line.id, action: "update", before: toOplogJson(line), after: toOplogJson(after) });

    // the last open ordered part clearing is what moves the ticket off Esperando
    // pieza — derived, never toggled
    syncStatus(tx, ticket.id, log);
    return getDetail(tx, ctx, ticket.id);
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything the shop is waiting on, oldest first.
 *
 * One list across every ticket, because the question it answers is a buying
 * question — "what do I need to order this morning" — and answering it by
 * opening thirty tickets is how a customer ends up waiting a week for a screen
 * nobody remembered to buy.
 */
export function partsToOrder(db: ArkomDb, ctx: MutationCtx, now: Date = new Date()): OrderedPartRow[] {
  const rows = db
    .select({
      line: repairLines,
      ticket: repairTickets,
      docNumber: documents.docNumber,
      customerName: customers.name,
    })
    .from(repairLines)
    .innerJoin(repairTickets, eq(repairTickets.id, repairLines.ticketId))
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .innerJoin(customers, eq(customers.id, repairTickets.customerId))
    .where(
      and(
        eq(repairLines.tenantId, ctx.tenantId),
        eq(repairLines.kind, "part_on_order"),
        isNull(repairLines.receivedAt),
        // a closed ticket is not waiting for anything
        isNull(repairTickets.notRepairedAt),
        isNull(repairTickets.collectionDocumentId),
      ),
    )
    .orderBy(asc(repairLines.orderedAt))
    .all();

  return rows.map((r) => ({
    lineId: r.line.id,
    ticketId: r.ticket.id,
    docNumber: r.docNumber ?? "",
    customerName: r.customerName,
    deviceDescription: r.ticket.deviceDescription,
    description: r.line.description,
    qty: r.line.qty,
    supplierText: r.line.supplierText,
    expectedCostCents: r.line.expectedCostCents,
    orderedAt: r.line.orderedAt?.getTime() ?? null,
    promisedAt: r.ticket.promisedDate?.getTime() ?? null,
    daysWaiting: r.line.orderedAt
      ? Math.max(0, Math.floor((now.getTime() - r.line.orderedAt.getTime()) / DAY_MS))
      : 0,
  }));
}

/**
 * Would this charge edit be a reduction the customer never agreed to?
 *
 * Read-only, and used by the IPC layer to pick which permission the channel
 * demands before the handler runs. It reads the ticket's own facts rather than
 * trusting the payload — a renderer that sent a flattering "from" amount would
 * otherwise choose its own gate.
 */
export function lineChargeNeedsOverride(
  db: ArkomDb,
  input: { ticketId: string; lineId: string; chargeCents: number },
): boolean {
  const line = db
    .select({ chargeCents: repairLines.chargeCents })
    .from(repairLines)
    .where(and(eq(repairLines.ticketId, input.ticketId), eq(repairLines.id, input.lineId)))
    .limit(1)
    .all()[0];
  // a line that does not exist is not an override; the handler will refuse it
  // for the honest reason a moment later
  if (!line) return false;

  const approvals = db
    .select({ approvedTotalCents: repairApprovals.approvedTotalCents, createdAt: repairApprovals.createdAt })
    .from(repairApprovals)
    .where(eq(repairApprovals.ticketId, input.ticketId))
    .all();

  return needsPriceOverride(
    { lines: [], approvals, authorizedCapCents: null, readyAt: null, collectionDocumentId: null, notRepairedAt: null, notRepairedReason: null },
    { lineId: input.lineId, fromCents: line.chargeCents, toCents: input.chargeCents },
  );
}
