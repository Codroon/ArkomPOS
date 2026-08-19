import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { assertTypeChangeAllowed, isLowStock, isMissingData, missingFields, TAX_RATE_BP } from "../catalog";

const complete = {
  barcode: "2012345678905",
  groupId: "g1",
  costCents: 100,
  priceCents: 200,
  taxRegime: "IVA21",
};

describe("missingFields (req 3.3)", () => {
  it("returns nothing for a complete row", () => {
    expect(missingFields(complete)).toEqual([]);
    expect(isMissingData(complete)).toBe(false);
  });

  it("flags each NULL field individually", () => {
    expect(missingFields({ ...complete, barcode: null })).toEqual(["barcode"]);
    expect(missingFields({ ...complete, groupId: null })).toEqual(["group"]);
    expect(missingFields({ ...complete, costCents: null })).toEqual(["cost"]);
    expect(missingFields({ ...complete, priceCents: null })).toEqual(["price"]);
    expect(missingFields({ ...complete, taxRegime: null })).toEqual(["tax"]);
  });

  it("flags combinations (seed's Hub: cost + tax)", () => {
    expect(missingFields({ ...complete, costCents: null, taxRegime: null })).toEqual(["cost", "tax"]);
  });
});

describe("isLowStock (PRD 5.2: qty ≤ reorder)", () => {
  it.each([
    [{ onHand: 2, reorderPoint: 5 }, true],
    [{ onHand: 5, reorderPoint: 5 }, true], // boundary: equal is low
    [{ onHand: 6, reorderPoint: 5 }, false],
    [{ onHand: 0, reorderPoint: 0 }, false], // reorder 0 = not tracked
    [{ onHand: 0, reorderPoint: 1 }, true],
  ])("%o → %s", (input, expected) => {
    expect(isLowStock(input)).toBe(expected);
  });
});

describe("assertTypeChangeAllowed (req 4.3)", () => {
  it("allows keeping the type regardless of stock", () => {
    expect(() =>
      assertTypeChangeAllowed({ fromType: "stocked", toType: "stocked", onHand: 99, unitCount: 0 }),
    ).not.toThrow();
  });

  it("blocks stocked → serialized while quantity stock exists (typed, field itemType)", () => {
    try {
      assertTypeChangeAllowed({ fromType: "stocked", toType: "serialized", onHand: 3, unitCount: 0 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).ipc).toMatchObject({ code: "VALIDATION", field: "itemType" });
      expect((err as AppError).ipc.message).toBe("Tiene stock por cantidad; no se puede serializar.");
    }
  });

  it("blocks serialized → stocked once units exist", () => {
    expect(() =>
      assertTypeChangeAllowed({ fromType: "serialized", toType: "stocked", onHand: 0, unitCount: 2 }),
    ).toThrow(AppError);
  });

  it("allows the switch when nothing physical exists yet", () => {
    expect(() =>
      assertTypeChangeAllowed({ fromType: "stocked", toType: "serialized", onHand: 0, unitCount: 0 }),
    ).not.toThrow();
    expect(() =>
      assertTypeChangeAllowed({ fromType: "serialized", toType: "stocked", onHand: 0, unitCount: 0 }),
    ).not.toThrow();
  });
});

describe("TAX_RATE_BP", () => {
  it("maps IVA21 to 2100 basis points (ADR-0006)", () => {
    expect(TAX_RATE_BP.IVA21).toBe(2100);
  });
});
