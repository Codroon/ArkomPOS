import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import {
  applyMovements,
  buildMovement,
  nextCostCents,
  stockKey,
  type MovementDraft,
  type StockLevels,
} from "../ledger";

const base = { productId: "p1", locationId: "l1" } as const;

function draft(qty: number, overrides: Partial<Parameters<typeof buildMovement>[0]> = {}): MovementDraft {
  return buildMovement({
    ...base,
    movementType: qty > 0 ? "purchase_in" : "sale_out",
    qty,
    unitCostCents: qty > 0 ? 100 : undefined,
    ...overrides,
  });
}

describe("buildMovement — sign vs type (ADR-0004)", () => {
  it("accepts a well-formed purchase_in / sale_out / adjustment", () => {
    expect(draft(5).qty).toBe(5);
    expect(draft(-2).qty).toBe(-2);
    expect(
      buildMovement({ ...base, movementType: "adjustment", qty: -1, reason: "rotura" }).reason,
    ).toBe("rotura");
  });

  const reject = (input: Parameters<typeof buildMovement>[0], field: string) => {
    try {
      buildMovement(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).ipc.code).toBe("VALIDATION");
      expect((err as AppError).ipc.field).toBe(field);
    }
  };

  it("rejects zero and non-integer quantities", () => {
    reject({ ...base, movementType: "purchase_in", qty: 0, unitCostCents: 1 }, "qty");
    reject({ ...base, movementType: "purchase_in", qty: 1.5, unitCostCents: 1 }, "qty");
  });

  it("rejects a negative purchase_in and a positive sale_out", () => {
    reject({ ...base, movementType: "purchase_in", qty: -1, unitCostCents: 1 }, "qty");
    reject({ ...base, movementType: "sale_out", qty: 1 }, "qty");
  });

  it("requires unit cost on purchase_in (req 6.2)", () => {
    reject({ ...base, movementType: "purchase_in", qty: 1 }, "unitCostCents");
    reject({ ...base, movementType: "purchase_in", qty: 1, unitCostCents: -5 }, "unitCostCents");
  });

  it("requires a reason on adjustment (req 25.3)", () => {
    reject({ ...base, movementType: "adjustment", qty: 1 }, "reason");
    reject({ ...base, movementType: "adjustment", qty: 1, reason: "   " }, "reason");
  });

  it("locks serialized movements to |qty| = 1", () => {
    reject({ ...base, movementType: "purchase_in", qty: 2, unitCostCents: 1, unitId: "u1" }, "qty");
    expect(draft(1, { unitId: "u1" }).unitId).toBe("u1");
  });
});

describe("applyMovements — negative-stock guard (req 5.3)", () => {
  const k = stockKey("p1", "l1");

  it("allows draining exactly to zero (boundary)", () => {
    expect(applyMovements({ [k]: 5 }, [draft(-5)])[k]).toBe(0);
  });

  it("rejects exactly one unit past the boundary", () => {
    expect(() => applyMovements({ [k]: 5 }, [draft(-6)])).toThrowError(AppError);
    try {
      applyMovements({ [k]: 5 }, [draft(-6)]);
    } catch (err) {
      expect((err as AppError).ipc.code).toBe("NEGATIVE_STOCK");
    }
  });

  it("judges the NET batch result, not intermediate order", () => {
    expect(applyMovements({ [k]: 0 }, [draft(-3), draft(5)])[k]).toBe(2);
  });

  it("keeps (product, location) pairs independent", () => {
    const other = stockKey("p2", "l1");
    const result = applyMovements({ [k]: 1, [other]: 0 }, [draft(-1), draft(4, { productId: "p2" })]);
    expect(result[k]).toBe(0);
    expect(result[other]).toBe(4);
  });

  it("treats unknown keys as zero on-hand", () => {
    expect(() => applyMovements({}, [draft(-1)])).toThrowError(AppError);
    expect(applyMovements({}, [draft(3)])[k]).toBe(3);
  });
});

/* -------- property-style: on-hand ≡ Σ movements across randomized batches -------- */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("property: quantities equal Σ movements (req 5.1)", () => {
  it("holds across 300 randomized multi-product batch sequences", () => {
    const rnd = lcg(42);
    for (let run = 0; run < 300; run++) {
      const products = ["a", "b", "c"].slice(0, 1 + Math.floor(rnd() * 3));
      let levels: StockLevels = {};
      const sums: Record<string, number> = {};
      const batches = 1 + Math.floor(rnd() * 5);
      for (let bi = 0; bi < batches; bi++) {
        const batch: MovementDraft[] = [];
        const size = 1 + Math.floor(rnd() * 4);
        for (let mi = 0; mi < size; mi++) {
          const productId = products[Math.floor(rnd() * products.length)]!;
          const qty = Math.floor(rnd() * 15) - 5; // bias toward inflow
          if (qty === 0) continue;
          batch.push(draft(qty, { productId }));
        }
        if (batch.length === 0) continue;
        // predict the net result per key; the guard must agree exactly
        const predicted = { ...sums };
        for (const m of batch) {
          const key = stockKey(m.productId, m.locationId);
          predicted[key] = (predicted[key] ?? 0) + m.qty;
        }
        const wouldGoNegative = Object.values(predicted).some((v) => v < 0);
        if (wouldGoNegative) {
          expect(() => applyMovements(levels, batch)).toThrowError(AppError);
          // rejected batch leaves levels untouched
        } else {
          levels = applyMovements(levels, batch);
          Object.assign(sums, predicted);
          for (const [key, sum] of Object.entries(sums)) {
            expect(levels[key] ?? 0).toBe(sum);
          }
        }
      }
    }
  });
});

describe("nextCostCents — last-cost rule (req 6.5)", () => {
  it("the entry cost always wins, including over null", () => {
    expect(nextCostCents(null, 750)).toBe(750);
    expect(nextCostCents(480, 520)).toBe(520);
    expect(nextCostCents(480, 480)).toBe(480);
  });
});
