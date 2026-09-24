import { describe, expect, it } from "vitest";
import {
  COLUMNS_BY_PAPER,
  renderTicket,
  shopHeaderLines,
  ticketToText,
  TICKET_ES,
  wrapText,
  type ShopProfile,
  type TicketDoc,
} from "../ticket";

/* Placeholder shop data, the same shape Ajustes stores. */
const SHOP: ShopProfile = {
  legalName: "Arkom Electrónica S.L.",
  nif: "B00000000",
  address: "Calle Ejemplo 1, 28001 Madrid",
  footerLine: TICKET_ES.defaultFooter,
};

/**
 * One mixed sale exercising every branch the layout has: a quantity product, a
 * serialized phone with its IMEI, an overridden price, and a split tender that
 * leaves change.
 */
const MIXED: TicketDoc = {
  docNumber: "T1-000042",
  // the rate the taxed lines carry; the breakdown label is built from it
  vatRateBp: 2100,
  // fixed instant so the snapshot is stable (2026-08-24 09:31 local)
  completedAtMs: new Date(2026, 7, 24, 9, 31, 0).getTime(),
  terminalName: "Till 1",
  isCopy: false,
  lines: [
    {
      description: "Samsung Galaxy A16 128GB Negro",
      qty: 1,
      unitPriceCents: 18900,
      totalCents: 18900,
      imei: "356938104420030",
      priceOverridden: false,
    },
    {
      description: "Cargador 20W USB-C",
      qty: 2,
      unitPriceCents: 1490,
      totalCents: 2980,
      imei: null,
      priceOverridden: false,
    },
    {
      description: "Funda libro Galaxy A16",
      qty: 1,
      unitPriceCents: 1000,
      totalCents: 1000,
      imei: null,
      priceOverridden: true,
    },
  ],
  subtotalCents: 18082,
  taxCents: 3798,
  totalCents: 21880,
  tenders: [
    { method: "cash", amountCents: 20000, cardReference: null },
    { method: "card", amountCents: 5000, cardReference: "AUT-9931" },
  ],
  changeCents: 3120,
};

describe("renderTicket", () => {
  it("lays out a mixed sale on 80mm paper", () => {
    expect(ticketToText(renderTicket(MIXED, SHOP, 80), 80)).toMatchSnapshot();
  });

  it("lays out the same sale on 58mm paper", () => {
    expect(ticketToText(renderTicket(MIXED, SHOP, 58), 58)).toMatchSnapshot();
  });

  it("stamps COPIA on a reprint", () => {
    const text = ticketToText(renderTicket({ ...MIXED, isCopy: true }, SHOP, 80), 80);
    expect(text).toContain("C O P I A");
    /* before the shop's name, which is the first thing on an original: a
       reprint has to announce itself before anything else is read */
    const flat = text.replace(/\s+/g, "");
    expect(flat.indexOf("COPIA")).toBeLessThan(flat.indexOf(SHOP.legalName.replace(/\s+/g, "")));
  });

  it("never exceeds the paper's column count", () => {
    for (const width of [80, 58] as const) {
      for (const line of ticketToText(renderTicket(MIXED, SHOP, width), width).split("\n")) {
        expect(line.length).toBeLessThanOrEqual(COLUMNS_BY_PAPER[width] + 2); // +2 = the ✂ marker
      }
    }
  });

  it("pulses the drawer for cash, but not on a reprint", () => {
    const kinds = (doc: TicketDoc) => renderTicket(doc, SHOP, 80).map((o) => o.op);
    expect(kinds(MIXED)).toContain("drawer");
    expect(kinds({ ...MIXED, isCopy: true })).not.toContain("drawer");
    const cardOnly: TicketDoc = {
      ...MIXED,
      tenders: [{ method: "card", amountCents: 21880, cardReference: "AUT-1" }],
      changeCents: 0,
    };
    expect(kinds(cardOnly)).not.toContain("drawer");
  });

  it("always ends by cutting the paper", () => {
    const ops = renderTicket(MIXED, SHOP, 80);
    const cutAt = ops.findIndex((o) => o.op === "cut");
    expect(cutAt).toBeGreaterThan(0);
    // nothing but the drawer pulse may follow the cut
    expect(ops.slice(cutAt + 1).every((o) => o.op === "drawer")).toBe(true);
  });

  it("marks overridden lines and carries the IMEI of serialized ones", () => {
    const text = ticketToText(renderTicket(MIXED, SHOP, 80), 80);
    expect(text).toContain("IMEI 356938104420030");
    expect(text).toContain(TICKET_ES.modified);
    // exactly one line was overridden, so exactly one marker
    expect(text.split(TICKET_ES.modified).length - 1).toBe(1);
  });

  it("takes the shop's legal block from the profile, never from a constant", () => {
    const other: ShopProfile = {
      legalName: "Otra Tienda SL",
      nif: "A12345678",
      address: "Gran Vía 2, Bilbao",
      footerLine: "Sin sorpresas.",
    };
    const text = ticketToText(renderTicket(MIXED, other, 80), 80);
    /* the name heads the ticket in double-width type, which the screen preview
       letter-spaces — so compare the characters, not the spacing */
    const flat = text.replace(/\s+/g, "");
    expect(flat).toContain("OtraTiendaSL");
    expect(text).toContain("NIF A12345678");
    expect(text).toContain("Sin sorpresas.");
    expect(flat).not.toContain(SHOP.legalName.replace(/\s+/g, ""));
  });

  it("shows prices as VAT-inclusive with the split beneath", () => {
    const ops = renderTicket(MIXED, SHOP, 80);
    const rows = ops.flatMap((o) => (o.op === "text" ? [o] : []));
    const said = (needle: string) => rows.some((r) => r.text.includes(needle));

    expect(said("180,82 €")).toBe(true); // base
    expect(said("37,98 €")).toBe(true); // VAT
    expect(said("218,80 €")).toBe(true); // TOTAL = Σ line totals, VAT already in

    // the total is the one row printed double-size, and it says so
    const total = rows.find((r) => r.text.startsWith(TICKET_ES.total));
    expect(total?.size).toBe("big");
    expect(said(TICKET_ES.vatIncluded)).toBe(true);
  });

  it("keeps a card reference attached to its tender", () => {
    const rows = renderTicket(MIXED, SHOP, 80).flatMap((o) => (o.op === "text" ? [o.text] : []));
    const at = rows.findIndex((r) => r.startsWith("Tarjeta"));
    expect(rows[at + 1]).toBe("  AUT-9931"); // indented, directly beneath
  });
});

describe("wrapText", () => {
  it("wraps on word boundaries", () => {
    expect(wrapText("Protector cristal templado iPhone 15 Pro Max", 20)).toEqual([
      "Protector cristal",
      "templado iPhone 15",
      "Pro Max",
    ]);
  });

  it("hard-splits a word too long for the line instead of truncating", () => {
    const parts = wrapText("356938104420030", 8);
    expect(parts).toEqual(["35693810", "4420030"]);
    expect(parts.join("")).toBe("356938104420030"); // nothing lost
  });

  it("keeps long product names whole across the wrap", () => {
    const name = "Auriculares diadema Bluetooth con cancelación de ruido";
    expect(wrapText(name, 32).join(" ")).toBe(name);
  });
});

/* ---------------------------------------- v0.18.0 · the letterhead on paper */

/**
 * A live print once came out as "Tu Unico Punto Tecnologi" and nothing after
 * it. Every line of the shop's block and the footer has to fit the roll it is
 * printed on: wrapped at the paper's columns, each fragment centred, nothing
 * cut. Pinned at both widths, because 58 mm is where it breaks first.
 */
const LONG_SHOP: ShopProfile = {
  legalName: "Tu Único Punto Tecnológico Sociedad Limitada Unipersonal",
  displayName: "Tu Unico Punto Tecnologico",
  nif: "B87654321",
  address: "Avenida de la Constitución 148, Local 3, Esquina con Calle Larga",
  postalCode: "41001",
  city: "Sevilla",
  phone: "954 000 000",
  footerLine: "Garantía de dos años en todo lo que vendemos. Devoluciones en 14 días con este ticket. Gracias por confiar en nosotros.",
};

/** The characters of `text`, in order, ignoring whitespace — what wrapping must preserve. */
const squash = (text: string) => text.replace(/\s+/g, "");

describe.each([80, 58] as const)("the letterhead and footer on %dmm paper", (width) => {
  const cols = COLUMNS_BY_PAPER[width];
  const lines = ticketToText(renderTicket(MIXED, LONG_SHOP, width), width).split("\n");

  it("never prints a line wider than the roll", () => {
    // the ✂ marker is how the screen preview draws the cut, not a printed line
    for (const line of lines.filter((l) => !l.includes("✂"))) expect(line.length, line).toBeLessThanOrEqual(cols);
  });

  it("wraps every long line instead of cutting it", () => {
    const everything = squash(lines.join(""));
    for (const text of [
      LONG_SHOP.legalName,
      LONG_SHOP.displayName!,
      LONG_SHOP.address,
      LONG_SHOP.footerLine,
      `${LONG_SHOP.postalCode} ${LONG_SHOP.city}`,
      `Tel. ${LONG_SHOP.phone}`,
    ]) {
      expect(everything).toContain(squash(text));
    }
    expect(lines.join("")).not.toContain("…");
  });

  it("centres each wrapped fragment on the roll", () => {
    // every letterhead and footer line is emitted centred; a centred line has
    // the same number of columns free on both sides, give or take the odd one
    const centred = lines.filter((l) => /Tecnol|Constitución|Sevilla|Tel\.|Garantía|Devoluciones|confiar/.test(l));
    expect(centred.length).toBeGreaterThan(0);
    for (const line of centred) {
      const left = line.length - line.trimStart().length;
      const right = cols - line.trimEnd().length;
      expect(Math.abs(left - right), JSON.stringify(line)).toBeLessThanOrEqual(1);
    }
  });

  it("lays out the same way every time", () => {
    expect(lines.join("\n")).toMatchSnapshot();
  });
});

describe("a letterhead nobody filled in", () => {
  it("prints nothing where the shop's block would be — no placeholder, no blank NIF line", () => {
    const empty: ShopProfile = { legalName: "", nif: "", address: "", footerLine: "" };
    expect(shopHeaderLines(empty)).toEqual([]);
    const text = ticketToText(renderTicket(MIXED, empty, 80), 80);
    expect(text).not.toContain("NIF");
    expect(text).not.toContain("PENDIENTE");
    // the brand, the number and the totals are still there (big text is letter-spaced on screen)
    expect(text).toContain("T1-000042");
    expect(squash(text)).toContain("TOTAL");
  });
});

/* ------------------------------------------------- whose name is on the paper */

describe("the name at the top of a customer's receipt", () => {
  /**
   * The till is Codroon POS and the shop is not — v1.1.0.
   *
   * Until this release the wordmark was the constant "ARKOM", which was right
   * for the one shop it was written for and wrong for every shop that buys the
   * software afterwards. Nobody hands a customer a receipt with their software
   * vendor's name at the top of it.
   */
  it("is the shop's own, and the till's appears nowhere", () => {
    const shop: ShopProfile = {
      legalName: "Telefonía García S.L.",
      displayName: "García Móviles",
      nif: "B99887766",
      address: "Calle Real 3",
      footerLine: "Gracias.",
    };
    const text = ticketToText(renderTicket(MIXED, shop, 80), 80);
    const flat = text.replace(/\s+/g, "");

    // the trading name leads: it is what the customer recognises
    expect(flat).toContain("GarcíaMóviles".replace(/\s+/g, ""));
    expect(text).toContain("NIF B99887766");
    // and no trace of us, or of the shop this software was first written for
    for (const ours of ["CODROON", "Codroon", "ARKOM", "Arkom", "ELECTRONICS · PHONES"]) {
      expect(flat, `${ours} must not reach a customer's receipt`).not.toContain(ours.replace(/\s+/g, ""));
    }
  });

  it("falls back to the legal name when the shop has no trading name", () => {
    const shop: ShopProfile = {
      legalName: "Telefonía García S.L.",
      nif: "B99887766",
      address: "Calle Real 3",
      footerLine: "",
    };
    const flat = ticketToText(renderTicket(MIXED, shop, 80), 80).replace(/\s+/g, "");
    expect(flat).toContain("TelefoníaGarcíaS.L.");
    // and says it once: the letterhead skips a line that repeats the one above
    expect(flat.split("TelefoníaGarcíaS.L.").length - 1).toBe(1);
  });

  it("prints the shop's strapline only when it has one", () => {
    const bare: ShopProfile = { legalName: "Tienda", nif: "B1", address: "C/ 1", footerLine: "" };
    const withTag: ShopProfile = { ...bare, tagline: "REPARACIONES · ACCESORIOS" };
    expect(ticketToText(renderTicket(MIXED, withTag, 80), 80).replace(/\s+/g, "")).toContain(
      "REPARACIONES·ACCESORIOS",
    );
    // nothing invented, and no blank line where a strapline would be
    const lines = ticketToText(renderTicket(MIXED, bare, 80), 80).split(String.fromCharCode(10));
    expect(lines.filter((l) => l.trim() === "").length).toBeLessThan(6);
  });
});
