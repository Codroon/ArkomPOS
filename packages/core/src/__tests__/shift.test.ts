/**
 * The drawer arithmetic.
 *
 * Every scenario below was worked out on paper first and the expected figure is
 * written as the sum that produced it, not as a magic number — a test that
 * asserts `74260` proves the code did not change, not that it is right.
 */
import { describe, expect, it } from "vitest";
import {
  DENOMINATIONS_CENTS,
  DRAWER_EFFECT,
  assertBreakdownMatches,
  breakdownTotalCents,
  computeShiftTotals,
  documentCashDelta,
  movesDrawer,
  needsVarianceApproval,
  shiftStatus,
  varianceCents,
  type ShiftDocumentFact,
  type ShiftFacts,
} from "../shift";
import type { AppError } from "../errors";

const IVA = (totalCents: number) => {
  const base = Math.floor((totalCents * 10000 + 6050) / 12100);
  return [{ taxRegime: "IVA21", baseCents: base, taxCents: totalCents - base, totalCents }];
};

function doc(over: Partial<ShiftDocumentFact> = {}): ShiftDocumentFact {
  const totalCents = over.totalCents ?? 1000;
  return {
    documentId: "d1",
    docType: "ticket",
    docNumber: "T1-000001",
    number: 1,
    totalCents,
    subtotalCents: 0,
    taxCents: 0,
    tenders: [{ method: "cash", amountCents: totalCents }],
    lines: IVA(totalCents),
    ...over,
  };
}

function facts(over: Partial<ShiftFacts> = {}): ShiftFacts {
  return {
    openingFloatCents: 0,
    documents: [],
    movements: [],
    deposits: [],
    payouts: [],
    parkedCount: 0,
    repairsCollectedCount: 0,
    ...over,
  };
}

const expected = (over: Partial<ShiftFacts> = {}) => computeShiftTotals(facts(over)).expectedCashCents;

/* ------------------------------------------------------------- status */

describe("shiftStatus", () => {
  it("is open when nobody has closed it", () => {
    expect(shiftStatus({ closedAt: null })).toBe("open");
    expect(shiftStatus({ closedAt: new Date() })).toBe("closed");
    expect(shiftStatus({ closedAt: 0 })).toBe("closed"); // epoch is a close, not a null
  });
});

/* ------------------------------------------------------- one document */

describe("what one document does to the drawer", () => {
  it("a cash sale leaves the cash, not the tender", () => {
    // 20,00 handed over for a 10,00 ticket: 10,00 stays
    expect(documentCashDelta({ totalCents: 1000, tenders: [{ method: "cash", amountCents: 2000 }] })).toBe(1000);
  });

  it("a card sale moves nothing", () => {
    expect(documentCashDelta({ totalCents: 1000, tenders: [{ method: "card", amountCents: 1000 }] })).toBe(0);
  });

  it("a split pays the change out of the cash half", () => {
    // card 6,00 + cash 5,00 on a 10,00 ticket ⇒ 1,00 change ⇒ 4,00 in the drawer
    const delta = documentCashDelta({
      totalCents: 1000,
      tenders: [{ method: "card", amountCents: 600 }, { method: "cash", amountCents: 500 }],
    });
    expect(delta).toBe(400);
  });

  it("a voucher bigger than the ticket takes cash OUT on a sale", () => {
    // the case a "sum the cash tenders" formula misses entirely: nothing was
    // tendered in cash and 5,00 was handed back (ADR-0013 §4)
    const delta = documentCashDelta({
      totalCents: 1000,
      tenders: [{ method: "store_credit", amountCents: 1500 }],
    });
    expect(delta).toBe(-500);
  });

  it("a repair collection banks only the remainder", () => {
    const delta = documentCashDelta({
      totalCents: 7900,
      tenders: [{ method: "deposit", amountCents: 2000 }, { method: "cash", amountCents: 5900 }],
    });
    expect(delta).toBe(5900);
  });

  it("counts nothing for bizum or transfer", () => {
    expect(documentCashDelta({ totalCents: 1000, tenders: [{ method: "bizum", amountCents: 1000 }] })).toBe(0);
    expect(documentCashDelta({ totalCents: 1000, tenders: [{ method: "transfer", amountCents: 1000 }] })).toBe(0);
  });
});

/* ------------------------------------------------------ drawer effect */

describe("which movements move notes", () => {
  it("classifies every reason the schema has", () => {
    // the map is total on purpose: a reason added without a decision about the
    // drawer must be a compile error, and this is its runtime companion
    expect(Object.keys(DRAWER_EFFECT).sort()).toEqual([
      "paid_in",
      "paid_out",
      "repair_deposit",
      "repair_deposit_applied",
      "repair_deposit_refund",
      "used_purchase_payout",
    ]);
  });

  it("excludes repair_deposit_applied, which moves no notes", () => {
    expect(movesDrawer("repair_deposit_applied")).toBe(false);
    expect(movesDrawer("repair_deposit")).toBe(true);
    expect(movesDrawer("used_purchase_payout")).toBe(true);
  });

  it("treats an unknown reason as not moving the drawer", () => {
    expect(movesDrawer("something_new")).toBe(false);
  });
});

/* ---------------------------------------------------- expected cash */

describe("expected cash", () => {
  it("is the float when nothing happened", () => {
    expect(expected({ openingFloatCents: 20000 })).toBe(20000);
  });

  it("adds a cash sale and its change", () => {
    // 200,00 float + (20,00 − 10,00)
    expect(
      expected({
        openingFloatCents: 20000,
        documents: [doc({ totalCents: 1000, tenders: [{ method: "cash", amountCents: 2000 }] })],
      }),
    ).toBe(20000 + 1000);
  });

  it("ignores a card sale entirely", () => {
    expect(
      expected({
        openingFloatCents: 20000,
        documents: [doc({ totalCents: 5000, tenders: [{ method: "card", amountCents: 5000 }] })],
      }),
    ).toBe(20000);
  });

  it("goes DOWN when a voucher exceeds the ticket", () => {
    expect(
      expected({
        openingFloatCents: 20000,
        documents: [doc({ totalCents: 1000, tenders: [{ method: "store_credit", amountCents: 1500 }] })],
      }),
    ).toBe(20000 - 500);
  });

  it("adds a deposit taken in cash", () => {
    expect(
      expected({
        openingFloatCents: 20000,
        movements: [{ reason: "repair_deposit", amountCents: 2000 }],
      }),
    ).toBe(20000 + 2000);
  });

  it("is unmoved when that deposit is applied at collection", () => {
    // the collection banks 59,00 in cash; the applied row is bookkeeping and
    // subtracting it would understate the drawer by exactly the deposit
    const total = expected({
      openingFloatCents: 20000,
      documents: [
        doc({
          totalCents: 7900,
          tenders: [{ method: "deposit", amountCents: 2000 }, { method: "cash", amountCents: 5900 }],
        }),
      ],
      movements: [{ reason: "repair_deposit_applied", amountCents: -2000 }],
    });
    expect(total).toBe(20000 + 5900);
  });

  it("subtracts a used-device cash payout", () => {
    expect(
      expected({ openingFloatCents: 20000, movements: [{ reason: "used_purchase_payout", amountCents: -24000 }] }),
    ).toBe(20000 - 24000);
  });

  it("adds and subtracts manual movements", () => {
    expect(
      expected({
        openingFloatCents: 20000,
        movements: [
          { reason: "paid_in", amountCents: 10000 },
          { reason: "paid_out", amountCents: -20000 },
        ],
      }),
    ).toBe(20000 + 10000 - 20000);
  });

  it("adds up a whole mixed day, hand-computed", () => {
    const totals = computeShiftTotals(
      facts({
        openingFloatCents: 20000, //                                200,00
        documents: [
          doc({ totalCents: 1000, tenders: [{ method: "cash", amountCents: 2000 }] }), //  +10,00
          doc({ totalCents: 5000, tenders: [{ method: "card", amountCents: 5000 }] }), //    0,00
          doc({ totalCents: 1000, tenders: [{ method: "store_credit", amountCents: 1500 }] }), // −5,00
          doc({
            totalCents: 7900,
            tenders: [{ method: "deposit", amountCents: 2000 }, { method: "cash", amountCents: 5900 }],
          }), //                                                     +59,00
        ],
        movements: [
          { reason: "repair_deposit", amountCents: 2000 }, //        +20,00
          { reason: "repair_deposit_applied", amountCents: -2000 }, //  0,00
          { reason: "repair_deposit_refund", amountCents: -1500 }, // −15,00
          { reason: "used_purchase_payout", amountCents: -24000 }, // −240,00
          { reason: "paid_in", amountCents: 10000 }, //             +100,00
          { reason: "paid_out", amountCents: -20000 }, //           −200,00
        ],
      }),
    );
    expect(totals.salesCashCents).toBe(1000 - 500 + 5900);
    expect(totals.movementsCashCents).toBe(2000 - 1500 - 24000 + 10000 - 20000);
    expect(totals.expectedCashCents).toBe(20000 + 6400 - 33500);
  });
});

/* --------------------------------------------------------- the Z body */

describe("the Z figures", () => {
  it("splits REBU off the taxable base, because the margin scheme prints no VAT", () => {
    const totals = computeShiftTotals(
      facts({
        documents: [
          doc({ totalCents: 12100, lines: IVA(12100) }),
          doc({
            totalCents: 24000,
            docNumber: "T1-000002",
            number: 2,
            lines: [{ taxRegime: "REBU", baseCents: 24000, taxCents: 0, totalCents: 24000 }],
            tenders: [{ method: "cash", amountCents: 24000 }],
          }),
        ],
      }),
    );
    expect(totals.netSalesCents).toBe(10000);
    expect(totals.taxCents).toBe(2100);
    expect(totals.usedSalesCents).toBe(24000);
    expect(totals.grossSalesCents).toBe(12100 + 24000);
  });

  it("balances tenders against gross once change is netted out", () => {
    const totals = computeShiftTotals(
      facts({
        documents: [
          doc({ totalCents: 1000, tenders: [{ method: "cash", amountCents: 2000 }] }),
          doc({
            totalCents: 5000,
            docNumber: "T1-000002",
            number: 2,
            tenders: [{ method: "card", amountCents: 3000 }, { method: "cash", amountCents: 2500 }],
          }),
        ],
      }),
    );
    // this must be zero for every well-formed shift; the Z prints a warning if not
    expect(totals.tenderImbalanceCents).toBe(0);
    expect(totals.tendersTotalCents).toBe(totals.grossSalesCents);
  });

  it("reports the first and last number of every series it touched", () => {
    const totals = computeShiftTotals(
      facts({
        documents: [
          doc({ docNumber: "T1-000318", number: 318 }),
          doc({ docNumber: "T1-000359", number: 359 }),
          doc({ docType: "purchase", docNumber: "C-000041", number: 41 }),
        ],
      }),
    );
    const tickets = totals.series.find((s) => s.docType === "ticket")!;
    expect([tickets.count, tickets.firstNumber, tickets.lastNumber]).toEqual([2, "T1-000318", "T1-000359"]);
    expect(totals.usedPurchaseCount).toBe(1);
  });
});

/* ------------------------------------------------------ by method */

describe("the by-method block", () => {
  const mixed = () =>
    computeShiftTotals(
      facts({
        openingFloatCents: 20000,
        documents: [
          // cash 20,00 for a 10,00 ticket: 10,00 in, 10,00 change
          doc({ totalCents: 1000, tenders: [{ method: "cash", amountCents: 2000 }] }),
          // card
          doc({ totalCents: 5000, docNumber: "T1-2", number: 2, tenders: [{ method: "card", amountCents: 5000 }] }),
          // bizum
          doc({ totalCents: 3000, docNumber: "T1-3", number: 3, tenders: [{ method: "bizum", amountCents: 3000 }] }),
        ],
        deposits: [
          { kind: "taken", method: "cash", amountCents: 2000 },
          { kind: "taken", method: "card", amountCents: 3000 },
          { kind: "refunded", method: "transfer", amountCents: 1000 },
        ],
        payouts: [
          { method: "cash", amountCents: 24000 },
          { method: "transfer", amountCents: 15000 },
        ],
        movements: [
          { reason: "repair_deposit", amountCents: 2000 },
          { reason: "used_purchase_payout", amountCents: -24000 },
          { reason: "paid_in", amountCents: 10000 },
          { reason: "paid_out", amountCents: -20000 },
        ],
      }),
    );

  it("nets each method the shop can be asked about", () => {
    const by = new Map(mixed().byMethod.map((row) => [row.method, row]));
    // cash: 10,00 sale + 20,00 deposit + 100,00 paid in − 240,00 payout − 200,00 paid out
    expect(by.get("cash")).toEqual({ method: "cash", inCents: 1000 + 2000 + 10000, outCents: 24000 + 20000, netCents: 13000 - 44000 });
    expect(by.get("card")).toEqual({ method: "card", inCents: 5000 + 3000, outCents: 0, netCents: 8000 });
    expect(by.get("bizum")).toEqual({ method: "bizum", inCents: 3000, outCents: 0, netCents: 3000 });
    // transfer never took anything in, and paid out a refund and a purchase
    expect(by.get("transfer")).toEqual({ method: "transfer", inCents: 0, outCents: 1000 + 15000, netCents: -16000 });
  });

  it("keeps the cash line equal to what the drawer says", () => {
    // the reconciliation the whole block exists for
    const totals = mixed();
    const cash = totals.byMethod.find((row) => row.method === "cash")!;
    expect(cash.netCents).toBe(totals.salesCashCents + totals.movementsCashCents);
    expect(totals.openingFloatCents + cash.netCents).toBe(totals.expectedCashCents);
  });

  it("puts a voucher's change on the OUT side of cash", () => {
    const totals = computeShiftTotals(
      facts({ documents: [doc({ totalCents: 1000, tenders: [{ method: "store_credit", amountCents: 1500 }] })] }),
    );
    const cash = totals.byMethod.find((row) => row.method === "cash")!;
    expect(cash.outCents).toBe(500);
    expect(cash.netCents).toBe(totals.salesCashCents);
  });

  it("reports deposits, refunds and payouts by method even when no cash moved", () => {
    const totals = mixed();
    expect(totals.depositsByMethod).toEqual([
      { method: "cash", count: 1, amountCents: 2000 },
      { method: "card", count: 1, amountCents: 3000 },
    ]);
    expect(totals.refundsByMethod).toEqual([{ method: "transfer", count: 1, amountCents: 1000 }]);
    expect(totals.payoutsByMethod).toEqual([
      { method: "cash", count: 1, amountCents: 24000 },
      { method: "transfer", count: 1, amountCents: 15000 },
    ]);
  });
});

/* ------------------------------------------------------ denominations */

describe("the denomination helper", () => {
  it("covers every euro note and coin, largest first", () => {
    expect(DENOMINATIONS_CENTS[0]).toBe(50000);
    expect(DENOMINATIONS_CENTS.at(-1)).toBe(1);
    expect(DENOMINATIONS_CENTS).toHaveLength(15);
  });

  it("multiplies out", () => {
    // 4×20 + 6×10 + 8×5 + 20×1 = 80 + 60 + 40 + 20
    expect(breakdownTotalCents({ "2000": 4, "1000": 6, "500": 8, "100": 20 })).toBe(20000);
  });

  it("treats an empty breakdown as zero, which is a legal float", () => {
    expect(breakdownTotalCents({})).toBe(0);
  });

  it("refuses a denomination that does not exist", () => {
    expect(() => breakdownTotalCents({ "300": 1 })).toThrow();
  });

  it("refuses a fractional or negative quantity", () => {
    expect(() => breakdownTotalCents({ "2000": 1.5 })).toThrow();
    expect(() => breakdownTotalCents({ "2000": -1 })).toThrow();
  });

  it("refuses a breakdown that disagrees with the total it explains", () => {
    // two numbers that can drift is the thing this design refuses everywhere
    expect(() => assertBreakdownMatches(20000, { "2000": 3 })).toThrow();
    const err = (() => {
      try {
        assertBreakdownMatches(20000, { "2000": 3 });
      } catch (e) {
        return (e as AppError).ipc;
      }
      return null;
    })();
    expect(err?.code).toBe("VALIDATION");
    expect(err?.field).toBe("breakdown");
  });

  it("accepts no breakdown at all — counting by hand is allowed", () => {
    expect(() => assertBreakdownMatches(20000, null)).not.toThrow();
  });
});

/* ---------------------------------------------------------- variance */

describe("variance", () => {
  it("is counted minus expected, so negative is short", () => {
    expect(varianceCents(73800, 74260)).toBe(-460);
    expect(varianceCents(74500, 74260)).toBe(240);
    expect(varianceCents(74260, 74260)).toBe(0);
  });

  it("needs approval strictly above the tolerance, in either direction", () => {
    expect(needsVarianceApproval(-460, 300)).toBe(true);
    expect(needsVarianceApproval(460, 300)).toBe(true);
    expect(needsVarianceApproval(-300, 300)).toBe(false); // exactly at tolerance is within it
    expect(needsVarianceApproval(0, 300)).toBe(false);
  });
});
