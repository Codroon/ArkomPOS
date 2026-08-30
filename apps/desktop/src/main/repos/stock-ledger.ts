/**
 * Writing one stock movement, in one place.
 *
 * The ledger is insert-only (ADR-0004): quantities are never updated, and
 * `product_stock` is a cache that must be rewritten in the same transaction as
 * the movement it summarises — which is the whole reason `db:audit` can assert
 * the two agree.
 *
 * This lived inside the used-devices repo until repairs needed the identical
 * thing. Two copies of a function that maintains a cache is how the copies drift
 * and the audit starts failing on Tuesdays.
 */
import { and, eq } from "drizzle-orm";
import { applyMovements, stockKey, toOplogJson, uuidv7, type LogFn, type MutationCtx, type buildMovement } from "@arkom/core";
import { schema } from "@arkom/db";
import type { DbTx } from "../mutate-runner";

const { productStock, products, stockMovements } = schema;

export function postMovement(
  tx: DbTx,
  ctx: MutationCtx,
  log: LogFn,
  movement: ReturnType<typeof buildMovement>,
  now: Date,
  /* The document that caused it. A sale_out has always carried the ticket that
     took the phone off the shelf; a tradein_in that carried nothing left the
     movements drawer showing "—" where the sale showed a link, so from
     Inventario there was no way back to the paperwork. */
  documentId: string | null = null,
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
    documentId,
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
