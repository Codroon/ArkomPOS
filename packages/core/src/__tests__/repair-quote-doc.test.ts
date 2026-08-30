/**
 * The quote document.
 *
 * Its job is to be a thing a customer signs, so the assertions here are mostly
 * about what a signature would be binding them to: the priced list, the total
 * beneath it, and the sentence above the line.
 */
import { describe, expect, it } from "vitest";
import { REPAIR_ES, renderQuoteDoc, type QuoteDoc, type RepairDocDevice } from "../repair-doc";
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
  reportedFault: "Pantalla rota, táctil intermitente",
  conditionAtIntake: "Marcas de uso, trasera correcta",
  damage: { screen: true, back: false, dents: false, water: false },
  damageNote: null,
  accessories: null,
};

const AT = Date.UTC(2026, 7, 11, 10, 30);

function doc(over: Partial<QuoteDoc> = {}): QuoteDoc {
  return {
    docNumber: "R-000042",
    quotedAtMs: AT,
    terminalName: "Caja 1",
    cashierName: "Ana",
    isCopy: false,
    customerName: "Joan Puig",
    customerPhone: "+34 671 220 918",
    device: DEVICE,
    lines: [
      { description: "Pantalla iPhone 11", qty: 1, chargeCents: 8900, onOrder: false },
      { description: "Mano de obra", qty: 1, chargeCents: 3000, onOrder: false },
    ],
    totalCents: 11900,
    depositCents: 0,
    approval: null,
    ...over,
  };
}

const textOf = (over: Partial<QuoteDoc> = {}) => opsToText(renderQuoteDoc(doc(over), SHOP));

/** The paper as one line: the long sentences wrap, and a wrap is not a change. */
const flatOf = (over: Partial<QuoteDoc> = {}) => textOf(over).replace(/\s+/g, " ").trim();

describe("the quote a customer signs", () => {
  it("prints every line with its charge, and the total under them", () => {
    const text = textOf();
    expect(text).toContain("Pantalla iPhone 11");
    expect(text).toContain("89,00 €");
    expect(text).toContain("Mano de obra");
    expect(text).toContain("30,00 €");
    expect(text).toContain(REPAIR_ES.quoteTotal);
    expect(text).toContain("119,00 €");
  });

  it("names the device and the fault it is quoting for", () => {
    // a quote detached from the fault it answers is a quote for anything
    const text = textOf();
    expect(text).toContain("Apple iPhone 11 64GB");
    expect(text).toContain("356938104420030");
    expect(text).toContain("Pantalla rota, táctil intermitente");
  });

  it("shows a quantity only when it is not one", () => {
    expect(textOf()).not.toContain("1 × Mano de obra");
    expect(
      textOf({ lines: [{ description: "Tornillo", qty: 4, chargeCents: 400, onOrder: false }] }),
    ).toContain("4 × Tornillo");
  });

  it("says which parts have not arrived yet", () => {
    const text = textOf({
      lines: [{ description: "Batería", qty: 1, chargeCents: 4500, onOrder: true }],
    });
    expect(text).toContain(REPAIR_ES.quoteOnOrder);
  });

  it("carries the authorization sentence and a line to sign on", () => {
    expect(flatOf()).toContain(REPAIR_ES.quoteAccept);
    expect(textOf()).toContain(REPAIR_ES.signature);
    expect(textOf()).toContain("X ___");
  });

  it("subtracts a deposit already taken and prints what is left to pay", () => {
    const text = textOf({ depositCents: 3000 });
    expect(text).toContain(REPAIR_ES.quoteDeposit);
    expect(text).toContain("-30,00 €");
    expect(text).toContain(REPAIR_ES.quoteToPay);
    expect(text).toContain("89,00 €");
  });

  it("never prints a negative amount to pay", () => {
    // a deposit larger than the quote is money owed BACK at hand-back, and a
    // customer handed a receipt reading "-20,00 €" reads it as a bill
    const text = textOf({ depositCents: 14000 });
    expect(text).toContain(REPAIR_ES.quoteToPay);
    expect(text).not.toContain("-21,00 €");
    expect(text).toContain("0,00 €");
  });

  it("omits the deposit block entirely when none was taken", () => {
    expect(textOf()).not.toContain(REPAIR_ES.quoteDeposit);
  });
});

describe("once the customer has said yes", () => {
  it("records the approval instead of asking for a signature", () => {
    const approved = { approval: { method: "in_person" as const, atMs: AT, approvedTotalCents: 11900 } };
    const text = textOf(approved);
    // letter-spaced like every other stamp on this paper
    expect(text).toContain(REPAIR_ES.quoteApproved.split("").join(" "));
    expect(text).toContain(REPAIR_ES.quoteInPerson);
    // the same sheet must not invite a second, contradictory signature
    expect(text).not.toContain(REPAIR_ES.signature);
    expect(flatOf(approved)).not.toContain(REPAIR_ES.quoteAccept);
  });

  it("says which way they said it", () => {
    expect(
      textOf({ approval: { method: "by_phone", atMs: AT, approvedTotalCents: 11900 } }),
    ).toContain(REPAIR_ES.quoteByPhone);
  });

  /**
   * Found by driving the app: a ticket approved at 84,80 € grew to 204,80 €
   * when a part was added, and the reprinted quote still said APROBADO — the
   * shop claiming an agreement the customer never made, on the very sheet meant
   * to record what they agreed to.
   */
  it("stops standing once the quote grows past the amount that was approved", () => {
    const stale = { approval: { method: "in_person" as const, atMs: AT, approvedTotalCents: 8480 } };
    const text = textOf(stale);
    expect(text).not.toContain(REPAIR_ES.quoteApproved.split("").join(" "));
    // and it asks again, because that is exactly what the ticket is doing
    expect(flatOf(stale)).toContain(REPAIR_ES.quoteAccept);
    expect(text).toContain(REPAIR_ES.signature);
  });

  it("still stands when the quote came DOWN after they agreed", () => {
    // they agreed to more than they are being asked for; nothing to re-sign
    const text = textOf({ approval: { method: "in_person", atMs: AT, approvedTotalCents: 20000 } });
    expect(text).toContain(REPAIR_ES.quoteApproved.split("").join(" "));
  });
});

describe("the paperwork rules every repair document keeps", () => {
  it("is fixed Spanish, whatever the staff locale is set to", () => {
    const text = textOf();
    expect(text).toContain("PRESUPUESTO");
    expect(text).toContain("CLIENTE");
    expect(text).toContain("DISPOSITIVO");
  });

  it("stamps a reprint COPIA", () => {
    expect(textOf({ isCopy: true })).toContain("C O P I A");
    expect(textOf()).not.toContain("C O P I A");
  });

  it("cannot carry the device passcode, because it has nowhere to put it", () => {
    const secret = "patron-Z-abajo";
    const withSecret = { ...doc(), ...({ devicePasscode: secret } as Record<string, unknown>) };
    const ops = renderQuoteDoc(withSecret as QuoteDoc, SHOP);
    expect(opsToText(ops)).not.toContain(secret);
    expect(JSON.stringify(ops)).not.toContain(secret);
  });

  it("ends with a cut so the next document starts on its own paper", () => {
    const ops = renderQuoteDoc(doc(), SHOP);
    expect(ops[ops.length - 1]).toEqual({ op: "cut" });
  });
});
