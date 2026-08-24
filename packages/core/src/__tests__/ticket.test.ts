import { describe, expect, it } from "vitest";
import {
  COLUMNS_BY_PAPER,
  renderTicket,
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
    expect(text.indexOf("C O P I A")).toBeLessThan(text.indexOf("A R K O M"));
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
    expect(text).toContain("Otra Tienda SL");
    expect(text).toContain("NIF A12345678");
    expect(text).toContain("Sin sorpresas.");
    expect(text).not.toContain(SHOP.legalName);
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
