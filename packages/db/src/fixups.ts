/**
 * Data fix-ups that run once after migrations.
 *
 * Drizzle migrations are SQL, and SQL cannot mint a UUIDv7 (ADR-0006 forbids
 * `Math.random` and autoincrement for business ids, and a v4-shaped id in a
 * v7 column breaks the time-ordering everything else assumes). So a backfill
 * that has to CREATE rows lives here, in TypeScript, taking the id generator as
 * an argument — this package persists rows and does not own the id scheme, so it
 * borrows core's uuidv7 from the caller rather than depending on core.
 *
 * Every fix-up must be **idempotent**: it runs on every startup, and the second
 * run must change nothing. Each one checks for its own absence rather than
 * tracking whether it has run — a marker row is one more thing that can be wrong.
 */
import { and, eq, sql } from "drizzle-orm";
import type { ArkomDb } from "./client";
import * as schema from "./schema";

export interface FixupReport {
  /** used-device cash payouts written into the cash ledger */
  payoutsBackfilled: number;
  /** used products re-typed from `serialized` to `used_device` */
  usedProductsRetyped: number;
}

/**
 * Give historic used-device cash payouts a home in the drawer ledger.
 *
 * `cash_movements` arrives with the repairs slice (ADR-0014 §7), but the shop has
 * been paying cash for phones since v0.11.0 — that money left the drawer and the
 * new ledger would start out already wrong about it. Everything needed is on the
 * purchase: the amount, that it was cash, when, where, and who took it.
 *
 * Contained by construction: it reads two tables, writes one row per matching
 * purchase, and skips any purchase that already has a payout row. Transfers and
 * store-credit payouts are not drawer events and are deliberately absent.
 */
export function backfillUsedPurchasePayouts(db: ArkomDb, newId: () => string): number {
  const { usedPurchases, documents, cashMovements } = schema;

  const missing = db
    .select({
      id: usedPurchases.id,
      tenantId: usedPurchases.tenantId,
      locationId: usedPurchases.locationId,
      terminalId: usedPurchases.terminalId,
      documentId: usedPurchases.documentId,
      buyPriceCents: usedPurchases.buyPriceCents,
      purchasedAt: usedPurchases.purchasedAt,
      userId: documents.userId,
    })
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .where(
      and(
        eq(usedPurchases.payoutMethod, "cash"),
        sql`not exists (
          select 1 from ${cashMovements} cm
          where cm.document_id = ${usedPurchases.documentId}
            and cm.reason = 'used_purchase_payout'
        )`,
      ),
    )
    .all();

  for (const row of missing) {
    db.insert(cashMovements)
      .values({
        id: newId(),
        tenantId: row.tenantId,
        locationId: row.locationId,
        terminalId: row.terminalId,
        // money OUT of the drawer: the shop handed it to the seller
        amountCents: -row.buyPriceCents,
        reason: "used_purchase_payout",
        documentId: row.documentId,
        ticketId: null,
        userId: row.userId,
        createdAt: row.purchasedAt,
      })
      .run();
  }

  return missing.length;
}

/**
 * Run every fix-up. Called once at startup, straight after migrations.
 *
 * Deliberately NOT wrapped in one transaction across fix-ups: each is
 * independent and idempotent, so a failure in a later one must not roll back an
 * earlier one that succeeded — the next startup would simply redo what is still
 * missing.
 */
/**
 * Give used products the item type they were always supposed to have.
 *
 * ADR-0013 and core's own documentation say a used device is a `used_device`
 * product; the writer said `serialized`, and Stock muerto had to exclude them by
 * matching the "(usado)" suffix in the NAME — which a shop can change, at which
 * point a report silently changes its mind.
 *
 * Keyed structurally, never on the name: a product is a used product exactly
 * when one of its units came from a purchase. Idempotent, like every fix-up
 * here — it looks for its own absence rather than tracking whether it has run.
 */
export function retypeUsedProducts(db: ArkomDb): number {
  const { products, units } = schema;
  const stale = db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.itemType, "serialized"),
        sql`exists (select 1 from ${units} u where u.product_id = ${products.id} and u.purchase_id is not null)`,
      ),
    )
    .all();

  for (const row of stale) {
    db.update(products).set({ itemType: "used_device" }).where(eq(products.id, row.id)).run();
  }
  return stale.length;
}

export function runDataFixups(db: ArkomDb, newId: () => string): FixupReport {
  return {
    payoutsBackfilled: backfillUsedPurchasePayouts(db, newId),
    usedProductsRetyped: retypeUsedProducts(db),
  };
}
