/**
 * Writing a sibling till's rows into this one — ADR-0022 §5–7.
 *
 * The SQL half of `absorb()`. core owns the ordering, the fold and the rule that
 * nothing may be logged; this owns the tables.
 *
 * Two choices here are worth more than the rest of the file:
 *
 * **Columns come from the drizzle schema, not from a list in this file.**
 * `getTableColumns()` says what a table has, the incoming payload is narrowed
 * to that, and anything else is dropped. A hand-written allow-list would be one
 * more place to forget a column when the schema gains one — and, worse, a place
 * that could silently stop replicating a field nobody noticed was missing.
 * Narrowing to real columns is also what makes a hostile or buggy payload
 * harmless: it cannot name a column that does not exist.
 *
 * **The stock cache is RECOMPUTED, never carried.** A movement is applied as an
 * insert (ADR-0004: the ledger is insert-only) and then `product_stock` is
 * rebuilt from the sum of the movements for that product and location. Taking
 * the sender's cached total would put a second answer to the on-hand question
 * on the wire, which is the exact failure ADR-0015 §3 exists to prevent — and
 * recomputing is what makes `pnpm db:audit` double as the check that
 * replication landed.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getTableColumns } from "drizzle-orm";
import {
  absorb,
  isSharedEntity,
  planAbsorb,
  repairStatus,
  voucherState,
  NEVER_REPLICATED,
  type AbsorbPlan,
  type AbsorbReport,
  type AbsorbRunner,
  type InboxEntry,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import type { DbTx } from "../mutate-runner";
import { loadFacts } from "../repos/repair";

const { syncInbox, oplog, productStock, stockMovements } = schema;

/** How many inbox rows one pass attempts. A pass is cheap; a long one is not. */
export const APPLY_BATCH = 400;

/**
 * Which table each shared entity writes to.
 *
 * The one place the wire's vocabulary meets the schema's. `product_stock` is
 * deliberately absent — it is a cache this till computes, not a row it receives.
 */
const TABLES = {
  product_group: schema.productGroups,
  product: schema.products,
  product_code: schema.productCodes,
  supplier: schema.suppliers,
  customer: schema.customers,
  unit: schema.units,
  stock_movement: schema.stockMovements,
  /* ADR-0023 — a repair and a voucher follow the customer, not the till */
  store_credit_voucher: schema.storeCreditVouchers,
  voucher_redemption: schema.voucherRedemptions,
  repair_ticket: schema.repairTickets,
  repair_line: schema.repairLines,
  repair_approval: schema.repairApprovals,
  repair_notification: schema.repairNotifications,
} as const;

type SharedTable = (typeof TABLES)[keyof typeof TABLES];

/**
 * Narrow a payload to the columns its table actually has, converting as the
 * column needs.
 *
 * `toOplogJson()` turns a Date into epoch ms on the way out, so a
 * `timestamp_ms` column needs it turned back. Everything else travels as
 * itself — money is integer cents and crosses as a number, which is the whole
 * reason ADR-0006 banned floats and strings from the logic.
 */
function rowFor(table: SharedTable, fields: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table) as Record<string, { dataType: string }>;
  const row: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(columns)) {
    if (!(key in fields)) continue;
    const value = fields[key];
    if (column.dataType === "date" && typeof value === "number") {
      row[key] = new Date(value);
    } else {
      row[key] = value;
    }
  }
  return row;
}

/**
 * The guard that makes the plan's `asOfMs` mean something.
 *
 * A till that was off for three days and then pushes a rename it made on day
 * one would otherwise overwrite a rename another till made on day two, purely
 * because it ARRIVED later. Where the table has `updated_at` — products,
 * customers and units, the three shared tables anybody actually edits — an
 * older edit is skipped. Where it does not (`product_group`, `supplier`),
 * arrival order decides, and the cost is a label somebody retypes.
 */
function isStale(tx: DbTx, table: SharedTable, id: string, asOfMs: number): boolean {
  const columns = getTableColumns(table) as Record<string, unknown>;
  if (!("updatedAt" in columns) || !("id" in columns)) return false;

  const existing = tx
    .select({ updatedAt: sql<number | null>`updated_at` })
    .from(table)
    .where(sql`id = ${id}`)
    .all()[0];

  const stored = existing?.updatedAt;
  if (stored === null || stored === undefined) return false;
  return Number(stored) > asOfMs;
}

/**
 * Make sure the till that WROTE this row exists locally.
 *
 * `stock_movements.terminal_id` references `terminals.id`, and a terminal never
 * reaches the oplog — it is structure, created by the first-run wizard outside
 * `mutate()`. So a movement from Caja 1 arriving at Caja 2 has nothing to point
 * at, and SQLite says `FOREIGN KEY constraint failed` rather than anything
 * helpful.
 *
 * Replicating terminals properly means logging their creation, which existing
 * installs never did and cannot retroactively. So the row is created on demand
 * from what the entry itself carries.
 *
 * The NAME is the terminal's own id, and deliberately not a sentence. The first
 * version of this wrote `Otra caja (…)` — a Spanish literal, in code, into a
 * column — which is the exact mistake ADR-0011 exists to prevent: our words
 * must be GENERATED at display time, never stored, or they appear in Spanish on
 * an English screen and no translator can reach them. The same bug had already
 * shipped twice elsewhere.
 *
 * An id is honest. This till genuinely has not been told what the other one is
 * called; nothing displays this column today, and if something ever does, an id
 * reads as "unknown till" rather than as a name in the wrong language. Carrying
 * the author's real name would mean adding it to the pull response — worth
 * doing, not worth doing here.
 *
 * It is a structural row, not shop data, so it is created here rather than
 * replicated, and no oplog entry is written for it (§6).
 */
function ensureTerminal(tx: DbTx, plan: AbsorbPlan): void {
  const terminalId = plan.terminalId;
  if (!terminalId) return;

  const known = tx
    .select({ id: schema.terminals.id })
    .from(schema.terminals)
    .where(eq(schema.terminals.id, terminalId))
    .all();
  if (known.length > 0) return;

  tx.insert(schema.terminals)
    .values({
      id: terminalId,
      tenantId: plan.tenantId,
      locationId: plan.locationId,
      /* language-neutral by construction — see the note above */
      name: terminalId.slice(0, 8),
      createdAt: new Date(),
    })
    .onConflictDoNothing()
    .run();
}

/** Write one plan. Throws to DEFER — a foreign-key error means "not yet". */
function write(tx: DbTx, plan: AbsorbPlan): void {
  /*
   * Refused here as well as filtered by the pull route.
   *
   * "The server already filtered it" is not a property a till should depend on
   * for a rule this consequential. A till handed a `setting` row would point
   * itself at another till's printer; one handed a `document` would put a sale
   * in a database with no shift to account for it.
   */
  if (!isSharedEntity(plan.entity)) {
    const why = NEVER_REPLICATED[plan.entity] ?? "not a shared entity (ADR-0022 §1)";
    throw new Error(`refused ${plan.entity}: ${why}`);
  }

  const table = TABLES[plan.entity];

  if (plan.deleted) {
    /* A delete is a fact like any other. Nothing cascades: the shared tables
       that can be deleted are the ones nothing points at (v0.18.0), and a row
       with history is archived instead, which arrives as an update. */
    tx.delete(table).where(sql`id = ${plan.entityId}`).run();
    return;
  }

  if (isStale(tx, table, plan.entityId, plan.asOfMs)) return;

  /* the till that wrote it has to exist before a row can name it */
  if (plan.entity === "stock_movement" || plan.entity === "repair_ticket") ensureTerminal(tx, plan);

  /* `id` is the oplog's entity_id COLUMN, never the payload's — the payload may
     not carry one at all (ADR-0005, and the bug `cloud:reconcile` caught). */
  const fields = rowFor(table, plan.fields);
  const columns = Object.keys(fields);

  /**
   * UPDATE an existing row, INSERT a new one — never an upsert.
   *
   * An upsert reads well and is wrong here. SQLite evaluates the INSERT half
   * FIRST, so `insert({id, collectionDocumentId}).onConflictDoUpdate(...)` on a
   * table whose `tenant_id` is NOT NULL fails on the constraint before the
   * conflict clause can save it. The till pushes CHANGES, so a payload of one
   * field is normal: `repair_ticket/collect` is literally
   * `{collectionDocumentId, docNumber}`.
   *
   * This went unnoticed through ADR-0022 because every entity shared then
   * happened to be pushed WHOLE — `catalog:save` logs the full row and a stock
   * movement is insert-only. The first partial payload to cross the wire was a
   * repair being collected, and it failed on every pass with
   * `NOT NULL constraint failed`, visible only in the inbox's `last_error`.
   *
   * A partial payload for a row this till has never seen is not an error, it is
   * EARLY: the create that would have given it a tenant has not arrived yet.
   * The insert fails, the row defers, and the next pass has both.
   */
  const exists =
    tx
      .select({ id: sql<string>`id` })
      .from(table)
      .where(sql`id = ${plan.entityId}`)
      .all().length > 0;

  if (exists) {
    if (columns.length === 0) return; // nothing this batch has to say about it
    tx.update(table)
      /* only the fields this batch actually mentioned: an update that touched
         one column must not blank the others (ADR-0022 §7) */
      .set(fields as never)
      .where(sql`id = ${plan.entityId}`)
      .run();
    return;
  }

  tx.insert(table)
    .values({ ...fields, id: plan.entityId } as never)
    .run();
}

/**
 * Rebuild `product_stock` for the products a batch touched.
 *
 * From the ledger, by summing it — the same figure `pnpm db:audit` asserts
 * against, computed the same way. One statement per product and location, after
 * the batch, because a movement and the unit it names can land in either order
 * within a pass.
 */
function rebuildCache(db: ArkomDb, productIds: readonly string[]): void {
  if (productIds.length === 0) return;

  db.transaction((tx) => {
    const sums = tx
      .select({
        productId: stockMovements.productId,
        locationId: stockMovements.locationId,
        onHand: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`,
      })
      .from(stockMovements)
      .where(inArray(stockMovements.productId, [...productIds]))
      .groupBy(stockMovements.productId, stockMovements.locationId)
      .all();

    const now = new Date();
    for (const sum of sums) {
      const updated = tx
        .update(productStock)
        .set({ onHand: Number(sum.onHand), updatedAt: now })
        .where(
          and(
            eq(productStock.productId, sum.productId),
            eq(productStock.locationId, sum.locationId),
          ),
        )
        .run();

      if (updated.changes === 0) {
        tx.insert(productStock)
          .values({
            productId: sum.productId,
            locationId: sum.locationId,
            onHand: Number(sum.onHand),
            updatedAt: now,
          })
          .run();
      }
    }
  });
}

/**
 * Recompute what is DERIVED, from the facts this till now holds.
 *
 * A repair's status is computed from its own facts and never assigned
 * (ADR-0014 §1); a voucher's balance is the face value minus an insert-only
 * ledger (ADR-0023 §4). Both arrive in the batch as columns, and both are
 * IGNORED in favour of the local answer — exactly as `product_stock` is
 * rebuilt from the movements rather than taken from the wire.
 *
 * Why it matters more than it looks: a batch can arrive with a ticket's status
 * but not yet the approval that justifies it, or with a voucher's remainder
 * from a till that had not yet seen this till's redemption. Taking either at
 * face value would write a number that disagrees with the rows sitting beside
 * it, and `db:audit` would be right to fail. Deriving locally is what makes an
 * out-of-order batch a non-event.
 *
 * No oplog entry, by construction: this is arithmetic over replicated facts,
 * not a decision this till made (ADR-0022 §6).
 */
function rederive(db: ArkomDb, repairIds: readonly string[], voucherIds: readonly string[]): void {
  const now = new Date();

  for (const ticketId of repairIds) {
    try {
      db.transaction((tx) => {
        /* `loadFacts` + `repairStatus` are the SAME pair the till uses on its
           own writes. A second implementation here would be a second answer. */
        const next = repairStatus(loadFacts(tx, ticketId));
        tx.update(schema.repairTickets)
          .set({ status: next, updatedAt: now })
          .where(eq(schema.repairTickets.id, ticketId))
          .run();
      });
    } catch {
      /* the ticket itself has not landed yet — its lines were early. The next
         pass will have both, and the status with it. */
    }
  }

  for (const voucherId of voucherIds) {
    try {
      db.transaction((tx) => {
        const voucher = tx
          .select()
          .from(schema.storeCreditVouchers)
          .where(eq(schema.storeCreditVouchers.id, voucherId))
          .all()[0];
        if (!voucher) return;

        const redemptions = tx
          .select({ amountCents: schema.voucherRedemptions.amountCents })
          .from(schema.voucherRedemptions)
          .where(eq(schema.voucherRedemptions.voucherId, voucherId))
          .all()
          .map((row) => row.amountCents);

        const state = voucherState({
          amountCents: voucher.amountCents,
          redemptions,
          voidReason: voucher.voidReason,
        });

        tx.update(schema.storeCreditVouchers)
          .set({ remainingCents: state.remainingCents, status: state.status, updatedAt: now })
          .where(eq(schema.storeCreditVouchers.id, voucherId))
          .run();

        if (state.overdrawnCents > 0) {
          /*
           * Two tills redeemed inside the replication window (ADR-0023 §5).
           * Both sales stand and both customers have left; this is reported
           * rather than prevented, so the one thing that must happen is that
           * somebody can find out. `db:audit` fails on it and the dashboard
           * shows it; this line is what makes it findable in a log too.
           */
          console.warn(
            `[sync] voucher ${voucherId} is overdrawn by ${state.overdrawnCents} cents — ` +
              `redeemed at more than one till (ADR-0023 §5)`,
          );
        }
      });
    } catch {
      /* the voucher has not landed yet; its redemption was early */
    }
  }
}

/** `AbsorbRunner` over this database. `oplogCount` is the §6 guarantee. */
export function makeAbsorbRunner(db: ArkomDb): AbsorbRunner<DbTx> {
  return {
    transaction: (fn) => db.transaction((tx) => fn(tx)),
    oplogCount: (tx) =>
      Number(tx.select({ n: sql<number>`count(*)` }).from(oplog).all()[0]?.n ?? 0),
  };
}

export interface ApplyResult extends AbsorbReport {
  /** rows still waiting after this pass — early, or permanently unapplicable */
  pending: number;
}

/**
 * One pass over the inbox.
 *
 * Does not throw. A pass that cannot do its work records why and leaves the
 * rows pending, because this runs on a timer behind a counter and an exception
 * here must never be the reason a shop cannot sell.
 */
export function applyInbox(db: ArkomDb, limit = APPLY_BATCH): ApplyResult {
  const pendingRows = db
    .select()
    .from(syncInbox)
    .where(isNull(syncInbox.appliedAt))
    .orderBy(asc(syncInbox.ingestSeq))
    .limit(limit)
    .all();

  if (pendingRows.length === 0) return { applied: 0, deferred: 0, reasons: {}, pending: 0 };

  const entries: InboxEntry[] = pendingRows.map((row) => ({
    opId: row.opId,
    ingestSeq: row.ingestSeq,
    tenantId: row.tenantId,
    locationId: row.locationId,
    terminalId: row.terminalId,
    entity: row.entity,
    entityId: row.entityId,
    action: row.action,
    before: row.before ?? null,
    after: row.after ?? null,
    userId: row.userId,
    authorizedByUserId: row.authorizedByUserId,
    createdAtMs: row.createdAt.getTime(),
  }));

  const plans = planAbsorb(entries);
  const report = absorb(makeAbsorbRunner(db), plans, write);

  /* Bookkeeping is OUTSIDE the per-row transaction on purpose. Marking a row
     applied inside it would mean the §6 oplog check saw a write that is not a
     business row, and separating them costs nothing: a crash between the two
     leaves the row pending and it is applied again, idempotently. */
  const now = new Date();
  const failed = new Set(Object.keys(report.reasons));

  for (const plan of plans) {
    const landed = plan.opIds.filter((opId) => !failed.has(opId));
    if (landed.length) {
      db.update(syncInbox)
        .set({ appliedAt: now, lastError: null })
        .where(inArray(syncInbox.opId, landed))
        .run();
    }
  }

  for (const [opId, reason] of Object.entries(report.reasons)) {
    db.update(syncInbox)
      .set({ attempts: sql`attempts + 1`, lastError: reason.slice(0, 300) })
      .where(eq(syncInbox.opId, opId))
      .run();
  }

  /* the caches, once each, from the facts that just landed */
  const touched = new Set<string>();
  const repairs = new Set<string>();
  const vouchers = new Set<string>();

  for (const plan of plans) {
    if (failed.has(plan.opIds[0]!)) continue;
    const field = (key: string): string | undefined =>
      typeof plan.fields[key] === "string" ? (plan.fields[key] as string) : undefined;

    switch (plan.entity) {
      case "stock_movement": {
        const productId = field("productId");
        if (productId) touched.add(productId);
        break;
      }
      /* a ticket is its own subject; its children name it */
      case "repair_ticket":
        repairs.add(plan.entityId);
        break;
      case "repair_line":
      case "repair_approval":
      case "repair_notification": {
        const ticketId = field("ticketId");
        if (ticketId) repairs.add(ticketId);
        break;
      }
      case "store_credit_voucher":
        vouchers.add(plan.entityId);
        break;
      case "voucher_redemption": {
        const voucherId = field("voucherId");
        if (voucherId) vouchers.add(voucherId);
        break;
      }
      default:
        break;
    }
  }

  rebuildCache(db, [...touched]);
  rederive(db, [...repairs], [...vouchers]);

  const pending = Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(syncInbox)
      .where(isNull(syncInbox.appliedAt))
      .all()[0]?.n ?? 0,
  );

  return { ...report, pending };
}
