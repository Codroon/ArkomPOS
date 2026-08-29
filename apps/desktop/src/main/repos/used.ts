/**
 * Used-device repository (ADR-0013).
 *
 * Reads only, for now: the half of the purchase gate that needs the database.
 * The rules themselves live in `@arkom/core/used` — this file finds rows and
 * hands them over.
 */
import { and, eq } from "drizzle-orm";
import { isValidImei, mutate, type MutationCtx, type UsedCheckImeiResponse } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";

const { documents, products, units, usedPurchases } = schema;

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
