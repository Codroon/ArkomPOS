/**
 * Absorbing another till's writes — ADR-0022 §5–7.
 *
 * The expensive mistakes in this file, in order:
 *
 *  1. **An oplog entry written while absorbing.** It would be pushed, pulled by
 *     the till that wrote the row in the first place, absorbed, pushed again —
 *     an echo between two machines that never stops. Silent, permanent, and it
 *     grows a shop's database until something falls over.
 *  2. **Grouping on `after.id`.** The till pushes CHANGES, so a payload can be
 *     `{priceCents}` with no id in it. Keying on the payload collapses every
 *     partial entry into one group; in a read model that shows twenty devices
 *     as one, and here it would WRITE them to one row.
 *  3. **Losing a delete to the fold.** `foldEntries()` skips a null payload, so
 *     create-then-delete must not fold to "created".
 *  4. **One transaction for the batch.** A single row that can never land would
 *     roll back every good row beside it, on every pass, forever.
 */
import { describe, expect, it } from "vitest";
import { absorb, planAbsorb, type AbsorbPlan, type AbsorbRunner, type InboxEntry } from "../absorb";
import { SHARED_ENTITIES } from "../share";

let n = 0;

function entry(over: Partial<InboxEntry> = {}): InboxEntry {
  n += 1;
  return {
    opId: `op-${n}`,
    ingestSeq: n,
    tenantId: "shop-1",
    locationId: "loc-1",
    terminalId: "term-1",
    entity: "product",
    entityId: "prod-1",
    action: "update",
    before: null,
    after: { name: "Funda" },
    userId: null,
    authorizedByUserId: null,
    createdAtMs: 1_000 + n,
    ...over,
  };
}

/** A runner over a fake transaction that counts a fake oplog. */
function runner(opts: { oplogGrowsBy?: number } = {}) {
  const calls: AbsorbPlan[] = [];
  let oplog = 0;
  const impl: AbsorbRunner<{ ok: true }> = {
    transaction(fn) {
      const snapshot = oplog;
      try {
        return fn({ ok: true });
      } catch (err) {
        oplog = snapshot; /* a rollback restores it, as sqlite would */
        throw err;
      }
    },
    oplogCount: () => oplog,
  };
  const write = (_tx: { ok: true }, plan: AbsorbPlan) => {
    calls.push(plan);
    oplog += opts.oplogGrowsBy ?? 0;
  };
  return { impl, write, calls, oplogAt: () => oplog };
}

describe("the rule that stops an echo (§6)", () => {
  it("applies a row when nothing was logged", () => {
    const { impl, write } = runner();
    const report = absorb(impl, planAbsorb([entry()]), write);
    expect(report.applied).toBe(1);
    expect(report.deferred).toBe(0);
  });

  it("REFUSES a write that logged an oplog entry", () => {
    const { impl, write } = runner({ oplogGrowsBy: 1 });
    const report = absorb(impl, planAbsorb([entry()]), write);

    expect(report.applied).toBe(0);
    expect(report.deferred).toBe(1);
    expect(Object.values(report.reasons)[0]).toContain("ADR-0022 §6");
  });

  it("rolls the oplog back, so a refusal leaves nothing behind", () => {
    const { impl, write, oplogAt } = runner({ oplogGrowsBy: 3 });
    absorb(impl, planAbsorb([entry()]), write);
    expect(oplogAt()).toBe(0);
  });

  it("names the row, because a developer reading this needs to know which writer", () => {
    const { impl, write } = runner({ oplogGrowsBy: 1 });
    const report = absorb(impl, planAbsorb([entry({ entity: "supplier", entityId: "sup-9" })]), write);
    expect(Object.values(report.reasons)[0]).toContain("supplier/sup-9");
  });
});

describe("grouping is by entity_id, never by the payload's id (§5)", () => {
  it("folds partial payloads for the same row into one plan", () => {
    const plans = planAbsorb([
      entry({ entityId: "prod-1", after: { id: "prod-1", name: "Funda", priceCents: 1000 }, createdAtMs: 100 }),
      entry({ entityId: "prod-1", after: { priceCents: 1500 }, createdAtMs: 200 }),
    ]);

    expect(plans).toHaveLength(1);
    expect(plans[0]!.fields).toMatchObject({ name: "Funda", priceCents: 1500 });
  });

  it("keeps rows apart when NO payload carries an id", () => {
    /* the bug, in the direction that would write twenty devices onto one row */
    const plans = planAbsorb([
      entry({ entityId: "unit-1", entity: "unit", after: { state: "ON_SHELF" } }),
      entry({ entityId: "unit-2", entity: "unit", after: { state: "SOLD" } }),
      entry({ entityId: "unit-3", entity: "unit", after: { state: "ON_SHELF" } }),
    ]);

    expect(plans).toHaveLength(3);
    expect(plans.map((p) => p.entityId).sort()).toEqual(["unit-1", "unit-2", "unit-3"]);
  });

  it("does not merge the same id across different entities", () => {
    const plans = planAbsorb([
      entry({ entity: "product", entityId: "same-id" }),
      entry({ entity: "supplier", entityId: "same-id" }),
    ]);
    expect(plans).toHaveLength(2);
  });
});

describe("last writer wins per FIELD, by the writing till's clock (§7)", () => {
  it("keeps both edits when two tills touch different fields", () => {
    const plans = planAbsorb([
      entry({ after: { name: "Funda iPhone 14" }, createdAtMs: 500, terminalId: "term-1" }),
      entry({ after: { priceCents: 1299 }, createdAtMs: 600, terminalId: "term-2" }),
    ]);
    expect(plans[0]!.fields).toEqual({ name: "Funda iPhone 14", priceCents: 1299 });
  });

  it("resolves a collision by the clock, not by arrival", () => {
    /* the later EDIT wins even though it arrived first */
    const plans = planAbsorb([
      entry({ after: { name: "later" }, createdAtMs: 900, ingestSeq: 1 }),
      entry({ after: { name: "earlier" }, createdAtMs: 800, ingestSeq: 2 }),
    ]);
    expect(plans[0]!.fields.name).toBe("later");
  });

  it("breaks an exact tie the same way every time", () => {
    const a = entry({ opId: "op-aaa", after: { name: "A" }, createdAtMs: 1_000 });
    const b = entry({ opId: "op-bbb", after: { name: "B" }, createdAtMs: 1_000 });

    expect(planAbsorb([a, b])[0]!.fields.name).toBe("B");
    expect(planAbsorb([b, a])[0]!.fields.name).toBe("B");
  });

  it("treats null as a value, so clearing a field is not dropped", () => {
    /* a product whose group was cleared has groupId null; dropping it would
       silently restore the old group */
    const plans = planAbsorb([
      entry({ after: { groupId: "grp-1" }, createdAtMs: 100 }),
      entry({ after: { groupId: null }, createdAtMs: 200 }),
    ]);
    expect(plans[0]!.fields).toHaveProperty("groupId", null);
  });

  it("reports the newest clock as the plan's as-of, for the staleness guard", () => {
    const plans = planAbsorb([
      entry({ after: { name: "a" }, createdAtMs: 100 }),
      entry({ after: { name: "b" }, createdAtMs: 777 }),
    ]);
    expect(plans[0]!.asOfMs).toBe(777);
  });
});

describe("a delete is the latest word, not a fold (§5)", () => {
  it("survives a create in the same batch", () => {
    const plans = planAbsorb([
      entry({ action: "create", after: { id: "prod-1", name: "Funda" }, createdAtMs: 100 }),
      entry({ action: "delete", before: { id: "prod-1" }, after: null, createdAtMs: 200 }),
    ]);
    expect(plans[0]!.deleted).toBe(true);
  });

  it("loses to a later re-creation", () => {
    const plans = planAbsorb([
      entry({ action: "delete", before: { id: "prod-1" }, after: null, createdAtMs: 100 }),
      entry({ action: "create", after: { id: "prod-1", name: "Funda" }, createdAtMs: 200 }),
    ]);
    expect(plans[0]!.deleted).toBe(false);
    expect(plans[0]!.fields.name).toBe("Funda");
  });

  it("is not confused by an ARCHIVE, which keeps its row", () => {
    const plans = planAbsorb([
      entry({ action: "archive", before: { id: "p" }, after: { id: "p", archivedAt: 1_700 } }),
    ]);
    expect(plans[0]!.deleted).toBe(false);
    expect(plans[0]!.fields.archivedAt).toBe(1_700);
  });
});

describe("apply order is the order sqlite will accept (§1)", () => {
  it("lands a parent before the row that references it", () => {
    const plans = planAbsorb([
      entry({ entity: "stock_movement", entityId: "mv-1" }),
      entry({ entity: "product_code", entityId: "code-1" }),
      entry({ entity: "product", entityId: "prod-1" }),
      entry({ entity: "product_group", entityId: "grp-1" }),
      entry({ entity: "unit", entityId: "unit-1" }),
      entry({ entity: "supplier", entityId: "sup-1" }),
      entry({ entity: "customer", entityId: "cus-1" }),
    ]);

    expect(plans.map((p) => p.entity)).toEqual([...SHARED_ENTITIES]);
  });

  it("keeps arrival order within one entity", () => {
    const plans = planAbsorb([
      entry({ entity: "product", entityId: "c", ingestSeq: 30 }),
      entry({ entity: "product", entityId: "a", ingestSeq: 10 }),
      entry({ entity: "product", entityId: "b", ingestSeq: 20 }),
    ]);
    expect(plans.map((p) => p.entityId)).toEqual(["a", "b", "c"]);
  });

  it("puts an unknown entity last rather than first", () => {
    /* defensive: the pull filters to the shared list, so this should never
       arrive. If it does, it must not jump the queue ahead of a product. */
    const plans = planAbsorb([
      entry({ entity: "something_from_the_future", entityId: "x" }),
      entry({ entity: "product_group", entityId: "grp-1" }),
    ]);
    expect(plans[0]!.entity).toBe("product_group");
  });
});

describe("one transaction per row (§5)", () => {
  it("lets the good rows through when one cannot land", () => {
    const calls: string[] = [];
    let oplog = 0;
    const impl: AbsorbRunner<null> = {
      transaction: (fn) => fn(null),
      oplogCount: () => oplog,
    };

    const report = absorb(
      impl,
      planAbsorb([
        entry({ entity: "product", entityId: "good-1" }),
        entry({ entity: "unit", entityId: "orphan" }),
        entry({ entity: "customer", entityId: "good-2" }),
      ]),
      (_tx, plan) => {
        if (plan.entityId === "orphan") throw new Error("FOREIGN KEY constraint failed");
        calls.push(plan.entityId);
      },
    );

    expect(report.applied).toBe(2);
    expect(report.deferred).toBe(1);
    expect(calls.sort()).toEqual(["good-1", "good-2"]);
  });

  it("records WHY a row was deferred, against every op that fed it", () => {
    const impl: AbsorbRunner<null> = { transaction: (fn) => fn(null), oplogCount: () => 0 };
    const plans = planAbsorb([
      entry({ opId: "op-x", entityId: "prod-1", after: { name: "a" }, createdAtMs: 10 }),
      entry({ opId: "op-y", entityId: "prod-1", after: { priceCents: 1 }, createdAtMs: 20 }),
    ]);

    const report = absorb(impl, plans, () => {
      throw new Error("FOREIGN KEY constraint failed");
    });

    expect(report.reasons["op-x"]).toContain("FOREIGN KEY");
    expect(report.reasons["op-y"]).toContain("FOREIGN KEY");
  });

  it("is a no-op on an empty batch", () => {
    const impl: AbsorbRunner<null> = { transaction: (fn) => fn(null), oplogCount: () => 0 };
    expect(absorb(impl, planAbsorb([]), () => {})).toEqual({ applied: 0, deferred: 0, reasons: {} });
  });
});
