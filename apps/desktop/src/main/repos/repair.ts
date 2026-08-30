/**
 * Repair repository (ADR-0014).
 *
 * The rules live in `@arkom/core/repair`; this file finds rows, writes rows, and
 * lets core decide what the facts mean. In particular **nothing here sets a
 * status** — `syncStatus()` recomputes it from the ticket's own facts inside
 * whatever transaction just changed one, the way `product_stock` is rewritten
 * beside the movement that moved it.
 */
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import {
  allocateNumber,
  appError,
  assertPhone,
  isValidImei,
  mutate,
  normalizePhone,
  repairStatus,
  toOplogJson,
  uuidv7,
  type LogFn,
  type MutationCtx,
  type CustomerRow,
  type RepairCreateResponse,
  type RepairFacts,
  type RepairStatus,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { saveRepairPhotos, discardRepairPhotos } from "../photos";
import { getSettings } from "./settings";

const {
  cashMovements,
  customers,
  documents,
  numberSeries,
  repairApprovals,
  repairLines,
  repairPhotos,
  repairTickets,
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
