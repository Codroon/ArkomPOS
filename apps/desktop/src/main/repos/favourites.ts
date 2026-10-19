/**
 * The Sale screen's quick tabs — v1.5.0, ADR-0025.
 *
 * A shop with five hundred products sells the same twenty all day. Favourites
 * are the twenty the shop chose, in the order it arranged them; Best sellers are
 * the twenty it actually sold most, worked out from the ledger.
 *
 * **Favourites are the shop's, and anybody may arrange them.** The owner asked
 * for that explicitly: the cashier at the counter knows what they reach for.
 * Pins replicate like the catalogue they point into, so both counters show the
 * same tab, and every pin, unpin and reorder is a `mutate()` with an oplog
 * entry naming who did it.
 *
 * **Best sellers are computed, never stored.** From `stock_movements`, which
 * every till of the shop shares (ADR-0022): sales out, less refunds that came
 * back to the shelf, over the last thirty days. A number stored for this would
 * be a second answer to a question the ledger already answers.
 */
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { appError, mutate, toOplogJson, type MutationCtx, type SaleQuickPicks } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

const { productFavourites, products, stockMovements } = schema;

export const BEST_SELLER_DAYS = 30;
export const BEST_SELLER_COUNT = 20;
const DAY_MS = 86_400_000;

export function quickPicks(db: ArkomDb, ctx: MutationCtx, now: Date = new Date()): SaleQuickPicks {
  const favourites = db
    .select({ productId: productFavourites.productId })
    .from(productFavourites)
    .innerJoin(products, eq(products.id, productFavourites.productId))
    .where(eq(productFavourites.tenantId, ctx.tenantId))
    /* two tills reordering at the same moment can leave two pins on one
       position; the name keeps the tab stable rather than shuffling */
    .orderBy(asc(productFavourites.position), asc(products.name))
    .all()
    .map((r) => r.productId);

  const since = new Date(now.getTime() - BEST_SELLER_DAYS * DAY_MS);
  /* sale_out is negative and return_in positive, so minus their sum is what
     left the shop and stayed gone */
  const sold = sql<number>`-sum(${stockMovements.qty})`;
  const bestSellers = db
    .select({ productId: stockMovements.productId, qty: sold })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.tenantId, ctx.tenantId),
        inArray(stockMovements.movementType, ["sale_out", "return_in"]),
        gte(stockMovements.createdAt, since),
      ),
    )
    .groupBy(stockMovements.productId)
    .having(sql`-sum(${stockMovements.qty}) > 0`)
    .orderBy(sql`-sum(${stockMovements.qty}) desc`)
    .limit(BEST_SELLER_COUNT)
    .all()
    .map((r) => ({ productId: r.productId, qty: Number(r.qty) }));

  return { favourites, bestSellers, days: BEST_SELLER_DAYS };
}

/** Pin to the end of the tab, or unpin. Pinning what is pinned changes nothing. */
export function toggleFavourite(
  db: ArkomDb,
  ctx: MutationCtx,
  productId: string,
  pinned: boolean,
): SaleQuickPicks {
  const product = db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), eq(products.id, productId)))
    .all()[0];
  if (!product) throw appError("VALIDATION", "Artículo no encontrado.");

  const existing = db.select().from(productFavourites).where(eq(productFavourites.id, productId)).all()[0];
  if (pinned === Boolean(existing)) return quickPicks(db, ctx);

  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    if (existing) {
      tx.delete(productFavourites).where(eq(productFavourites.id, productId)).run();
      log({ entity: "product_favourite", entityId: productId, action: "unpin", before: toOplogJson(existing), after: null });
      return;
    }
    const last = tx
      .select({ top: sql<number | null>`max(${productFavourites.position})` })
      .from(productFavourites)
      .where(eq(productFavourites.tenantId, ctx.tenantId))
      .all()[0]?.top;
    const row = {
      id: productId,
      tenantId: ctx.tenantId,
      productId,
      position: (last ?? 0) + 1,
      createdAt: new Date(),
    };
    tx.insert(productFavourites).values(row).run();
    log({ entity: "product_favourite", entityId: productId, action: "pin", before: null, after: toOplogJson(row) });
  });
  return quickPicks(db, ctx);
}

/**
 * Put the tab in this order. Ids that are not pinned are ignored, pins the list
 * does not mention keep their place after it, and only the pins whose position
 * actually moved are written — a drag of one card is a handful of entries, not
 * the whole tab every time.
 */
export function reorderFavourites(db: ArkomDb, ctx: MutationCtx, productIds: readonly string[]): SaleQuickPicks {
  const current = quickPicks(db, ctx).favourites;
  const pinned = new Set(current);
  const wanted = [...new Set(productIds)].filter((id) => pinned.has(id));
  const order = [...wanted, ...current.filter((id) => !wanted.includes(id))];

  const rows = new Map(
    db
      .select()
      .from(productFavourites)
      .where(eq(productFavourites.tenantId, ctx.tenantId))
      .all()
      .map((r) => [r.id, r]),
  );
  const moved = order.map((id, i) => ({ row: rows.get(id)!, position: i + 1 })).filter((m) => m.row.position !== m.position);
  if (moved.length === 0) return quickPicks(db, ctx);

  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    for (const { row, position } of moved) {
      tx.update(productFavourites).set({ position }).where(eq(productFavourites.id, row.id)).run();
      log({
        entity: "product_favourite",
        entityId: row.id,
        action: "reorder",
        before: { position: row.position },
        after: { position },
      });
    }
  });
  return quickPicks(db, ctx);
}
