import { describe, expect, it } from "vitest";
import { ean13CheckDigit, generateInternalEan13, isValidEan13 } from "../barcode";

describe("ean13CheckDigit", () => {
  it("computes known GS1 check digits", () => {
    // classic published examples
    expect(ean13CheckDigit("400638133393")).toBe(1); // 4006381333931
    expect(ean13CheckDigit("978030640615")).toBe(7); // ISBN-13 example
    expect(ean13CheckDigit("841234500012")).toBe(6); // seed's own generator base
  });

  it("throws on malformed bases", () => {
    expect(() => ean13CheckDigit("123")).toThrow();
    expect(() => ean13CheckDigit("12345678901a")).toThrow();
  });
});

describe("isValidEan13", () => {
  it("accepts valid codes and rejects tampered ones", () => {
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("400638133393")).toBe(false);
    expect(isValidEan13("40063813339314")).toBe(false);
  });
});

describe("generateInternalEan13", () => {
  it("is deterministic with an injected digit source", () => {
    expect(generateInternalEan13(() => "0123456789")).toBe(`20${"0123456789"}${ean13CheckDigit("200123456789")}`);
  });

  it("always emits a 13-digit in-store ('20') code with a valid check digit", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateInternalEan13();
      expect(code).toMatch(/^20\d{11}$/);
      expect(isValidEan13(code)).toBe(true);
    }
  });
});
