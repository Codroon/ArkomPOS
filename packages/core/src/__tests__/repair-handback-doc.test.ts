/**
 * The receipt and the return note.
 *
 * The receipt is the only repair document that is also a fiscal one, so the IVA
 * breakdown and the tenders are asserted alongside the warranty sentence the
 * customer actually keeps it for.
 */
import { describe, expect, it } from "vitest";
import {
  REPAIR_ES,
  renderRepairReceipt,
  renderReturnDoc,
  type RepairDocDevice,
  type RepairReceiptDoc,
  type ReturnDoc,
} from "../repair-doc";
import { opsToText } from "../print-ops";
import type { ShopProfile } from "../ticket";

const SHOP: ShopProfile = {
  legalName: "Arkom Electronics S.L.",
  nif: "B12345678",
  address: "C/ Mayor 14, 28013 Madrid",
  footerLine: "Precios claros. Sin letra pequeña.",
};

const DEVICE: RepairDocDevice = {
  description: "Apple iPhone 11 64GB",
  imei: "356938104420030",
  reportedFault: "Pantalla rota",
  conditionAtIntake: null,
  damage: { screen: true, back: false, dents: false, water: false },
  damageNote: null,
  accessories: null,
};

const AT = Date.UTC(2026, 7, 20, 11, 0);
const WARRANTY_END = Date.UTC(2026, 10, 20, 11, 0);

function receipt(over: Partial<RepairReceiptDoc> = {}): RepairReceiptDoc {
  return {
    docNumber: "T1-000123",
    repairDocNumber: "R-000042",
    collectedAtMs: AT,
    terminalName: "Caja 1",
    cashierName: "Ana",
    isCopy: false,
    customerName: "Joan Puig",
    device: DEVICE,
    lines: [{ description: "Cambio de pantalla", qty: 1, chargeCents: 7900 }],
    subtotalCents: 6529,
    taxCents: 1371,
    taxRateBp: 2100,
    totalCents: 7900,
    tenders: [{ method: "Efectivo", amountCents: 7900, isDeposit: false }],
    changeCents: 0,
    warrantyEndsAtMs: WARRANTY_END,
    ...over,
  };
}

const receiptText = (over: Partial<RepairReceiptDoc> = {}) => opsToText(renderRepairReceipt(receipt(over), SHOP));
const flat = (text: string) => text.replace(/\s+/g, " ").trim();

describe("the collection receipt", () => {
  it("names BOTH documents, so either finds the other", () => {
    const text = receiptText();
    expect(text).toContain("T1-000123");
    // the cross-reference ADR-0014 §7a requires, in the direction paper travels
    expect(text).toContain("R-000042");
  });

  it("prints the work and its IVA breakdown", () => {
    const text = receiptText();
    expect(text).toContain("Cambio de pantalla");
    expect(text).toContain("79,00 €");
    expect(text).toContain("65,29 €");
    expect(text).toContain("IVA 21%");
    expect(text).toContain("13,71 €");
  });

  it("shows the deposit as a payment, not as a discount", () => {
    const text = receiptText({
      tenders: [
        { method: "Depósito", amountCents: 2000, isDeposit: true },
        { method: "Efectivo", amountCents: 5900, isDeposit: false },
      ],
    });
    // the total is still the value of the work
    expect(text).toContain("79,00 €");
    expect(text).toContain(REPAIR_ES.receiptDeposit);
    expect(text).toContain("20,00 €");
    expect(text).toContain("59,00 €");
    // never a negative line
    expect(text).not.toContain("-20,00 €");
  });

  it("carries the warranty end date, which is why the customer keeps it", () => {
    const text = receiptText();
    expect(text).toContain("20/11/2026");
    expect(flat(text)).toContain(REPAIR_ES.receiptWarrantyNote);
  });

  it("prints change only when there is any", () => {
    // "Cambio" also opens the line description ("Cambio de pantalla"), so this
    // looks for the ROW: the label alone, then whitespace, then the amount
    const hasChangeRow = (text: string) =>
      text
        .split("\n")
        .some((line) => /^Cambio\s+[\d.,]+\s*€$/.test(line.trim()));
    expect(hasChangeRow(receiptText())).toBe(false);
    expect(hasChangeRow(receiptText({ changeCents: 2100 }))).toBe(true);
  });

  it("stamps a reprint COPIA and stays fixed Spanish", () => {
    expect(receiptText({ isCopy: true })).toContain("C O P I A");
    expect(receiptText()).toContain("RECIBO DE REPARACIÓN");
  });

  it("cannot carry the passcode, because it has nowhere to put it", () => {
    const secret = "patron-N";
    const ops = renderRepairReceipt(
      { ...receipt(), ...({ devicePasscode: secret } as Record<string, unknown>) } as RepairReceiptDoc,
      SHOP,
    );
    expect(opsToText(ops)).not.toContain(secret);
    expect(JSON.stringify(ops)).not.toContain(secret);
  });
});

/* ------------------------------------------------------------- return */

function returnDoc(over: Partial<ReturnDoc> = {}): ReturnDoc {
  return {
    docNumber: "R-000042",
    returnedAtMs: AT,
    terminalName: "Caja 1",
    cashierName: "Ana",
    isCopy: false,
    customerName: "Joan Puig",
    customerPhone: "+34 671 220 918",
    device: DEVICE,
    reason: "unrepairable",
    chargedParts: [],
    diagnosisFeeCents: 0,
    depositAppliedCents: 0,
    depositRefundedCents: 0,
    dueCents: 0,
    ...over,
  };
}

const returnText = (over: Partial<ReturnDoc> = {}) => opsToText(renderReturnDoc(returnDoc(over), SHOP));

describe("the return document", () => {
  it("says which device is going back and why", () => {
    const text = returnText();
    expect(text).toContain("Apple iPhone 11 64GB");
    expect(text).toContain("356938104420030");
    expect(flat(text)).toContain(REPAIR_ES.returnUnrepairable);
    expect(flat(text)).toContain(REPAIR_ES.returnDevice);
  });

  it("uses the customer's own words when they declined", () => {
    expect(flat(returnText({ reason: "customer_declined" }))).toContain(REPAIR_ES.returnDeclined);
    expect(flat(returnText({ reason: "abandoned" }))).toContain(REPAIR_ES.returnAbandoned);
  });

  it("says nothing is owed when nothing is — which is the good case", () => {
    const text = returnText();
    expect(text).toContain(REPAIR_ES.returnNothingDue);
    expect(text).not.toContain(REPAIR_ES.returnDue);
    // and no empty money blocks inviting questions
    expect(text).not.toContain(REPAIR_ES.returnFee);
    expect(text).not.toContain(REPAIR_ES.returnDepositApplied);
  });

  it("itemises parts that went into the device and are not coming out", () => {
    const text = returnText({
      chargedParts: [{ description: "Pantalla iPhone 11", qty: 1, chargeCents: 6400 }],
      dueCents: 6400,
    });
    expect(text).toContain(REPAIR_ES.returnPartsCharged);
    expect(text).toContain("Pantalla iPhone 11");
    expect(text).toContain("64,00 €");
    expect(text).toContain(REPAIR_ES.returnDue);
  });

  it("accounts for the deposit in both directions", () => {
    const text = returnText({
      diagnosisFeeCents: 1500,
      depositAppliedCents: 1500,
      depositRefundedCents: 500,
    });
    expect(text).toContain(REPAIR_ES.returnFee);
    expect(text).toContain(REPAIR_ES.returnDepositApplied);
    expect(text).toContain("15,00 €");
    expect(text).toContain(REPAIR_ES.returnDepositRefunded);
    expect(text).toContain("5,00 €");
    expect(text).toContain(REPAIR_ES.returnNothingDue);
  });

  it("has a line the customer signs to say they took the device", () => {
    const text = returnText();
    expect(text).toContain(REPAIR_ES.returnReceived);
    expect(text).toContain("X ___");
  });

  it("cannot carry the passcode either", () => {
    const secret = "1379";
    const ops = renderReturnDoc(
      { ...returnDoc(), ...({ devicePasscode: secret } as Record<string, unknown>) } as ReturnDoc,
      SHOP,
    );
    expect(opsToText(ops)).not.toContain(secret);
    expect(JSON.stringify(ops)).not.toContain(secret);
  });
});
