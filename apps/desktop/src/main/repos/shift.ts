/**
 * The drawer, in the database — ADR-0015.
 *
 * This file loads the rows and hands them to `computeShiftTotals()` in core. It
 * does no arithmetic of its own on purpose: the X preview, the close and
 * `db:audit` must produce identical figures, and the only reliable way to
 * guarantee that is for them to call the same function.
 *
 * **Sale cash is never written here.** Takings live on `document_tenders` and are
 * READ; `cash_movements` holds what has no other home (ADR-0015 §3).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ArkomDb } from "@arkom/db";
import * as schema from "@arkom/db/schema";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { transferFactsForShift } from "./transfer";
import {
  allocateNumber,
  appError,
  assertBreakdownMatches,
  computeShiftTotals,
  mutate,
  movesDrawer,
  toOplogJson,
  needsVarianceApproval,
  varianceCents,
  shiftStatus,
  uuidv7,
  type MutationCtx,
  type ShiftDepositFact,
  type ShiftFacts,
  type ShiftPayoutFact,
  type ShiftTotals,
} from "@arkom/core";

const {
  cashMovements,
  documents,
  documentLines,
  documentTenders,
  numberSeries,
  repairTickets,
  shifts,
  usedPurchases,
} = schema;

type Reader = Pick<ArkomDb, "select">;
export type ShiftRow = typeof shifts.$inferSelect;

/* --------------------------------------------------------- reading */

/**
 * The open shift on THIS till, or null.
 *
 * `closed_at IS NULL` is the whole query — there is no status column to consult
 * and none to disagree with (ADR-0015 §1).
 */
export function openShift(db: Reader, ctx: MutationCtx): ShiftRow | null {
  return (
    db
      .select()
      .from(shifts)
      .where(and(eq(shifts.terminalId, ctx.terminalId), isNull(shifts.closedAt)))
      .limit(1)
      .all()[0] ?? null
  );
}

/**
 * The gate every money-moving path passes through.
 *
 * Raised as its own code rather than a VALIDATION so the Sale screen can tell
 * this apart from a real refusal and offer to fix it in place.
 */
export function requireOpenShift(db: Reader, ctx: MutationCtx): ShiftRow {
  const shift = openShift(db, ctx);
  if (!shift) {
    throw appError("SHIFT_REQUIRED", "No hay ningún turno abierto en esta caja.");
  }
  return shift;
}

/** The shift a new row belongs to, or null when the till is working shift-less. */
export function currentShiftId(db: Reader, ctx: MutationCtx): string | null {
  return openShift(db, ctx)?.id ?? null;
}

/* ---------------------------------------------------------- series */

/** The till's `Z1-` series, created on demand — the ADR-0008 pattern (ADR-0015 §2). */
export function shiftSeries(tx: DbTx, ctx: MutationCtx) {
  const existing = tx
    .select()
    .from(numberSeries)
    .where(and(eq(numberSeries.terminalId, ctx.terminalId), eq(numberSeries.docType, "shift")))
    .all()[0];
  if (existing) return existing;

  const row = {
    id: uuidv7(),
    tenantId: ctx.tenantId,
    locationId: ctx.locationId,
    terminalId: ctx.terminalId,
    docType: "shift" as const,
    prefix: "Z1-",
    nextNumber: 1,
  };
  tx.insert(numberSeries).values(row).run();
  return row;
}

/* ----------------------------------------------------------- facts */

/**
 * Everything a shift's totals are computed from, in one place.
 *
 * Deposits and payouts are read from **their own records** rather than from the
 * cash ledger: only a cash deposit or payout writes a movement, so a Z built
 * from movements alone would report a card deposit as never having happened.
 * The ledger answers "what is in the drawer"; the tickets and purchases answer
 * "what did we take, and how".
 */
export function loadShiftFacts(db: Reader, shift: ShiftRow): ShiftFacts {
  const docRows = db
    .select({
      id: documents.id,
      docType: documents.docType,
      docNumber: documents.docNumber,
      number: documents.number,
      subtotalCents: documents.subtotalCents,
      taxCents: documents.taxCents,
      totalCents: documents.totalCents,
    })
    .from(documents)
    .where(and(eq(documents.shiftId, shift.id), eq(documents.status, "completed")))
    .all();

  const ids = docRows.map((d) => d.id);
  const tenderRows = ids.length
    ? db.select().from(documentTenders).where(inArray(documentTenders.documentId, ids)).all()
    : [];
  const lineRows = ids.length
    ? db
        .select({
          documentId: documentLines.documentId,
          taxRegime: documentLines.taxRegime,
          baseCents: documentLines.baseCents,
          taxCents: documentLines.taxCents,
          totalCents: documentLines.totalCents,
        })
        .from(documentLines)
        .where(inArray(documentLines.documentId, ids))
        .all()
    : [];

  const tendersBy = new Map<string, { method: string; amountCents: number }[]>();
  for (const row of tenderRows) {
    const list = tendersBy.get(row.documentId) ?? [];
    list.push({ method: row.method, amountCents: row.amountCents });
    tendersBy.set(row.documentId, list);
  }
  const linesBy = new Map<string, { taxRegime: string; baseCents: number; taxCents: number; totalCents: number }[]>();
  for (const row of lineRows) {
    const list = linesBy.get(row.documentId) ?? [];
    list.push({ taxRegime: row.taxRegime, baseCents: row.baseCents, taxCents: row.taxCents, totalCents: row.totalCents });
    linesBy.set(row.documentId, list);
  }

  const movements = db
    .select({ reason: cashMovements.reason, amountCents: cashMovements.amountCents })
    .from(cashMovements)
    .where(eq(cashMovements.shiftId, shift.id))
    .all();

  /* deposits TAKEN ride on the intake document's shift; deposits GIVEN BACK
     carry their own shift, stamped when the refund happened, because a refund
     usually lands in a different shift from the intake */
  const takenRows = db
    .select({ amountCents: repairTickets.depositCents, method: repairTickets.depositMethod })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .where(and(eq(documents.shiftId, shift.id), sql`${repairTickets.depositCents} > 0`))
    .all();
  const refundedRows = db
    .select({ amountCents: repairTickets.depositRefundedCents, method: repairTickets.depositRefundMethod })
    .from(repairTickets)
    .where(and(eq(repairTickets.depositRefundShiftId, shift.id), sql`${repairTickets.depositRefundedCents} > 0`))
    .all();

  const deposits: ShiftDepositFact[] = [
    ...takenRows.map((r) => ({ kind: "taken" as const, method: r.method, amountCents: r.amountCents })),
    ...refundedRows.map((r) => ({ kind: "refunded" as const, method: r.method ?? "cash", amountCents: r.amountCents })),
  ];

  const payouts: ShiftPayoutFact[] = db
    .select({ method: usedPurchases.payoutMethod, amountCents: usedPurchases.buyPriceCents })
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .where(eq(documents.shiftId, shift.id))
    .all();

  const parked = db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.terminalId, shift.terminalId), eq(documents.status, "parked")))
    .all();

  const repairsCollected = db
    .select({ id: repairTickets.id })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.collectionDocumentId))
    .where(eq(documents.shiftId, shift.id))
    .all();

  return {
    openingFloatCents: shift.openingFloatCents,
    documents: docRows.map((d) => ({
      documentId: d.id,
      docType: d.docType,
      docNumber: d.docNumber,
      number: d.number,
      subtotalCents: d.subtotalCents,
      taxCents: d.taxCents,
      totalCents: d.totalCents,
      tenders: tendersBy.get(d.id) ?? [],
      lines: linesBy.get(d.id) ?? [],
    })),
    movements,
    deposits,
    payouts,
    parkedCount: parked.length,
    repairsCollectedCount: repairsCollected.length,
    /* the WU counter: rows logged in this shift, plus any cancelled in it
       whatever shift they were logged in (ADR-0018) */
    transfers: transferFactsForShift(db, shift.id),
  };
}

/** The X: exactly what a close right now would freeze (ADR-0015 §12). */
export function shiftTotals(db: Reader, shift: ShiftRow): ShiftTotals {
  return computeShiftTotals(loadShiftFacts(db, shift));
}

/* ------------------------------------------------------------ list */

export function shiftById(db: Reader, id: string): ShiftRow | null {
  return db.select().from(shifts).where(eq(shifts.id, id)).limit(1).all()[0] ?? null;
}

export function closedShifts(db: Reader, ctx: MutationCtx, limit = 50): ShiftRow[] {
  return db
    .select()
    .from(shifts)
    .where(eq(shifts.terminalId, ctx.terminalId))
    .orderBy(desc(shifts.openedAt))
    .limit(limit)
    .all();
}

export { shiftStatus, asc };

/* ------------------------------------------------------------ writing */

/** Names for the state payload — a shift is read far more often than written. */
function userName(db: Reader, id: string | null): string | null {
  if (!id) return null;
  return db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, id)).all()[0]?.name ?? null;
}

const HOUR_MS = 60 * 60 * 1000;

export function toShiftState(db: Reader, row: ShiftRow, now = Date.now()) {
  return {
    id: row.id,
    zDocNumber: row.zDocNumber,
    openedAtMs: row.openedAt.getTime(),
    openedByName: userName(db, row.openedByUserId),
    openingFloatCents: row.openingFloatCents,
    openingBreakdown: (row.openingBreakdown as Record<string, number> | null) ?? null,
    closedAtMs: row.closedAt?.getTime() ?? null,
    closedByName: userName(db, row.closedByUserId),
    countedCashCents: row.countedCashCents,
    expectedCashCents: row.expectedCashCents,
    varianceCents: row.varianceCents,
    varianceReason: row.varianceReason,
    approvedByName: userName(db, row.approvedByUserId),
    openHours: ((row.closedAt?.getTime() ?? now) - row.openedAt.getTime()) / HOUR_MS,
  };
}

/**
 * Open the drawer for the day.
 *
 * The refusal for a second open is raised here so the cashier gets a sentence
 * rather than a constraint violation — but the index underneath is what actually
 * guarantees it, and it is the one that survives a race (ADR-0015 §1).
 */
export function openShiftTx(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { floatCents: number; breakdown: Record<string, number> | null },
) {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    if (openShift(tx, ctx)) {
      throw appError("VALIDATION", "Ya hay un turno abierto en esta caja.");
    }
    assertBreakdownMatches(input.floatCents, input.breakdown);

    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      openedByUserId: ctx.userId ?? null,
      openedAt: now,
      openingFloatCents: input.floatCents,
      openingBreakdown: input.breakdown,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(shifts).values(row).run();
    log({ entity: "shift", entityId: row.id, action: "open", before: null, after: toOplogJson(row) });
    return toShiftState(tx, tx.select().from(shifts).where(eq(shifts.id, row.id)).all()[0]!);
  });
}

/* -------------------------------------------------------- movements */

/** Everything the panel shows for one row, including where to click through to. */
export function movementRows(db: Reader, shiftId: string) {
  const rows = db
    .select({
      m: cashMovements,
      docNumber: documents.docNumber,
      userName: schema.users.name,
    })
    .from(cashMovements)
    .leftJoin(documents, eq(documents.id, cashMovements.documentId))
    .leftJoin(schema.users, eq(schema.users.id, cashMovements.userId))
    .where(eq(cashMovements.shiftId, shiftId))
    .orderBy(asc(cashMovements.createdAt))
    .all();

  return rows.map(({ m, docNumber, userName }) => ({
    id: m.id,
    atMs: m.createdAt.getTime(),
    reason: m.reason,
    /* false for repair_deposit_applied. The row is shown rather than hidden —
       a list that silently omits rows teaches people not to trust it — and
       muted, because it is the one row here that does not move the drawer. */
    movesCash: movesDrawer(m.reason),
    amountCents: m.amountCents,
    concept: m.concept,
    userName,
    documentId: m.documentId,
    docNumber,
    ticketId: m.ticketId,
    label: m.concept ?? docNumber ?? "",
  }));
}

export function movementTotals(rows: ReadonlyArray<{ amountCents: number; movesCash: boolean }>) {
  let inCents = 0;
  let outCents = 0;
  for (const row of rows) {
    if (!row.movesCash) continue; // a bookkeeping row is not money in or out
    if (row.amountCents >= 0) inCents += row.amountCents;
    else outCents += -row.amountCents;
  }
  return { inCents, outCents, netCents: inCents - outCents };
}

/**
 * Money in or out of the drawer, typed by a human, with a reason in their words.
 *
 * The amount always arrives positive and the DIRECTION comes from the channel:
 * a cashier typing `-200` into a field labelled *Salida* is a bug waiting to
 * happen, and a sign the payload controls is a sign the payload can get wrong.
 */
export function postManualMovement(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { amountCents: number; concept: string; direction: "in" | "out" },
) {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const shift = requireOpenShift(tx, ctx);
    const concept = input.concept.trim();
    if (!concept) throw appError("VALIDATION", "Indica el concepto.", "concept");
    if (input.amountCents <= 0) throw appError("VALIDATION", "Importe no válido.", "amountCents");

    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      amountCents: input.direction === "in" ? input.amountCents : -input.amountCents,
      reason: input.direction === "in" ? ("paid_in" as const) : ("paid_out" as const),
      documentId: null,
      ticketId: null,
      concept,
      shiftId: shift.id,
      userId: ctx.userId ?? null,
      createdAt: now,
    };
    tx.insert(cashMovements).values(row).run();
    log({ entity: "cash_movement", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });

    const rows = movementRows(tx, shift.id);
    return { rows, ...movementTotals(rows) };
  });
}

/* ----------------------------------------------------------- closing */

/**
 * Close the drawer, and freeze what it said.
 *
 * One transaction: the snapshot, the Z number, the stamp and the oplog. Any
 * failure and nothing happened — a shift half-closed, numbered but not stamped,
 * would be the one state nothing else in this file knows how to read.
 *
 * The reason is required for ANY non-zero variance, not merely a large one: a
 * shop that writes "cuadra" for every 40-cent difference is a shop where the
 * field means nothing, and 40 cents every day is a pattern worth a sentence.
 */
export function closeShiftTx(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { countedCents: number; breakdown: Record<string, number> | null; reason: string | null },
) {
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const shift = requireOpenShift(tx, ctx);
    assertBreakdownMatches(input.countedCents, input.breakdown);

    const totals = computeShiftTotals(loadShiftFacts(tx, shift));
    const variance = varianceCents(input.countedCents, totals.expectedCashCents);
    const reason = input.reason?.trim() || null;
    if (variance !== 0 && !reason) {
      throw appError("VALIDATION", "Indica el motivo del descuadre.", "reason");
    }

    const series = shiftSeries(tx, ctx);
    const allocation = allocateNumber({ prefix: series.prefix, nextNumber: series.nextNumber });
    tx.update(numberSeries).set({ nextNumber: allocation.next.nextNumber }).where(eq(numberSeries.id, series.id)).run();

    const now = new Date();
    const before = { ...shift };
    /* The Z as a document, frozen. A reprint renders THIS; the recomputation
       lives in db:audit, where a divergence is reported rather than silently
       applied (ADR-0015 §7). */
    const snapshot = {
      snapshotVersion: 1 as const,
      zDocNumber: allocation.docNumber,
      terminalId: shift.terminalId,
      openedAtMs: shift.openedAt.getTime(),
      openedByUserId: shift.openedByUserId,
      closedAtMs: now.getTime(),
      closedByUserId: ctx.userId ?? null,
      approvedByUserId: ctx.authorizedByUserId ?? null,
      countedCashCents: input.countedCents,
      varianceCents: variance,
      varianceReason: reason,
      closingBreakdown: input.breakdown,
      totals,
    };

    tx.update(shifts)
      .set({
        closedAt: now,
        closedByUserId: ctx.userId ?? null,
        countedCashCents: input.countedCents,
        closingBreakdown: input.breakdown,
        expectedCashCents: totals.expectedCashCents,
        varianceCents: variance,
        varianceReason: reason,
        approvedByUserId: ctx.authorizedByUserId ?? null,
        zSeriesId: series.id,
        zNumber: allocation.number,
        zDocNumber: allocation.docNumber,
        snapshot,
        updatedAt: now,
      })
      .where(eq(shifts.id, shift.id))
      .run();

    const after = tx.select().from(shifts).where(eq(shifts.id, shift.id)).all()[0]!;
    log({ entity: "shift", entityId: shift.id, action: "close", before: toOplogJson(before), after: toOplogJson(after) });

    return {
      shiftId: shift.id,
      zDocNumber: allocation.docNumber,
      countedCents: input.countedCents,
      expectedCents: totals.expectedCashCents,
      varianceCents: variance,
    };
  });
}

/**
 * Would this close need an owner's PIN?
 *
 * Read-only, used by the IPC layer to pick the permission before the handler
 * runs. The expected figure comes from the DATABASE; only the counted figure
 * comes from the payload, because nothing else could supply it. That is not a
 * hole: a false count does not dodge the approval, it records a lie under the
 * sender's name, and a LOWER count makes the variance larger, not smaller.
 */
export function closeNeedsApproval(db: ArkomDb, ctx: MutationCtx, countedCents: number, toleranceCents: number): boolean {
  const shift = openShift(db, ctx);
  if (!shift) return false; // no shift: the handler refuses it a moment later, honestly
  const totals = computeShiftTotals(loadShiftFacts(db, shift));
  return needsVarianceApproval(varianceCents(countedCents, totals.expectedCashCents), toleranceCents);
}

/* ------------------------------------------------------- reading back */

export function shiftListRows(db: Reader, ctx: MutationCtx, limit: number) {
  return closedShifts(db, ctx, limit).map((row) => ({
    id: row.id,
    zDocNumber: row.zDocNumber,
    openedAtMs: row.openedAt.getTime(),
    closedAtMs: row.closedAt?.getTime() ?? null,
    openedByName: userName(db, row.openedByUserId),
    closedByName: userName(db, row.closedByUserId),
    expectedCashCents: row.expectedCashCents,
    countedCashCents: row.countedCashCents,
    varianceCents: row.varianceCents,
    approvedByName: userName(db, row.approvedByUserId),
  }));
}

/** The stored snapshot's totals, or a live computation while the shift is open. */
export function totalsFor(db: Reader, shift: ShiftRow): ShiftTotals | null {
  const snapshot = shift.snapshot as { totals?: ShiftTotals } | null;
  if (snapshot?.totals) return snapshot.totals; // frozen: never recomputed
  return shift.closedAt === null ? computeShiftTotals(loadShiftFacts(db, shift)) : null;
}

/**
 * Record that somebody looked.
 *
 * An oplog entry with no business row, the shape auth events already use. "An X
 * was taken at 19:40 and said 742,60" is exactly the fact that matters later
 * when the count comes up short (ADR-0015 §12).
 */
export function logShiftPreview(db: ArkomDb, ctx: MutationCtx, shiftId: string, expectedCashCents: number): void {
  mutate(makeMutateRunner(db), ctx, (_tx, log) => {
    log({ entity: "shift", entityId: shiftId, action: "preview", before: null, after: { expectedCashCents } });
  });
}
