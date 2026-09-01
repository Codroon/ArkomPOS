/**
 * The Z, and the X that is the same paper without a number.
 *
 * What is asserted here is what the shop would notice if it were wrong: the
 * margin-scheme line kept out of the taxable base, the sign of the variance said
 * in words, and the things this phase does not have staying off the paper
 * entirely rather than printing as zeros.
 */
import { describe, expect, it } from "vitest";
import { SHIFT_ES, renderZReport, type ShiftReportDoc } from "../shift-doc";
import { computeShiftTotals, type ShiftFacts, type ShiftTotals } from "../shift";
import { opsToText } from "../print-ops";
import type { ShopProfile } from "../ticket";

const SHOP: ShopProfile = {
  legalName: "Arkom Electronics S.L.",
  nif: "B12345678",
  address: "C/ Mayor 14, 28013 Madrid",
  footerLine: "Precios claros. Sin letra pequeña.",
};

const IVA = (totalCents: number) => {
  const base = Math.floor((totalCents * 10000 + 6050) / 12100);
  return [{ taxRegime: "IVA21", baseCents: base, taxCents: totalCents - base, totalCents }];
};

function totals(over: Partial<ShiftFacts> = {}): ShiftTotals {
  const facts: ShiftFacts = {
    openingFloatCents: 20000,
    documents: [],
    movements: [],
    deposits: [],
    payouts: [],
    parkedCount: 0,
    repairsCollectedCount: 0,
    ...over,
  };
  return computeShiftTotals(facts);
}

function doc(over: Partial<ShiftReportDoc> = {}): ShiftReportDoc {
  return {
    zDocNumber: "Z1-000007",
    terminalName: "Caja 1",
    openedAtMs: Date.UTC(2026, 8, 1, 6, 32),
    openedByName: "Ahmer",
    closedAtMs: Date.UTC(2026, 8, 1, 19, 4),
    closedByName: "Ana",
    printedAtMs: Date.UTC(2026, 8, 1, 19, 5),
    isCopy: false,
    totals: totals(),
    countedCashCents: 20000,
    varianceCents: 0,
    varianceReason: null,
    approvedByName: null,
    ...over,
  };
}

const text = (over: Partial<ShiftReportDoc> = {}) => opsToText(renderZReport(doc(over), SHOP));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("the Z report", () => {
  it("names itself, its number and its till", () => {
    const out = text();
    expect(out).toContain(SHIFT_ES.zTitle);
    expect(out).toContain("Z1-000007");
    expect(out).toContain("Caja 1");
    expect(out).toContain("01/09/2026");
  });

  it("names who opened and who closed", () => {
    const out = text();
    expect(out).toContain("Ahmer");
    expect(out).toContain("Ana");
  });

  it("keeps the margin scheme out of the taxable base", () => {
    // REBU carries no VAT the customer may deduct (ADR-0007); folding it into
    // the base would misstate the return
    const out = text({
      totals: totals({
        documents: [
          {
            documentId: "d1",
            docType: "ticket",
            docNumber: "T1-000001",
            number: 1,
            totalCents: 24000,
            subtotalCents: 0,
            taxCents: 0,
            tenders: [{ method: "cash", amountCents: 24000 }],
            lines: [{ taxRegime: "REBU", baseCents: 24000, taxCents: 0, totalCents: 24000 }],
          },
        ],
      }),
    });
    expect(out).toContain(SHIFT_ES.used);
    expect(out).toContain("240,00 €");
    // and the VAT line stays at zero rather than claiming 21% of it
    const vatLine = out.split("\n").find((l) => l.includes(SHIFT_ES.vat))!;
    expect(vatLine).toContain("0,00 €");
  });

  it("omits the used line entirely on a day with no second-hand sale", () => {
    // a zero there would invite the question "which used sale?"
    expect(text()).not.toContain(SHIFT_ES.used);
  });

  it("prints the gap-free proof per series", () => {
    const out = text({
      totals: totals({
        documents: [318, 359].map((n) => ({
          documentId: `d${n}`,
          docType: "ticket",
          docNumber: `T1-${String(n).padStart(6, "0")}`,
          number: n,
          totalCents: 1000,
          subtotalCents: 0,
          taxCents: 0,
          tenders: [{ method: "cash", amountCents: 1000 }],
          lines: IVA(1000),
        })),
      }),
    });
    expect(flat(out)).toContain("T1-000318 → T1-000359");
  });

  it("balances tenders against gross, and says so out loud when it cannot", () => {
    const clean = text({
      totals: totals({
        documents: [
          {
            documentId: "d1",
            docType: "ticket",
            docNumber: "T1-000001",
            number: 1,
            totalCents: 1000,
            subtotalCents: 0,
            taxCents: 0,
            tenders: [{ method: "cash", amountCents: 2000 }],
            lines: IVA(1000),
          },
        ],
      }),
    });
    // this line should never appear on a well-formed shift, which is why it exists
    expect(clean).not.toContain(SHIFT_ES.imbalance);

    const broken = doc();
    const tampered: ShiftTotals = { ...broken.totals, tenderImbalanceCents: 500 };
    expect(opsToText(renderZReport({ ...broken, totals: tampered }, SHOP))).toContain(SHIFT_ES.imbalance);
  });

  it("says which way a variance went, in words", () => {
    // "−4,60 €" alone is ambiguous to everyone who did not write it
    const short = text({ countedCashCents: 19540, varianceCents: -460, varianceReason: "Cambio mal dado" });
    expect(short).toContain(SHIFT_ES.short);
    expect(short).toContain("4,60 €");
    expect(short).toContain("Cambio mal dado");

    const over = text({ countedCashCents: 20460, varianceCents: 460, varianceReason: "Sobró" });
    expect(over).toContain(SHIFT_ES.over);
    expect(over).not.toContain(SHIFT_ES.short);
  });

  it("leaves the reason and approver off a shift that balanced", () => {
    const out = text();
    expect(out).not.toContain(SHIFT_ES.reason);
    expect(out).not.toContain(SHIFT_ES.approvedBy);
  });

  it("names the approver when one was needed", () => {
    expect(text({ varianceCents: -1000, varianceReason: "Falta", approvedByName: "Ahmer" })).toContain(
      SHIFT_ES.approvedBy,
    );
  });

  it("nets each method so it can be ticked off a statement", () => {
    const out = text({
      totals: totals({
        deposits: [{ kind: "taken", method: "card", amountCents: 3000 }],
        payouts: [{ method: "transfer", amountCents: 15000 }],
      }),
    });
    expect(out).toContain("Tarjeta");
    expect(out).toContain("Transferencia");
    expect(out).toContain(SHIFT_ES.methodNet);
  });

  it("prints nothing at all about refunds or agency lines", () => {
    // features this phase does not have. A zero would be a lie of implication
    const out = text();
    expect(out).not.toContain("Devoluciones");
    expect(out).not.toContain("Agencia");
    expect(out).not.toContain("Western");
  });

  it("stamps a reprint COPIA and stays fixed Spanish", () => {
    expect(text({ isCopy: true })).toContain(SHIFT_ES.copy);
    expect(text()).toContain("EFECTIVO ESPERADO".toLowerCase() === "" ? "" : SHIFT_ES.expected);
  });
});

describe("the X preview", () => {
  const x = (over: Partial<ShiftReportDoc> = {}) =>
    text({ zDocNumber: null, closedAtMs: null, closedByName: null, countedCashCents: null, varianceCents: null, ...over });

  it("says it is provisional and consumes no number", () => {
    const out = x();
    expect(out).toContain(SHIFT_ES.xTitle);
    expect(out).toContain(SHIFT_ES.preview);
    expect(flat(out)).toContain(SHIFT_ES.xFooter);
    expect(out).not.toContain("Z1-");
  });

  it("shows the expected figure but nothing to compare it against", () => {
    const out = x();
    expect(out).toContain(SHIFT_ES.expected);
    expect(out).not.toContain(SHIFT_ES.counted);
    expect(out).not.toContain(SHIFT_ES.variance);
  });

  it("carries the same body as the Z it previews", () => {
    // it IS the same renderer over the same totals — that is the guarantee
    expect(x()).toContain(SHIFT_ES.sales);
    expect(x()).toContain(SHIFT_ES.tenders);
  });
});
