/**
 * Which rows belong to the SHOP — ADR-0022 §1, pinned.
 *
 * This list is a decision, not a detail. Adding to it should be a deliberate
 * edit that somebody reviewed, and the cost of being wrong is asymmetric:
 *
 *   · too LITTLE and a shop retypes a catalogue at every counter;
 *   · too MUCH and a till prints to another till's printer, two tills issue
 *     invoice T1-000001, a sale lands in a database with no shift to account
 *     for it, or a store-credit voucher is spent twice.
 *
 * So the list is asserted verbatim. A test that fails because somebody added an
 * entity is the test working: the fix is to read ADR-0022 §1, decide, and
 * change this line on purpose.
 */
import { describe, expect, it } from "vitest";
import {
  applyRank,
  isSharedEntity,
  NEVER_REPLICATED,
  SHARED_ENTITIES,
  CACHE_REBUILD_TRIGGER,
} from "../share";

describe("the list itself", () => {
  it("is exactly these thirteen, in this order", () => {
    expect([...SHARED_ENTITIES]).toEqual([
      "product_group",
      "product",
      "product_code",
      "supplier",
      "customer",
      "unit",
      "stock_movement",
      /* ADR-0023 — a repair and a voucher follow the customer, not the till */
      "store_credit_voucher",
      "voucher_redemption",
      "repair_ticket",
      "repair_line",
      "repair_approval",
      "repair_notification",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(SHARED_ENTITIES).size).toBe(SHARED_ENTITIES.length);
  });

  it("holds nothing that is on the never-replicated list", () => {
    for (const entity of SHARED_ENTITIES) {
      expect(NEVER_REPLICATED, entity).not.toHaveProperty(entity);
    }
  });
});

describe("the order is the one sqlite will accept", () => {
  /** parent → the entity that references it, from the schema's foreign keys */
  const DEPENDS_ON: Record<string, string[]> = {
    product: ["product_group"],
    product_code: ["product"],
    unit: ["product"],
    stock_movement: ["product", "unit", "supplier"],
    /* ADR-0023 */
    voucher_redemption: ["store_credit_voucher"],
    repair_ticket: ["customer"],
    repair_line: ["repair_ticket", "product", "supplier"],
    repair_approval: ["repair_ticket"],
    repair_notification: ["repair_ticket"],
  };

  it("puts every parent before the row that references it", () => {
    for (const [child, parents] of Object.entries(DEPENDS_ON)) {
      for (const parent of parents) {
        expect(applyRank(parent), `${parent} must land before ${child}`).toBeLessThan(
          applyRank(child),
        );
      }
    }
  });

  it("sends an unknown entity to the back, never the front", () => {
    /* the pull filters to the shared list, so this should never arrive. If it
       does it must not jump the queue ahead of a product. */
    expect(applyRank("something_from_the_future")).toBeGreaterThan(applyRank("stock_movement"));
  });
});

describe("what a till must refuse, and the reason attached to each", () => {
  /**
   * The ones that would cost real money or real evidence if they replicated.
   * Each is here because of a rule in another ADR, named in the value.
   */
  const MUST_REFUSE = [
    "setting",
    "user",
    "document",
    "document_line",
    "document_tender",
    "shift",
    "cash_movement",
    "used_purchase",
    /* the photographs, specifically: ADR-0023 opened the repair up and did NOT
       open its pictures, because the cloud holds records and not files */
    "repair_photo",
    "purchase_photo",
    "transfer",
  ];

  it("refuses each of them", () => {
    for (const entity of MUST_REFUSE) {
      expect(isSharedEntity(entity), entity).toBe(false);
      expect(NEVER_REPLICATED, entity).toHaveProperty(entity);
    }
  });

  it("gives a reason a developer can act on, not just a 'no'", () => {
    for (const [entity, reason] of Object.entries(NEVER_REPLICATED)) {
      expect(reason.length, entity).toBeGreaterThan(10);
    }
    /* the one that costs money rather than tidiness says so */
    expect(NEVER_REPLICATED.setting).toContain("printer");
    /* and the used purchase names what it is protecting */
    expect(NEVER_REPLICATED.used_purchase).toContain("photographs");
  });

  it("no longer refuses what ADR-0023 opened up", () => {
    /* this case is the deliberate edit the list is supposed to force: a repair
       and a voucher crossing the counter was a decision, taken once, written
       down, and reflected in both lists rather than in one */
    for (const opened of [
      "store_credit_voucher",
      "voucher_redemption",
      "repair_ticket",
      "repair_line",
      "repair_approval",
      "repair_notification",
    ]) {
      expect(NEVER_REPLICATED, opened).not.toHaveProperty(opened);
      expect(isSharedEntity(opened), opened).toBe(true);
    }
  });

  it("keeps the photographs home, as ADR-0020 §3 requires", () => {
    expect(isSharedEntity("purchase_photo")).toBe(false);
    expect(isSharedEntity("repair_photo")).toBe(false);
  });
});

describe("the stock cache is computed, never carried", () => {
  it("is not a replicated entity", () => {
    /* a cached total on the wire would be a second answer to a question that
       already has one (ADR-0015 §3) */
    expect(isSharedEntity("product_stock")).toBe(false);
  });

  it("is rebuilt after the entities that can change it", () => {
    for (const entity of CACHE_REBUILD_TRIGGER) {
      expect(isSharedEntity(entity), entity).toBe(true);
    }
    expect([...CACHE_REBUILD_TRIGGER]).toContain("stock_movement");
  });
});
