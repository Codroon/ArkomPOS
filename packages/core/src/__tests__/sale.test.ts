import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import {
  allocateNumber,
  computeDocumentTotals,
  computeLine,
  roundHalfUpDiv,
  tenderSummary,
  validateCompletion,
  type TenderDraft,
} from "../sale";

describe("computeLine — IVA-inclusive PVP, half-up base split (ADR-0006/0007)", () => {
  // hand-computed: base = halfUp(total × 10000 / 12100)
  it.each([
    // [qty, pvp, expected base, expected tax, expected total]
    [1, 1290, 1066, 224, 1290], // 12,90 € → 10,66 + 2,24
    [1, 990, 818, 172, 990], // 9,90 € → 8,18 + 1,72
    [3, 999, 2477, 520, 2997], // 3 × 9,99 → base halfUp(2476.86) = 2477
    [1, 5, 4, 1, 5], // 0,05 € → 0,04 + 0,01
    [1, 1, 1, 0, 1], // 0,01 € → base halfUp(0.826) = 1, tax 0
    [2, 18900, 31240, 6560, 37800], // 2 × 189,00 → halfUp(31239.67) = 31240
    [1, 121, 100, 21, 121], // exact division: 1,21 → 1,00 + 0,21
  ])("qty %d × %d cents → base %d + tax %d = %d", (qty, pvp, base, tax, total) => {
    expect(computeLine({ qty, unitPriceCents: pvp, taxRateBp: 2100 })).toEqual({
      baseCents: base,
      taxCents: tax,
      totalCents: total,
    });
  });

  it("half-up rounds ties upward", () => {
    // find via the raw division helper: 605/2 → 302.5 → 303
    expect(roundHalfUpDiv(605, 2)).toBe(303);
    expect(roundHalfUpDiv(604, 2)).toBe(302);
  });

  it("base + tax always reconstruct the exact total (sweep)", () => {
    for (let pvp = 1; pvp <= 3000; pvp += 7) {
      for (const qty of [1, 2, 5]) {
        const line = computeLine({ qty, unitPriceCents: pvp, taxRateBp: 2100 });
        expect(line.baseCents + line.taxCents).toBe(line.totalCents);
        expect(line.totalCents).toBe(qty * pvp);
      }
    }
  });

  it("rejects malformed inputs with typed field errors", () => {
    expect(() => computeLine({ qty: 0, unitPriceCents: 100, taxRateBp: 2100 })).toThrow(AppError);
    expect(() => computeLine({ qty: 1.5, unitPriceCents: 100, taxRateBp: 2100 })).toThrow(AppError);
    expect(() => computeLine({ qty: 1, unitPriceCents: -1, taxRateBp: 2100 })).toThrow(AppError);
  });
});

describe("computeDocumentTotals — exact Σ of line totals", () => {
  it("matches hand-computed sums and never re-rounds", () => {
    const lines = [
      computeLine({ qty: 1, unitPriceCents: 1290, taxRateBp: 2100 }),
      computeLine({ qty: 3, unitPriceCents: 999, taxRateBp: 2100 }),
      computeLine({ qty: 1, unitPriceCents: 5, taxRateBp: 2100 }),
    ];
    const totals = computeDocumentTotals(lines);
    expect(totals).toEqual({
      subtotalCents: 1066 + 2477 + 4,
      taxCents: 224 + 520 + 1,
      totalCents: 1290 + 2997 + 5,
    });
    expect(totals.subtotalCents + totals.taxCents).toBe(totals.totalCents);
  });

  it("is empty-safe", () => {
    expect(computeDocumentTotals([])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });
});

describe("tenderSummary — remaining / change (req 2.5)", () => {
  const cash = (amountCents: number): TenderDraft => ({ method: "cash", amountCents });
  const card = (amountCents: number, ref = "REF123"): TenderDraft => ({
    method: "card",
    amountCents,
    cardReference: ref,
  });

  it("tracks remaining while tenders accumulate", () => {
    expect(tenderSummary(5000, []).remainingCents).toBe(5000);
    expect(tenderSummary(5000, [card(2000)]).remainingCents).toBe(3000);
    expect(tenderSummary(5000, [card(2000), cash(3000)]).remainingCents).toBe(0);
  });

  it("computes change only on cash over-tender", () => {
    const s = tenderSummary(4180, [cash(5000)]);
    expect(s.changeCents).toBe(820);
    expect(s.remainingCents).toBe(0);
  });

  it("split tender: card exact portion + cash over-tender → change from cash", () => {
    const s = tenderSummary(10000, [card(6000), cash(5000)]);
    expect(s.nonCashCents).toBe(6000);
    expect(s.nonCashExcess).toBe(false);
    expect(s.changeCents).toBe(1000);
  });

  it("flags non-cash exceeding the total (no change ever)", () => {
    const s = tenderSummary(5000, [card(6000)]);
    expect(s.nonCashExcess).toBe(true);
    expect(s.changeCents).toBe(0);
  });
});

describe("validateCompletion — req 2.5/2.6", () => {
  const tenders = (...list: TenderDraft[]) => list;

  const rejects = (args: Parameters<typeof validateCompletion>[0], code: string, field?: string) => {
    try {
      validateCompletion(args);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).ipc.code).toBe(code);
      if (field) expect((err as AppError).ipc.field).toBe(field);
    }
  };

  it("accepts exact cash and returns zero change", () => {
    expect(
      validateCompletion({ lineCount: 2, totalCents: 4180, tenders: tenders({ method: "cash", amountCents: 4180 }) }),
    ).toEqual({ changeCents: 0 });
  });

  it("returns change on cash over-tender", () => {
    expect(
      validateCompletion({ lineCount: 1, totalCents: 4180, tenders: tenders({ method: "cash", amountCents: 5000 }) }),
    ).toEqual({ changeCents: 820 });
  });

  it("accepts a covering split tender", () => {
    expect(
      validateCompletion({
        lineCount: 1,
        totalCents: 10000,
        tenders: tenders(
          { method: "card", amountCents: 6000, cardReference: "A1B2" },
          { method: "bizum", amountCents: 1000 },
          { method: "cash", amountCents: 3500 },
        ),
      }),
    ).toEqual({ changeCents: 500 });
  });

  it("rejects an empty ticket, missing tenders, and shortfalls", () => {
    rejects({ lineCount: 0, totalCents: 100, tenders: tenders({ method: "cash", amountCents: 100 }) }, "VALIDATION");
    rejects({ lineCount: 1, totalCents: 100, tenders: [] }, "VALIDATION");
    rejects({ lineCount: 1, totalCents: 100, tenders: tenders({ method: "cash", amountCents: 99 }) }, "VALIDATION", "amountCents");
  });

  it("rejects non-cash exceeding due with TENDER_MISMATCH", () => {
    rejects(
      { lineCount: 1, totalCents: 5000, tenders: tenders({ method: "card", amountCents: 6000, cardReference: "XY12" }) },
      "TENDER_MISMATCH",
    );
    rejects(
      {
        lineCount: 1,
        totalCents: 5000,
        tenders: tenders({ method: "bizum", amountCents: 3000 }, { method: "transfer", amountCents: 2500 }),
      },
      "TENDER_MISMATCH",
    );
  });

  it("requires a ≥4-char reference on every card tender (req 2.6)", () => {
    rejects(
      { lineCount: 1, totalCents: 1000, tenders: tenders({ method: "card", amountCents: 1000 }) },
      "VALIDATION",
      "cardReference",
    );
    rejects(
      { lineCount: 1, totalCents: 1000, tenders: tenders({ method: "card", amountCents: 1000, cardReference: " 123 " }) },
      "VALIDATION",
      "cardReference",
    );
  });
});

describe("allocateNumber — gap-free per-till series (ADR-0008)", () => {
  it("formats prefix + 6-digit zero-pad", () => {
    const a = allocateNumber({ prefix: "T1-", nextNumber: 1 });
    expect(a.docNumber).toBe("T1-000001");
    expect(a.number).toBe(1);
    expect(a.next.nextNumber).toBe(2);
  });

  it("stays gap-free across 250 chained allocations", () => {
    let series = { prefix: "T1-", nextNumber: 1 };
    const seen: number[] = [];
    for (let i = 0; i < 250; i++) {
      const a = allocateNumber(series);
      seen.push(a.number);
      series = a.next;
    }
    expect(seen).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(allocateNumber(series).docNumber).toBe("T1-000251");
  });

  it("outgrows the pad without truncation", () => {
    expect(allocateNumber({ prefix: "T1-", nextNumber: 1234567 }).docNumber).toBe("T1-1234567");
  });

  it("rejects a corrupt series", () => {
    expect(() => allocateNumber({ prefix: "T1-", nextNumber: 0 })).toThrow(AppError);
  });
});
