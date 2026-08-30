import { describe, expect, it } from "vitest";
import {
  REPAIR_ES,
  damageLine,
  promisedLine,
  renderIntakeReceipt,
  type IntakeReceiptDoc,
  type RepairDocDevice,
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
  reportedFault: "Pantalla rota, táctil intermitente",
  conditionAtIntake: "Marcas de uso, trasera correcta",
  damage: { screen: true, back: false, dents: false, water: false },
  damageNote: null,
  accessories: null,
};

const AT = Date.UTC(2026, 7, 9, 14, 5);

function doc(over: Partial<IntakeReceiptDoc> = {}): IntakeReceiptDoc {
  return {
    docNumber: "R-000042",
    receivedAtMs: AT,
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
    ...over,
  };
}

const asText = (over: Partial<IntakeReceiptDoc> = {}, width: 80 | 58 = 80) =>
  opsToText(renderIntakeReceipt(doc(over), SHOP, width), width);

const asFlow = (over: Partial<IntakeReceiptDoc> = {}, width: 80 | 58 = 80) =>
  asText(over, width)
    .split("\n")
    .map((l) => l.trim())
    .join(" ")
    .replace(/\s+/g, " ");

describe("the intake receipt", () => {
  it("prints on 80mm paper", () => {
    expect(asText()).toMatchSnapshot();
  });

  it("prints on the 58mm fallback roll", () => {
    expect(asText({}, 58)).toMatchSnapshot();
  });

  it("carries the three things that make it a legal record", () => {
    const flow = asFlow();
    // what was taken and in what state
    expect(flow).toContain("Apple iPhone 11 64GB");
    expect(flow).toContain("Estado: Marcas de uso");
    // the warranty
    expect(flow).toContain("3 meses de garantía");
    // and the promise not to work without approval
    expect(flow).toContain("sin la aprobación previa del cliente");
  });

  it("leaves room to sign", () => {
    const lines = asText().split("\n");
    const rule = lines.findIndex((l) => l.startsWith("X _"));
    expect(rule).toBeGreaterThan(3);
    expect(lines.slice(rule - 3, rule).every((l) => l.trim() === "")).toBe(true);
  });

  it("names the customer and their number", () => {
    expect(asFlow()).toContain("Joan Puig · +34 671 220 918");
  });

  it("records the damage marks that protect the shop", () => {
    const flow = asFlow({
      device: { ...DEVICE, damage: { screen: true, back: true, dents: false, water: true } },
    });
    expect(flow).toContain("Daños: pantalla rota, trasera rota, testigo de humedad");
  });

  it("adds the free-text note to the marks", () => {
    expect(asFlow({ device: { ...DEVICE, damageNote: "arañazo en el marco" } })).toContain(
      "Daños: pantalla rota, arañazo en el marco",
    );
  });

  it("omits the damage line entirely when there is nothing to report", () => {
    const clean = { ...DEVICE, damage: { screen: false, back: false, dents: false, water: false } };
    expect(asFlow({ device: clean })).not.toContain("Daños:");
  });

  it("says 'ninguno' rather than leaving accessories blank", () => {
    expect(asFlow()).toContain("Accesorios: ninguno");
    expect(asFlow({ device: { ...DEVICE, accessories: "funda, cargador" } })).toContain(
      "Accesorios: funda, cargador",
    );
  });

  it("survives a device with no IMEI", () => {
    // not every device has one, and a receipt is not the place to insist
    const flow = asFlow({ device: { ...DEVICE, imei: null } });
    expect(flow).not.toContain("IMEI");
    expect(flow).toContain("Apple iPhone 11 64GB");
  });
});

describe("what prints only when it exists", () => {
  it("omits the deposit line when nothing was taken", () => {
    // "Depósito 0,00 €" invites a customer to wonder where their money went
    expect(asFlow()).not.toContain(REPAIR_ES.deposit);
    expect(asFlow({ depositCents: 2000 })).toContain("Depósito entregado");
  });

  it("omits the cap unless one was authorized, and changes the notice when it was", () => {
    expect(asFlow()).toContain(REPAIR_ES.authorizationNotice);
    expect(asFlow()).not.toContain("Autorizado a reparar hasta");

    const capped = asFlow({ authorizedCapCents: 10000 });
    expect(capped).toContain("Autorizado a reparar hasta");
    // the promise has to match what the customer actually signed
    expect(capped).toContain("por encima del importe autorizado");
  });

  it("omits the diagnosis fee when the shop does not charge one", () => {
    expect(asFlow()).not.toContain("Tarifa de diagnóstico");
    expect(asFlow({ diagnosisFeeCents: 1500 })).toContain("Tarifa de diagnóstico");
  });

  it("prints the promise as a date and a half-day, never a time", () => {
    expect(asFlow({ promisedAtMs: Date.UTC(2026, 7, 11, 0, 0), promisedHalf: "afternoon" })).toContain(
      "Entrega prevista",
    );
    expect(promisedLine(Date.UTC(2026, 7, 11, 10, 0), "afternoon")).toMatch(/^11\/08\/2026 tarde$/);
    expect(promisedLine(null, "afternoon")).toBeNull();
  });

  it("stamps COPIA on a reprint", () => {
    expect(asText({ isCopy: true })).toContain("C O P I A");
    expect(asText()).not.toContain("C O P I A");
  });
});

describe("the passcode", () => {
  it("cannot reach the paper, because the document cannot carry it", () => {
    /* ADR-0014 §10. This is not a filter that could be forgotten — the input
       type has no passcode field at all, so a future edit cannot print one by
       reaching for something that happens to be in scope. The assertion below
       is the runtime half of the same promise. */
    for (const secret of ["patron-L-esquina", "907316"]) {
      const withSecret = { ...doc(), ...({ devicePasscode: secret } as Record<string, unknown>) };
      const text = opsToText(renderIntakeReceipt(withSecret as IntakeReceiptDoc, SHOP));
      expect(text, secret).not.toContain(secret);
    }
  });

  it("is absent from the ops themselves, not merely from the flattened text", () => {
    // a value could survive in an op's field without appearing in opsToText;
    // the serialised ops are the honest place to look
    const secret = "907316";
    const withSecret = { ...doc(), ...({ devicePasscode: secret } as Record<string, unknown>) };
    const ops = renderIntakeReceipt(withSecret as IntakeReceiptDoc, SHOP);
    expect(JSON.stringify(ops)).not.toContain(secret);
  });
});

describe("damage helper", () => {
  it("returns an empty string when there is nothing wrong", () => {
    expect(
      damageLine({ ...DEVICE, damage: { screen: false, back: false, dents: false, water: false } }),
    ).toBe("");
  });

  it("keeps the marks in a stable order regardless of which are set", () => {
    expect(
      damageLine({ ...DEVICE, damage: { screen: false, back: true, dents: true, water: false } }),
    ).toBe("trasera rota, golpes");
  });
});
