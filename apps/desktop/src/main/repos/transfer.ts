/**
 * The WU counter — ADR-0018.
 *
 * A shadow log, not a system of record: WU's own terminal did the transfer and
 * this table exists so the drawer, the Z and next round's reconciliation import
 * have something to agree with.
 *
 * **The principal is pass-through.** No document is issued, no VAT is computed,
 * and nothing here reaches a sales figure. What it touches is `cash_movements`,
 * because the notes are real — through the same ledger and the same
 * `DRAWER_EFFECT` map every other non-sale cash event uses (ADR-0015 §3), so
 * expected cash needs no special case to stay right.
 */
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, type SQL } from "drizzle-orm";
import {
  appError,
  mutate,
  normalizeMtcn,
  toOplogJson,
  transferCancelDelta,
  transferDrawerDelta,
  uuidv7,
  type MutationCtx,
  type TransferFact,
  type TransferListRequest,
  type TransferRow,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner, type DbTx } from "../mutate-runner";
import { requireOpenShift, shiftTotals } from "./shift";

const { cashMovements, shifts, transfers, users } = schema;

type Row = typeof transfers.$inferSelect;

/* ------------------------------------------------------------------ read */

function toRow(r: Row, userName: string | null, cancelledByName: string | null): TransferRow {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    mtcn: r.mtcn,
    senderName: r.senderName,
    receiverName: r.receiverName,
    countryCode: r.countryCode,
    principalCents: r.principalCents,
    feeCents: r.feeCents,
    method: r.method,
    drawerCents: transferDrawerDelta(r),
    shiftId: r.shiftId,
    userName,
    createdAtMs: r.createdAt.getTime(),
    cancelledAtMs: r.cancelledAt?.getTime() ?? null,
    cancelledByName,
    cancelReason: r.cancelReason,
    verification: r.verification,
    verifiedByName: null,
    verifiedAtMs: r.verifiedAt?.getTime() ?? null,
    flagNote: r.flagNote,
  };
}

function withNames(db: ArkomDb | DbTx, rows: Row[]): TransferRow[] {
  const names = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    ...toRow(r, r.userId ? (names.get(r.userId) ?? null) : null, r.cancelledByUserId ? (names.get(r.cancelledByUserId) ?? null) : null),
    verifiedByName: r.verifiedByUserId ? (names.get(r.verifiedByUserId) ?? null) : null,
  }));
}

export function getTransfer(db: ArkomDb, ctx: MutationCtx, id: string): TransferRow {
  const row = db
    .select()
    .from(transfers)
    .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, id)))
    .all()[0];
  if (!row) throw appError("VALIDATION", "Ese giro no existe.");
  return withNames(db, [row])[0]!;
}

/** The record an operator is shown when the MTCN they typed is already logged. */
function findByMtcn(db: ArkomDb | DbTx, ctx: MutationCtx, mtcn: string): Row | undefined {
  return db
    .select()
    .from(transfers)
    .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.mtcn, mtcn)))
    .all()[0];
}

export function listTransfers(
  db: ArkomDb,
  ctx: MutationCtx,
  input: TransferListRequest,
): { rows: TransferRow[]; drawerCents: number } {
  const conds: SQL[] = [eq(transfers.tenantId, ctx.tenantId)];

  if (input.scope === "shift") {
    /* the default, because the question at a counter is "what have I done since
       I opened", not "what has this shop ever done" */
    const open = db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.terminalId, ctx.terminalId), isNull(shifts.closedAt)))
      .all()[0];
    conds.push(eq(transfers.shiftId, open?.id ?? "__none__"));
  }
  if (input.kind) conds.push(eq(transfers.kind, input.kind));
  if (input.status) conds.push(eq(transfers.status, input.status));
  if (input.fromMs) conds.push(gte(transfers.createdAt, new Date(input.fromMs)));
  if (input.toMs) conds.push(lte(transfers.createdAt, new Date(input.toMs)));

  const search = input.search?.trim().replace(/[%_]/g, "");
  if (search) {
    const needle = `%${search}%`;
    conds.push(
      or(like(transfers.mtcn, needle), like(transfers.senderName, needle), like(transfers.receiverName, needle))!,
    );
  }

  const raw = db.select().from(transfers).where(and(...conds)).orderBy(desc(transfers.createdAt)).all();
  const rows = withNames(db, raw);
  /* what this block did to the notes: a cancelled row contributes nothing,
     because its movement and its reversal net to zero */
  const drawerCents = raw.reduce((sum, r) => sum + (r.status === "cancelled" ? 0 : transferDrawerDelta(r)), 0);
  return { rows, drawerCents };
}

/** Every WU row that touched a given shift — logged in it, or cancelled in it. */
export function transferFactsForShift(db: Pick<ArkomDb, "select">, shiftId: string): TransferFact[] {
  const rows = db
    .select()
    .from(transfers)
    .where(or(eq(transfers.shiftId, shiftId), eq(transfers.cancelShiftId, shiftId)))
    .orderBy(asc(transfers.createdAt))
    .all();
  return rows.map((r) => ({
    kind: r.kind,
    status: r.status,
    principalCents: r.principalCents,
    feeCents: r.feeCents,
    method: r.method,
    loggedInThisShift: r.shiftId === shiftId,
    cancelledInThisShift: r.cancelShiftId === shiftId,
  }));
}

/* ----------------------------------------------------------------- write */

interface LogInput {
  kind: "send" | "payout";
  mtcn: string;
  senderName: string;
  receiverName: string;
  countryCode: string;
  principalCents: number;
  feeCents: number;
  method: "cash" | "card" | null;
}

function logTransfer(db: ArkomDb, ctx: MutationCtx, input: LogInput): TransferRow {
  const shift = requireOpenShift(db, ctx);
  const mtcn = normalizeMtcn(input.mtcn);

  /* checked before the transaction so the answer can carry the existing record
     rather than a bare constraint violation. The unique index is still the
     guarantee — this is the message (ADR-0018). */
  const clash = findByMtcn(db, ctx, mtcn);
  if (clash) throw appError("DUPLICATE_MTCN", clash.id, "mtcn");

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const row = {
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      terminalId: ctx.terminalId,
      kind: input.kind,
      status: (input.kind === "send" ? "sent" : "paid") as "sent" | "paid",
      mtcn,
      senderName: input.senderName.trim(),
      receiverName: input.receiverName.trim(),
      countryCode: input.countryCode.trim().toUpperCase(),
      principalCents: input.principalCents,
      feeCents: input.feeCents,
      method: input.method,
      shiftId: shift.id,
      userId: ctx.userId,
      createdAt: now,
      cancelledAt: null,
      cancelledByUserId: null,
      cancelReason: null,
      cancelShiftId: null,
      cancelApprovedByUserId: null,
      /* explicit rather than leaning on the column default: this object is also
         what the caller gets back, and a row that reads `undefined` in memory
         and "unverified" in the database is two answers to one question */
      verification: "unverified" as const,
      verifiedByUserId: null,
      verifiedAt: null,
      flagNote: null,
      updatedAt: now,
    };
    tx.insert(transfers).values(row).run();

    /* A CARD send moves no notes, so it writes no movement at all. A row worth
       zero in the drawer ledger is a row every later query has to remember to
       skip (ADR-0015 §3). */
    const delta = transferDrawerDelta(row);
    if (delta !== 0) {
      tx.insert(cashMovements)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          terminalId: ctx.terminalId,
          amountCents: delta,
          reason: input.kind === "send" ? "transfer_send" : "transfer_payout",
          documentId: null,
          ticketId: row.id,
          concept: null,
          shiftId: shift.id,
          userId: ctx.userId,
          createdAt: now,
        })
        .run();
    }

    log({ entity: "transfer", entityId: row.id, action: "create", before: null, after: toOplogJson(row) });
    return withNames(tx, [row as Row])[0]!;
  });
}

export function logSend(
  db: ArkomDb,
  ctx: MutationCtx,
  input: Omit<LogInput, "kind"> & { method: "cash" | "card" },
): TransferRow {
  return logTransfer(db, ctx, { ...input, kind: "send" });
}

/**
 * A payout, and the warning that is not a refusal.
 *
 * The customer is at the counter with ID and WU has already authorised the
 * payment; the shop may have a second cash box the till knows nothing about. So
 * a payout larger than expected cash returns both figures and waits, rather
 * than blocking a transaction the shop is contractually able to complete. Going
 * ahead is recorded in the oplog, because that is exactly the entry somebody
 * will want when the count comes up odd.
 */
export function logPayout(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { mtcn: string; senderName: string; receiverName: string; countryCode: string; principalCents: number; confirmedOverDrawer?: boolean },
):
  | { kind: "logged"; row: TransferRow }
  | { kind: "overDrawerWarning"; expectedCashCents: number; amountCents: number } {
  const shift = requireOpenShift(db, ctx);
  const expected = shiftTotals(db, shift).expectedCashCents;

  if (input.principalCents > expected && !input.confirmedOverDrawer) {
    return { kind: "overDrawerWarning", expectedCashCents: expected, amountCents: input.principalCents };
  }

  const row = logTransfer(db, ctx, {
    kind: "payout",
    mtcn: input.mtcn,
    senderName: input.senderName,
    receiverName: input.receiverName,
    countryCode: input.countryCode,
    principalCents: input.principalCents,
    feeCents: 0,
    method: null,
  });

  if (input.principalCents > expected) {
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      log({
        entity: "transfer",
        entityId: row.id,
        action: "over_drawer",
        before: null,
        after: { expectedCashCents: expected, amountCents: input.principalCents },
      });
    });
  }
  return { kind: "logged", row };
}

/**
 * Cancel: the exact reversal, in TODAY's shift.
 *
 * Never in the original's. A closed shift is frozen and its Z is evidence
 * (ADR-0015 §8), so a send cancelled the next morning is a movement in the next
 * morning's drawer with the original named in it. The status guard makes a
 * second cancel impossible — the reversal has already been paid out, and paying
 * it twice is the failure this exists to prevent.
 */
export function cancelTransfer(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { id: string; reason: string },
): TransferRow {
  const shift = requireOpenShift(db, ctx);

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const before = tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, input.id)))
      .all()[0];
    if (!before) throw appError("VALIDATION", "Ese giro no existe.");
    if (before.status === "cancelled") throw appError("VALIDATION", "Ese giro ya está cancelado.");

    const now = new Date();
    const reversal = transferCancelDelta(before);
    if (reversal !== 0) {
      tx.insert(cashMovements)
        .values({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          locationId: ctx.locationId,
          terminalId: ctx.terminalId,
          amountCents: reversal,
          reason: "transfer_cancel",
          documentId: null,
          ticketId: before.id,
          concept: null,
          shiftId: shift.id,
          userId: ctx.userId,
          createdAt: now,
        })
        .run();
    }

    tx.update(transfers)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledByUserId: ctx.userId,
        cancelReason: input.reason.trim(),
        cancelShiftId: shift.id,
        cancelApprovedByUserId: ctx.authorizedByUserId ?? null,
        updatedAt: now,
      })
      .where(eq(transfers.id, before.id))
      .run();

    log({
      entity: "transfer",
      entityId: before.id,
      action: "cancel",
      before: { status: before.status },
      after: { status: "cancelled", reason: input.reason.trim(), reversalCents: reversal, shiftId: shift.id },
    });

    const after = tx.select().from(transfers).where(eq(transfers.id, before.id)).all()[0]!;
    return withNames(tx, [after])[0]!;
  });
}

/* ------------------------------------------ verification (ADR-0019) ---- */

/**
 * Has somebody checked this row against WU's own terminal?
 *
 * **Touches no money.** A verified transfer and an unverified one do identical
 * things to the drawer, which is the whole point: verification is a statement
 * about the RECORD, and if it could move cash it would be a second way to
 * change the till's figures without a document.
 */
export function setVerification(
  db: ArkomDb,
  ctx: MutationCtx,
  input: { id: string; state: "unverified" | "verified" | "flagged"; note?: string | null },
): TransferRow {
  const note = input.note?.trim() || null;
  /* a flag with no note is a mystery rather than a signal: the next person sees
     a red row and has no idea what to look for */
  if (input.state === "flagged" && !note) throw appError("VALIDATION", "Un aviso necesita una nota.", "note");

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const before = tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, input.id)))
      .all()[0];
    if (!before) throw appError("VALIDATION", "Ese giro no existe.");

    const now = new Date();
    tx.update(transfers)
      .set({
        verification: input.state,
        /* who and when are stamped for `verified` and cleared when it goes back
           to unverified: a stale name beside "not checked" is a lie */
        verifiedByUserId: input.state === "unverified" ? null : ctx.userId,
        verifiedAt: input.state === "unverified" ? null : now,
        flagNote: input.state === "flagged" ? note : null,
        updatedAt: now,
      })
      .where(eq(transfers.id, before.id))
      .run();

    log({
      entity: "transfer",
      entityId: before.id,
      action: "verify",
      before: { verification: before.verification, flagNote: before.flagNote },
      after: { verification: input.state, flagNote: input.state === "flagged" ? note : null },
    });

    return withNames(tx, [tx.select().from(transfers).where(eq(transfers.id, before.id)).all()[0]!])[0]!;
  });
}

/**
 * Verify a batch — exactly the rows the operator was looking at.
 *
 * Takes IDS, never a filter. "Verify everything matching" would tick rows that
 * scrolled in between the screen rendering and the button being pressed, and
 * verification is a person saying they looked.
 */
export function bulkVerify(db: ArkomDb, ctx: MutationCtx, ids: ReadonlyArray<string>): number {
  const candidates = db
    .select({ id: transfers.id })
    .from(transfers)
    .where(and(eq(transfers.tenantId, ctx.tenantId), inArray(transfers.id, [...ids])))
    /* a flagged row is a question somebody raised; a bulk tick must not quietly
       answer it */
    .all();
  /* nothing to do is not a mutation: opening a transaction that writes no oplog
     entry is exactly what the envelope refuses, and rightly (ADR-0005) */
  if (candidates.length === 0) return 0;

  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const now = new Date();
    const rows = tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.tenantId, ctx.tenantId), inArray(transfers.id, [...ids])))
      .all()
      .filter((r) => r.verification === "unverified");

    if (rows.length === 0) {
      /* every listed row was already verified or flagged. Say so in the log
         rather than leaving the operator's tap unrecorded. */
      log({ entity: "transfer", entityId: candidates[0]!.id, action: "verify", before: null, after: { bulk: true, verified: 0 } });
      return 0;
    }

    for (const r of rows) {
      tx.update(transfers)
        .set({ verification: "verified", verifiedByUserId: ctx.userId, verifiedAt: now, updatedAt: now })
        .where(eq(transfers.id, r.id))
        .run();
      log({
        entity: "transfer",
        entityId: r.id,
        action: "verify",
        before: { verification: r.verification },
        after: { verification: "verified", bulk: true },
      });
    }
    return rows.length;
  });
}

/**
 * Fix a mistyped MTCN.
 *
 * Owner-only, because the MTCN is the key the reconciliation import will join
 * on: changing it re-points the row at a different WU transaction. Uniqueness
 * is re-checked, for the same reason it is checked on the way in.
 */
export function editMtcn(db: ArkomDb, ctx: MutationCtx, input: { id: string; mtcn: string }): TransferRow {
  const mtcn = normalizeMtcn(input.mtcn);
  return mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const before = tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.id, input.id)))
      .all()[0];
    if (!before) throw appError("VALIDATION", "Ese giro no existe.");
    if (before.mtcn === mtcn) return withNames(tx, [before])[0]!;

    const clash = tx
      .select()
      .from(transfers)
      .where(and(eq(transfers.tenantId, ctx.tenantId), eq(transfers.mtcn, mtcn)))
      .all()[0];
    if (clash) throw appError("DUPLICATE_MTCN", clash.id, "mtcn");

    tx.update(transfers).set({ mtcn, updatedAt: new Date() }).where(eq(transfers.id, before.id)).run();
    log({ entity: "transfer", entityId: before.id, action: "edit_mtcn", before: { mtcn: before.mtcn }, after: { mtcn } });
    return withNames(tx, [tx.select().from(transfers).where(eq(transfers.id, before.id)).all()[0]!])[0]!;
  });
}
