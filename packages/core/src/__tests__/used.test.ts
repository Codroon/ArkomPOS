import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARGIN_PCT,
  assertGatePassed,
  assertRedeemable,
  assertVoidable,
  checkRedeemable,
  evaluateGate,
  expectedStockInCount,
  isUsedProductName,
  planIntake,
  redeemPlan,
  suggestedSellPriceCents,
  unitCostCents,
  usedDeviceState,
  usedProductName,
  type VoucherLike,
} from "../used";
import { AppError } from "../errors";
import { applyMovements } from "../ledger";
import { imeiWithCheckDigit } from "../imei";

const IMEI = imeiWithCheckDigit("35209411880318");
const OTHER = imeiWithCheckDigit("86123456789012");

function gate(over: Partial<Parameters<typeof evaluateGate>[0]> = {}) {
  return evaluateGate({ imei: IMEI, confirmed: true, ...over });
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.ipc.code : `not-an-AppError: ${String(error)}`;
  }
  return "did-not-throw";
}

describe("used product identity", () => {
  it("files one product per brand+model+storage+colour", () => {
    const a = usedProductName({ brand: "Apple", model: "iPhone SE 2020", storage: "64GB", color: "Blanco" });
    const b = usedProductName({ brand: " Apple ", model: "iPhone SE 2020", storage: "64GB", color: "Blanco" });
    expect(a).toBe("Apple iPhone SE 2020 64GB Blanco (usado)");
    // two intakes of the same model must land on the SAME product, not two
    expect(b).toBe(a);
  });

  it("differs by storage and colour, so a 128GB is not filed as a 64GB", () => {
    const base = { brand: "Apple", model: "iPhone SE 2020", color: "Blanco" };
    expect(usedProductName({ ...base, storage: "64GB" })).not.toBe(
      usedProductName({ ...base, storage: "128GB" }),
    );
  });

  it("survives missing optional attributes", () => {
    expect(usedProductName({ brand: "Xiaomi", model: "Redmi 9" })).toBe("Xiaomi Redmi 9 (usado)");
    expect(usedProductName({ brand: "Xiaomi", model: "Redmi 9", storage: "", color: null })).toBe(
      "Xiaomi Redmi 9 (usado)",
    );
  });

  it("marks its own products so Catálogo can hide them", () => {
    expect(isUsedProductName(usedProductName({ brand: "Apple", model: "iPhone 11" }))).toBe(true);
    expect(isUsedProductName("Funda iPhone 11")).toBe(false);
  });
});

describe("the IMEI gate", () => {
  it("rejects a bad check digit with the same rule serialized entry uses", () => {
    const result = gate({ imei: "352094118803181" });
    expect(result.rejection).toBe("format");
    expect(result.passed).toBe(false);
    expect(code(() => assertGatePassed(result))).toBe("VALIDATION");
  });

  it("rejects a device already held as a unit", () => {
    const result = gate({ existingUnitId: "u-1" });
    expect(result.rejection).toBe("duplicate_unit");
    expect(code(() => assertGatePassed(result))).toBe("DUPLICATE_IMEI");
  });

  it("rejects a device with an earlier purchase still open", () => {
    // the phone is in the drawer on hold; it cannot be bought a second time
    const result = gate({ existingPurchaseId: "p-1" });
    expect(result.rejection).toBe("duplicate_purchase");
    expect(code(() => assertGatePassed(result))).toBe("DUPLICATE_IMEI");
  });

  it("holds the gate shut on a valid, unique IMEI until a human confirms", () => {
    const result = gate({ confirmed: false });
    expect(result.imeiOk).toBe(true);
    expect(result.rejection).toBeNull();
    expect(result.passed).toBe(false);
    // the message names the checkbox, not the IMEI — the IMEI is fine
    expect(code(() => assertGatePassed(result))).toBe("VALIDATION");
  });

  it("passes only with a valid, unique IMEI and the confirmation", () => {
    const result = gate({ imei: OTHER });
    expect(result.passed).toBe(true);
    expect(() => assertGatePassed(result)).not.toThrow();
  });
});

describe("cost and price", () => {
  it("folds refurbishment into the unit cost", () => {
    expect(unitCostCents(8000)).toBe(8000);
    expect(unitCostCents(8000, 1500)).toBe(9500);
  });

  it("refuses non-integer or negative money", () => {
    expect(code(() => unitCostCents(80.5))).toBe("VALIDATION");
    expect(code(() => unitCostCents(-1))).toBe("VALIDATION");
    expect(code(() => unitCostCents(8000, -1))).toBe("VALIDATION");
  });

  it("suggests cost + margin, rounded up to a price a shop writes on a label", () => {
    expect(suggestedSellPriceCents(8000, 25)).toBe(10000);
    // 9500 × 1.25 = 11875 → up to 11875 (already a multiple of 5)
    expect(suggestedSellPriceCents(9500, 25)).toBe(11875);
    // 8123 × 1.25 = 10153.75 → 10155, never 10150: rounding down eats the margin
    expect(suggestedSellPriceCents(8123, 25)).toBe(10155);
    expect(suggestedSellPriceCents(8123, 25) % 5).toBe(0);
  });

  it("defaults to the shipped margin", () => {
    expect(DEFAULT_MARGIN_PCT).toBe(25);
    expect(suggestedSellPriceCents(8000)).toBe(suggestedSellPriceCents(8000, 25));
  });
});

describe("store credit", () => {
  const issued = (over: Partial<VoucherLike> = {}): VoucherLike => ({
    status: "issued",
    amountCents: 8000,
    remainingCents: 8000,
    ...over,
  });

  it("pays a sale of equal or greater value", () => {
    expect(checkRedeemable(issued(), 8000)).toBeNull();
    expect(checkRedeemable(issued(), 12000)).toBeNull();
  });

  it("accepts a voucher larger than the ticket — the amount never refuses one", () => {
    /* This reverses the original rule (2026-08-29). Refusing 80 € of credit
       against a 50 € sale sounded protective and was simply wrong at the
       counter: the customer is owed the goods. What must not happen is a
       SILENT part-consumption, and redeemPlan is what makes it explicit. */
    expect(checkRedeemable(issued(), 5000)).toBeNull();
    expect(() => assertRedeemable(issued(), 5000)).not.toThrow();
  });

  describe("how a bigger voucher meets a smaller ticket", () => {
    it("keeps the difference on the voucher by default", () => {
      const plan = redeemPlan(issued(), 1000);
      expect(plan.tenderCents).toBe(1000);
      expect(plan.remainingAfterCents).toBe(7000);
      expect(plan.changeCents).toBe(0);
      expect(plan.coversTicket).toBe(true);
    });

    it("or pays the difference out of the drawer when the cashier says so", () => {
      const plan = redeemPlan(issued(), 1000, "pay_out");
      expect(plan.tenderCents).toBe(8000);
      expect(plan.remainingAfterCents).toBe(0);
      expect(plan.changeCents).toBe(7000);
    });

    it("neither mode ever loses a cent", () => {
      for (const mode of ["keep_rest", "pay_out"] as const) {
        const plan = redeemPlan(issued(), 1000, mode);
        // what actually settles the ticket is the same either way — the modes
        // differ only in where the difference goes, never in how much there is
        expect(plan.tenderCents - plan.changeCents).toBe(1000);
        // and the voucher's value is fully accounted for: spent, or still on it
        expect(plan.tenderCents + plan.remainingAfterCents).toBe(8000);
      }
    });
  });

  it("spends what it can against a bigger ticket, leaving nothing on it", () => {
    const plan = redeemPlan(issued(), 20000);
    expect(plan.tenderCents).toBe(8000);
    expect(plan.remainingAfterCents).toBe(0);
    expect(plan.coversTicket).toBe(false); // the rest is paid some other way
  });

  it("treats an exact match as covering the ticket with nothing left over", () => {
    const plan = redeemPlan(issued(), 8000);
    expect(plan).toEqual({
      tenderCents: 8000,
      remainingAfterCents: 0,
      changeCents: 0,
      coversTicket: true,
    });
  });

  it("still refuses a voucher that is spent or void, whatever the total", () => {
    expect(checkRedeemable(issued({ status: "redeemed", remainingCents: 0 }), 100)).toBe("not_issued");
    expect(checkRedeemable(issued({ status: "void" }), 100)).toBe("not_issued");
    expect(checkRedeemable(issued({ remainingCents: 0 }), 100)).toBe("empty");
  });

  it("refuses a second redemption", () => {
    const spent = issued({ status: "redeemed", remainingCents: 0 });
    expect(checkRedeemable(spent, 20000)).toBe("not_issued");
    expect(code(() => assertRedeemable(spent, 20000))).toBe("VALIDATION");
  });

  it("refuses a partly-spent voucher only once it is empty", () => {
    // 30 € left on an 80 € voucher is still 30 € the shop owes
    expect(checkRedeemable(issued({ remainingCents: 3000 }), 20000)).toBeNull();
    expect(redeemPlan(issued({ remainingCents: 3000 }), 20000).tenderCents).toBe(3000);
  });

  it("refuses a voided voucher", () => {
    expect(checkRedeemable(issued({ status: "void" }), 20000)).toBe("not_issued");
  });

  it("voids only from issued, and only with a reason", () => {
    expect(() => assertVoidable(issued(), "emitido por error")).not.toThrow();
    expect(code(() => assertVoidable(issued(), "   "))).toBe("VALIDATION");
    expect(code(() => assertVoidable(issued({ status: "redeemed" }), "x"))).toBe("VALIDATION");
    expect(code(() => assertVoidable(issued({ status: "void" }), "x"))).toBe("VALIDATION");
  });
});

describe("status", () => {
  it("derives the chip the list shows", () => {
    expect(usedDeviceState("held", false)).toBe("held");
    expect(usedDeviceState("held", true)).toBe("needs_review");
    expect(usedDeviceState("in_stock", false)).toBe("in_stock");
    // a sold device is sold whatever review flag it carries
    expect(usedDeviceState("sold", true)).toBe("sold");
  });
});

describe("unit status and the ledger can never disagree", () => {
  const base = {
    productId: "p-1",
    locationId: "l-1",
    unitId: "u-1",
    buyPriceCents: 8000,
  };

  it("a held unit has zero stock movements", () => {
    const plan = planIntake({ ...base, target: "held" });
    expect(plan.unitStatus).toBe("held");
    expect(plan.movements).toHaveLength(0);
    expect(plan.movements).toHaveLength(expectedStockInCount(plan.unitStatus));
    expect(plan.unitCostCents).toBeNull();
    // and on-hand stays where it was: the ledger has never heard of this phone
    expect(applyMovements({ "p-1|l-1": 0 }, plan.movements)).toEqual({ "p-1|l-1": 0 });
  });

  it("an in-stock unit has exactly one stock-in", () => {
    const plan = planIntake({ ...base, target: "in_stock", refurbCostCents: 1500 });
    expect(plan.unitStatus).toBe("in_stock");
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements).toHaveLength(expectedStockInCount(plan.unitStatus));

    const movement = plan.movements[0]!;
    expect(movement.movementType).toBe("tradein_in");
    expect(movement.qty).toBe(1);
    expect(movement.unitId).toBe("u-1");
    expect(movement.unitCostCents).toBe(9500);
    expect(plan.unitCostCents).toBe(9500);
    expect(applyMovements({ "p-1|l-1": 0 }, plan.movements)).toEqual({ "p-1|l-1": 1 });
  });

  it("holding then shelving posts one movement in total, not two", () => {
    // the real sequence: bought on hold today, sent to inventory on Friday
    const held = planIntake({ ...base, target: "held" });
    const shelved = planIntake({ ...base, target: "in_stock" });
    const all = [...held.movements, ...shelved.movements];
    expect(all).toHaveLength(1);
    expect(applyMovements({}, all)).toEqual({ "p-1|l-1": 1 });
  });

  it("refuses to plan an intake with impossible money", () => {
    expect(code(() => planIntake({ ...base, target: "in_stock", buyPriceCents: -1 }))).toBe("VALIDATION");
  });
});
