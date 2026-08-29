import { describe, expect, it } from "vitest";
import {
  PURCHASE_ES,
  deviceHeadline,
  renderPurchaseDoc,
  renderShelfLabel,
  type PurchaseDoc,
  type PurchaseDocDevice,
} from "../purchase-doc";
import { opsToText } from "../print-ops";
import type { ShopProfile } from "../ticket";

const SHOP: ShopProfile = {
  legalName: "Arkom Electronics S.L.",
  nif: "B12345678",
  address: "C/ Mayor 14, 28013 Madrid",
  footerLine: "Precios claros. Sin letra pequeña.",
};

const DEVICE: PurchaseDocDevice = {
  brand: "Apple",
  model: "iPhone SE 2020",
  storage: "64GB",
  color: "Blanco",
  grade: "B",
  batteryPct: 86,
  imei: "352094118803185",
  accessories: { charger: true, box: false, cable: true, case: false },
};

// a fixed instant so the snapshot never depends on when the suite runs
const AT = Date.UTC(2026, 7, 27, 10, 4);

function doc(over: Partial<PurchaseDoc> = {}): PurchaseDoc {
  return {
    docNumber: "C-000123",
    purchasedAtMs: AT,
    terminalName: "Caja 1",
    cashierName: "Ana",
    isCopy: false,
    device: DEVICE,
    seller: {
      name: "Imran Khan",
      phone: "+34 632 118 044",
      idType: "DNI",
      idNumber: "Y2841170F",
      channel: "private_individual",
    },
    buyPriceCents: 8000,
    payout: "cash",
    payoutReference: null,
    voucherNumber: null,
    ...over,
  };
}

const asText = (over: Partial<PurchaseDoc> = {}, width: 80 | 58 = 80) =>
  opsToText(renderPurchaseDoc(doc(over), SHOP, width), width);

/** The same text with wrapping undone, for assertions about a whole sentence. */
const asFlow = (over: Partial<PurchaseDoc> = {}, width: 80 | 58 = 80) =>
  asText(over, width)
    .split("\n")
    .map((line) => line.trim())
    .join(" ")
    .replace(/\s+/g, " ");

describe("the purchase document", () => {
  it("prints on 80mm paper", () => {
    expect(asText()).toMatchSnapshot();
  });

  it("prints on the 58mm fallback roll", () => {
    expect(asText({}, 58)).toMatchSnapshot();
  });

  it("carries the declaration and a signature line — the reason it exists", () => {
    const text = asText();
    expect(text).toContain("legítimo");
    expect(text).toContain(PURCHASE_ES.signature);
    expect(text).toMatch(/X _{10,}/);
  });

  it("leaves at least three blank lines above the signature rule", () => {
    // a box a seller has to squeeze into is a signature nobody can stand behind
    const lines = asText().split("\n");
    const rule = lines.findIndex((l) => l.startsWith("X _"));
    expect(rule).toBeGreaterThan(3);
    expect(lines.slice(rule - 3, rule).every((l) => l.trim() === "")).toBe(true);
  });

  it("names who sold it, and how they were identified", () => {
    const text = asText();
    expect(text).toContain("Imran Khan");
    expect(text).toContain("DNI Y2841170F");
    expect(text).toContain("Tel. +34 632 118 044");
  });

  it("omits the phone line when there is no phone", () => {
    expect(asText({ seller: { ...doc().seller, phone: null } })).not.toContain("Tel.");
  });

  it("states the amount and how it was paid", () => {
    const ops = renderPurchaseDoc(doc(), SHOP);
    const paid = ops.find((op) => op.op === "text" && op.text.includes(PURCHASE_ES.paid));
    expect(paid).toBeDefined();
    expect(paid && paid.op === "text" && paid.text).toContain("80,00");
    expect(asText()).toContain("Forma de pago: efectivo");
  });

  it("names the voucher when the seller was paid in credit", () => {
    expect(asFlow({ payout: "store_credit", voucherNumber: "C-000123" })).toContain(
      "Forma de pago: saldo a favor (vale C-000123)",
    );
  });

  it("carries the transfer reference when there is one", () => {
    expect(asFlow({ payout: "transfer", payoutReference: "ES91 2100 0418 45" })).toContain(
      "transferencia (ES91 2100 0418 45)",
    );
  });

  it("lists the accessories that came with it", () => {
    expect(asText()).toContain("Accesorios: cargador, cable");
  });

  it("says so when nothing came with it", () => {
    const bare = { ...DEVICE, accessories: { charger: false, box: false, cable: false, case: false } };
    expect(asText({ device: bare })).toContain(`Accesorios: ${PURCHASE_ES.noAccessories}`);
  });

  it("shows grade and battery, and drops battery when it was not recorded", () => {
    expect(asText()).toContain("Grado B · Batería 86%");
    expect(asText({ device: { ...DEVICE, batteryPct: null } })).toContain("Grado B");
    expect(asText({ device: { ...DEVICE, batteryPct: null } })).not.toContain("Batería");
  });

  it("stamps COPIA on a reprint", () => {
    expect(asText({ isCopy: true })).toContain("C O P I A");
    expect(asText()).not.toContain("C O P I A");
  });

  it("never kicks the drawer", () => {
    // paying out cash is a drawer event the shop performs; popping it open with
    // a stranger at the counter is the wrong default
    for (const payout of ["cash", "transfer", "store_credit"] as const) {
      expect(renderPurchaseDoc(doc({ payout }), SHOP).some((op) => op.op === "drawer")).toBe(false);
    }
  });

  it("keeps the IMEI whole on the narrow roll", () => {
    // 15 digits fit in 32 columns, and a half-printed IMEI is worse than useless
    expect(asText({}, 58)).toContain("IMEI 352094118803185");
  });

  it("ends with a cut", () => {
    const ops = renderPurchaseDoc(doc(), SHOP);
    expect(ops[ops.length - 1]!.op).toBe("cut");
  });
});

describe("the device headline", () => {
  it("joins what exists", () => {
    expect(deviceHeadline(DEVICE)).toBe("Apple iPhone SE 2020 · 64GB · Blanco");
  });

  it("drops the attributes that were not recorded", () => {
    expect(deviceHeadline({ ...DEVICE, storage: null, color: null })).toBe("Apple iPhone SE 2020");
    expect(deviceHeadline({ ...DEVICE, color: null })).toBe("Apple iPhone SE 2020 · 64GB");
  });
});

describe("the shelf label", () => {
  const label = (over = {}) =>
    opsToText(
      renderShelfLabel({ barcode: "2012345678909", device: DEVICE, docNumber: "C-000123", sellPriceCents: null, ...over }),
    );

  it("leads with the barcode, double width", () => {
    const ops = renderShelfLabel({
      barcode: "2012345678909",
      device: DEVICE,
      docNumber: "C-000123",
      sellPriceCents: null,
    });
    const first = ops[0]!;
    expect(first.op === "text" && first.size).toBe("big");
    expect(first.op === "text" && first.text).toBe("2012345678909");
  });

  it("carries the model, the grade and the purchase number", () => {
    const text = label();
    expect(text).toContain("Apple iPhone SE 2020");
    expect(text).toContain("Grado B · C-000123");
  });

  it("shows a price only once there is one", () => {
    expect(label()).not.toContain("€");
    expect(label({ sellPriceCents: 18900 })).toContain("1 8 9 , 0 0"); // stretched by double width
  });

  it("survives a device with no barcode yet", () => {
    expect(() => label({ barcode: null })).not.toThrow();
    expect(label({ barcode: null })).toContain("Apple iPhone SE 2020");
  });
});
