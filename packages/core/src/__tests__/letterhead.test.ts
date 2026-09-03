/**
 * One layout contract for every piece of paper this till prints — v0.18.1.
 *
 * Written against a photograph of a real receipt from the shop's Citizen:
 * ticket T1-000001, 80 mm, whose footer came out as "Tu Unico Punto Tecnologi"
 * — cut mid-word, with nothing on a second line. A receipt that stops in the
 * middle of the shop's own name is the shop looking careless to its customer,
 * and it is the one part of the ticket nobody proof-reads because it is the
 * part nobody typed twice.
 *
 * So the rule, asserted here for every document type at both widths: the shop's
 * block and the footer are CENTRED, and a line too long for the roll WRAPS.
 * Nothing is ever cut. Content differs per document; the layout does not.
 */
import { describe, expect, it } from "vitest";
import { COLUMNS_BY_PAPER, opsToText, type PaperWidthMm, type TicketOp } from "../print-ops";
import { renderTicket, shopHeaderLines, type ShopProfile, type TicketDoc } from "../ticket";
import { renderIntakeReceipt, type IntakeReceiptDoc, type RepairDocDevice } from "../repair-doc";
import { renderPurchaseDoc, type PurchaseDoc } from "../purchase-doc";
import { renderZReport, type ShiftReportDoc } from "../shift-doc";
import { computeShiftTotals, type ShiftFacts } from "../shift";

/**
 * The shop from the photograph, with the names at the length that broke it:
 * a legal name and an address that do not fit 58 mm, and the footer that was
 * cut on 80 mm paper.
 */
const SHOP: ShopProfile = {
  legalName: "Arkom Electronics Barcelona Sociedad Limitada",
  displayName: "Arkom Sant Andreu",
  nif: "B15987870",
  address: "Carrer Turó de la Trinitat 25, Bajos, Sant Andreu",
  postalCode: "08033",
  city: "Barcelona",
  phone: "934 000 111",
  footerLine: "Tu Único Punto Tecnológico en el barrio desde 2011",
};

const WIDTHS: PaperWidthMm[] = [80, 58];

/* ------------------------------------------------------------- documents */

const TICKET: TicketDoc = {
  docNumber: "T1-000001",
  completedAtMs: Date.UTC(2026, 7, 26, 17, 48),
  terminalName: "Caja 1",
  isCopy: false,
  vatRateBp: 2100,
  lines: [
    {
      description: "Funda transparente iPhone 13",
      qty: 2,
      unitPriceCents: 1290,
      totalCents: 2580,
      imei: null,
      priceOverridden: false,
    },
  ],
  subtotalCents: 2132,
  taxCents: 448,
  totalCents: 2580,
  tenders: [
    { method: "cash", amountCents: 1300, cardReference: null },
    { method: "card", amountCents: 500, cardReference: "78799" },
    { method: "bizum", amountCents: 780, cardReference: null },
  ],
  changeCents: 0,
};

const REFUND: TicketDoc = { ...TICKET, docNumber: "D1-000004", refundOf: "T1-000001" };

const DEVICE: RepairDocDevice = {
  description: "Apple iPhone 11 64GB",
  imei: "356938104420030",
  reportedFault: "Pantalla rota",
  conditionAtIntake: null,
  damage: { screen: true, back: false, dents: false, water: false },
  damageNote: null,
  accessories: null,
};

const INTAKE: IntakeReceiptDoc = {
  docNumber: "R-000042",
  receivedAtMs: Date.UTC(2026, 7, 26, 17, 48),
  terminalName: "Caja 1",
  cashierName: "Ana",
  isCopy: false,
  customerName: "Joan Puig",
  customerPhone: "+34 671 220 918",
  device: DEVICE,
  depositCents: 0,
  authorizedCapCents: null,
  diagnosisFeeCents: 0,
  warrantyMonths: 3,
  promisedAtMs: null,
  promisedHalf: null,
};

const PURCHASE: PurchaseDoc = {
  docNumber: "C-000009",
  purchasedAtMs: Date.UTC(2026, 7, 26, 17, 48),
  terminalName: "Caja 1",
  cashierName: "Ana",
  isCopy: false,
  seller: { name: "Imran Khan", idType: "DNI", idNumber: "Y2841170F", phone: null, channel: "private_individual" },
  device: {
    brand: "Apple",
    model: "iPhone SE 2020",
    storage: "64GB",
    color: "Blanco",
    grade: "B",
    imei: "351234567890123",
    batteryPct: 86,
    accessories: { charger: true, box: false, cable: true, case: false },
  },
  buyPriceCents: 8000,
  payout: "cash",
  payoutReference: null,
  voucherNumber: null,
};

const facts: ShiftFacts = {
  openingFloatCents: 20000,
  documents: [],
  movements: [],
  deposits: [],
  payouts: [],
  parkedCount: 0,
  repairsCollectedCount: 0,
};

const Z: ShiftReportDoc = {
  zDocNumber: "Z1-000007",
  terminalName: "Caja 1",
  openedAtMs: Date.UTC(2026, 7, 26, 6, 32),
  openedByName: "Ahmer",
  closedAtMs: Date.UTC(2026, 7, 26, 19, 4),
  closedByName: "Ana",
  printedAtMs: Date.UTC(2026, 7, 26, 19, 5),
  isCopy: false,
  totals: computeShiftTotals(facts),
  countedCashCents: 20000,
  varianceCents: 0,
  varianceReason: null,
  approvedByName: null,
};

/** Every document type that carries the shop's block, by the name it prints under. */
const DOCUMENTS: Array<{ name: string; render: (w: PaperWidthMm) => TicketOp[] }> = [
  { name: "sale ticket", render: (w) => renderTicket(TICKET, SHOP, w) },
  { name: "refund", render: (w) => renderTicket(REFUND, SHOP, w) },
  { name: "repair intake", render: (w) => renderIntakeReceipt(INTAKE, SHOP, w) },
  { name: "used purchase", render: (w) => renderPurchaseDoc(PURCHASE, SHOP, w) },
  { name: "Z report", render: (w) => renderZReport(Z, SHOP, w, "es") },
];

/** The characters, whitespace removed — what wrapping is allowed to change. */
const squash = (s: string) => s.replace(/\s+/g, "");

/* ------------------------------------------------------ the whole contract */

describe.each(DOCUMENTS)("$name", ({ render }) => {
  describe.each(WIDTHS)("on %dmm paper", (width) => {
    const cols = COLUMNS_BY_PAPER[width];
    const ops = render(width);
    const lines = opsToText(ops, width).split("\n");

    it("never prints a line wider than the roll", () => {
      // the ✂ marker is how the screen preview draws the cut, not printed
      for (const line of lines.filter((l) => !l.includes("✂"))) {
        expect(line.length, JSON.stringify(line)).toBeLessThanOrEqual(cols);
      }
    });

    it("wraps the shop's block instead of cutting it", () => {
      const everything = squash(lines.join(""));
      for (const part of shopHeaderLines(SHOP)) {
        expect(everything, `missing from the ${width}mm paper: ${part}`).toContain(squash(part));
      }
    });

    it("centres every line of the shop's block", () => {
      /* a centred line has the same room on both sides, give or take the odd
         column — which is what "off-centre" meant on the photograph */
      const header = shopHeaderLines(SHOP).flatMap((part) =>
        lines.filter((l) => l.trim() !== "" && squash(part).includes(squash(l))),
      );
      expect(header.length).toBeGreaterThan(0);
      for (const line of header) {
        const left = line.length - line.trimStart().length;
        const right = cols - line.trimEnd().length;
        expect(Math.abs(left - right), JSON.stringify(line)).toBeLessThanOrEqual(1);
      }
    });

    it("emits the shop's block through the shared centred path, never as a raw line", () => {
      /* the finding this pins: a document type that builds its own header is
         one release away from being off-centre on its own */
      const headerOps = ops.filter(
        (op): op is Extract<TicketOp, { op: "text" }> =>
          op.op === "text" && shopHeaderLines(SHOP).some((part) => squash(part).includes(squash(op.text)) && op.text.trim() !== ""),
      );
      expect(headerOps.length).toBeGreaterThan(0);
      for (const op of headerOps) expect(op.align).toBe("center");
    });
  });
});

/* ------------------------------------------------- the line that was cut */

describe("the footer that came out of the client's printer cut", () => {
  it.each(WIDTHS)("wraps and stays centred on %dmm, on the sale ticket", (width) => {
    const cols = COLUMNS_BY_PAPER[width];
    const lines = opsToText(renderTicket(TICKET, SHOP, width), width).split("\n");
    const footer = lines.filter((l) => squash(SHOP.footerLine).includes(squash(l)) && l.trim() !== "");

    // it did not fit on one line, so it is on more than one — and all of it is there
    expect(footer.length).toBeGreaterThan(1);
    expect(squash(footer.join(""))).toBe(squash(SHOP.footerLine));
    for (const line of footer) {
      const left = line.length - line.trimStart().length;
      const right = cols - line.trimEnd().length;
      expect(Math.abs(left - right), JSON.stringify(line)).toBeLessThanOrEqual(1);
    }
    // and nothing anywhere ends in the cut the photograph showed
    expect(lines.join("\n")).not.toContain("Tecnologi\n");
  });

  it("lays the whole ticket out the same way every time", () => {
    for (const width of WIDTHS) {
      expect(opsToText(renderTicket(TICKET, SHOP, width), width)).toMatchSnapshot(`ticket-${width}mm`);
    }
  });

  it("lays a refund, an intake and a Z out the same way every time", () => {
    for (const width of WIDTHS) {
      expect(opsToText(renderTicket(REFUND, SHOP, width), width)).toMatchSnapshot(`refund-${width}mm`);
      expect(opsToText(renderIntakeReceipt(INTAKE, SHOP, width), width)).toMatchSnapshot(`intake-${width}mm`);
      expect(opsToText(renderZReport(Z, SHOP, width, "es"), width)).toMatchSnapshot(`z-${width}mm`);
    }
  });
});
