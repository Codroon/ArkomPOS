/**
 * Which rows belong to the SHOP and which belong to the till — ADR-0022 §1.
 *
 * This file is the contract that ADR made, in the one place both halves import
 * it from. It is a short, closed list on purpose: adding an entity to the sync
 * is a deliberate edit somebody reviewed, not a side effect of writing a new
 * screen, because the cost of being wrong is asymmetric. Replicating too
 * little leaves a shop retyping a catalogue. Replicating too much points a till
 * at another till's printer, hands two tills one invoice number, or puts a sale
 * in a database that has no shift to account for it.
 *
 * Nothing here talks to a database. The till's applier and the cloud's pull
 * route both read these lists, so neither can drift from the decision.
 */

/**
 * The shop's own facts, in **dependency order** — a batch is applied in this
 * sequence so that a parent row lands before the row that references it.
 *
 * The order is not cosmetic. SQLite runs with `foreign_keys = ON`, and
 * `product_code.product_id` is `NOT NULL REFERENCES products`, so a code
 * applied before its product is a failed statement rather than a warning.
 *
 *   product_group  →  nothing else shared
 *   product        →  product_group (nullable: a flagged product has no group)
 *   product_code   →  product
 *   supplier       →  nothing
 *   customer       →  nothing
 *   unit           →  product  (its purchase_id is a bare reference, not an FK)
 *   stock_movement →  product, unit, supplier
 *
 * `stock_movement.document_id` is deliberately a bare text column and not a
 * foreign key (ADR-0004), which is the reason a movement can replicate to a
 * till that will never hold the sale that caused it. That was luck when it was
 * written and is load-bearing now.
 */
export const SHARED_ENTITIES = [
  "product_group",
  "product",
  "product_code",
  "supplier",
  "customer",
  "unit",
  "stock_movement",
  /* ---- ADR-0023: a repair and a voucher follow the customer, not the till ----
   *
   *   store_credit_voucher →  nothing (its purchase_id is a reference, §1)
   *   voucher_redemption   →  store_credit_voucher
   *   repair_ticket        →  customer  (its document_id is a reference, §1)
   *   repair_line          →  repair_ticket, product, supplier
   *   repair_approval      →  repair_ticket
   *   repair_notification  →  repair_ticket
   *
   * The voucher comes before its redemptions and the ticket before its lines,
   * for the same reason a product comes before its codes: SQLite checks. */
  "store_credit_voucher",
  "voucher_redemption",
  "repair_ticket",
  "repair_line",
  "repair_approval",
  "repair_notification",
] as const;

export type SharedEntity = (typeof SHARED_ENTITIES)[number];

/** Position in the apply order; lower lands first. */
export function applyRank(entity: string): number {
  const i = (SHARED_ENTITIES as readonly string[]).indexOf(entity);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

export function isSharedEntity(entity: string): entity is SharedEntity {
  return (SHARED_ENTITIES as readonly string[]).includes(entity);
}

/**
 * Entities a till must NOT accept from another till, with the reason attached.
 *
 * The pull route filters to {@link SHARED_ENTITIES}, so in a healthy system
 * nothing on this list ever arrives. It exists because "the server already
 * filtered it" is not a property the till should depend on for a rule this
 * consequential: a till that is handed a `setting` row refuses it here, names
 * the reason in its log, and keeps printing to its own printer.
 */
export const NEVER_REPLICATED: Readonly<Record<string, string>> = Object.freeze({
  setting: "the printer is a setting — ADR-0022 §1",
  user: "PIN is the till's own authority — ADR-0012",
  document: "per-till series and shift — ADR-0008, ADR-0015",
  document_line: "belongs to a document that stays home",
  document_tender: "belongs to a document that stays home",
  shift: "one drawer, one till, one Z — ADR-0015",
  cash_movement: "one drawer, one till — ADR-0015",
  used_purchase: "carries ID photographs and a seller's document — ADR-0013",
  purchase_photo: "files stay home — ADR-0020 §3",
  repair_photo: "files stay home — ADR-0020 §3",
  transfer: "the WU counter is one terminal's shadow log — ADR-0018",
  backup: "a machine's own housekeeping",
  printer: "the till's own hardware",
});

/**
 * The rows whose on-hand figure a till recomputes after absorbing a batch.
 *
 * `product_stock` is a CACHE of the movement ledger (ADR-0004) and is never
 * replicated: a cached total on the wire would be a second answer to a question
 * that already has one (ADR-0015 §3). So the applier records movements and then
 * rebuilds the cache for the products it touched — which is also what makes
 * `pnpm db:audit` a check that replication landed.
 */
export const CACHE_REBUILD_TRIGGER: readonly string[] = ["stock_movement", "unit"];

/**
 * Entities whose arrival means a DERIVED column has to be recomputed.
 *
 * Same rule as the stock cache, and for the same reason: a repair's status and
 * a voucher's balance are computed from facts, never assigned (ADR-0014 §1,
 * ADR-0023 §4). A status or a balance on the wire would be a second answer to a
 * question that already has one, and the two would disagree the first time a
 * batch arrived out of order.
 *
 * So the applier takes the FACTS from the batch and works the answer out
 * locally, which is also what lets `db:audit` double as the check that
 * replication landed.
 */
export const DERIVED_AFTER_ABSORB: Readonly<Record<string, "repair" | "voucher">> = Object.freeze({
  repair_ticket: "repair",
  repair_line: "repair",
  repair_approval: "repair",
  repair_notification: "repair",
  store_credit_voucher: "voucher",
  voucher_redemption: "voucher",
});
