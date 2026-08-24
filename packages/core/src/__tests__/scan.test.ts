import { describe, expect, it } from "vitest";
import { normalizeScanCode, resolveScan, type ScanProduct, type ScanUnit } from "../scan";

const cable: ScanProduct = { productId: "p-cable", name: "Cable Lightning 1m", itemType: "stocked", priceCents: 990, onHand: 22, active: true };
const protector15: ScanProduct = { productId: "p-15", name: "Protector iPhone 15 Pro Max", itemType: "stocked", priceCents: 1290, onHand: 8, active: true };
const protector16: ScanProduct = { productId: "p-16", name: "Protector iPhone 16 Pro Max", itemType: "stocked", priceCents: 1390, onHand: 6, active: true };
const phone: ScanProduct = { productId: "p-17", name: "Apple iPhone 17 Pro Max 256GB Negro", itemType: "serialized", priceCents: 149900, onHand: 5, active: true };

const inStock = (unitId: string, imei: string): ScanUnit => ({ unitId, imei, status: "in_stock" });

describe("resolveScan", () => {
  it("resolves a product by its primary barcode", () => {
    const result = resolveScan("8437123000136", {
      products: [{ product: cable, matchedVia: "primary" }],
      units: [],
    });
    expect(result).toEqual({ kind: "product", product: cable, matchedVia: "primary" });
  });

  it("resolves a product by an additional code (the real box EAN)", () => {
    const result = resolveScan("0194253123453", {
      products: [{ product: protector15, matchedVia: "alias" }],
      units: [],
    });
    expect(result).toEqual({ kind: "product", product: protector15, matchedVia: "alias" });
  });

  it("resolves an in-stock unit by IMEI", () => {
    const unit = inStock("u1", "353287119902456");
    const result = resolveScan("353287119902456", { products: [], units: [{ unit, product: phone }] });
    expect(result).toEqual({ kind: "unit", unit, product: phone });
  });

  it("is ambiguous when one code sits on two products (sibling variants)", () => {
    const result = resolveScan("8412345000129", {
      products: [
        { product: protector16, matchedVia: "alias" },
        { product: protector15, matchedVia: "alias" },
      ],
      units: [],
    });
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    // sorted by name for a stable picker
    expect(result.matches.map((m) => (m.kind === "product" ? m.product.name : m.unit.imei))).toEqual([
      "Protector iPhone 15 Pro Max",
      "Protector iPhone 16 Pro Max",
    ]);
  });

  it("is ambiguous when a code exists in BOTH spaces (product code + unit IMEI)", () => {
    const unit = inStock("u9", "353287119902456");
    const result = resolveScan("353287119902456", {
      products: [{ product: cable, matchedVia: "alias" }],
      units: [{ unit, product: phone }],
    });
    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") return;
    expect(result.matches.map((m) => m.kind)).toEqual(["product", "unit"]);
  });

  it("returns none for an unknown code", () => {
    expect(resolveScan("9999999999999", { products: [], units: [] })).toEqual({
      kind: "none",
      code: "9999999999999",
    });
  });

  it("counts a product once when the code is both its primary and an alias (primary wins)", () => {
    const result = resolveScan("8437123000136", {
      products: [
        { product: cable, matchedVia: "alias" },
        { product: cable, matchedVia: "primary" },
      ],
      units: [],
    });
    expect(result).toEqual({ kind: "product", product: cable, matchedVia: "primary" });
  });

  it("ignores units that are not in stock (reserved or already sold)", () => {
    const sold: ScanUnit = { unitId: "u2", imei: "353287119902456", status: "sold" };
    expect(
      resolveScan("353287119902456", { products: [], units: [{ unit: sold, product: phone }] }).kind,
    ).toBe("none");

    const reserved: ScanUnit = { unitId: "u3", imei: "353287119902464", status: "reserved" };
    const result = resolveScan("353287119902464", {
      products: [{ product: cable, matchedVia: "primary" }],
      units: [{ unit: reserved, product: phone }],
    });
    expect(result.kind).toBe("product"); // the reserved unit does not make it ambiguous
  });

  it("trims scanner whitespace and treats an empty scan as none", () => {
    expect(normalizeScanCode("  8437123000136\n")).toBe("8437123000136");
    const result = resolveScan("  8437123000136 ", {
      products: [{ product: cable, matchedVia: "primary" }],
      units: [],
    });
    expect(result.kind).toBe("product");
    expect(resolveScan("   ", { products: [{ product: cable, matchedVia: "primary" }], units: [] })).toEqual({
      kind: "none",
      code: "",
    });
  });
});
