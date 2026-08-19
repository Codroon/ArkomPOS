import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, marginCents, marginPct, parseMoneyInput } from "../money";

describe("parseMoneyInput", () => {
  it.each([
    ["12,90", 1290],
    ["12.90", 1290],
    ["12", 1200],
    ["12,9", 1290],
    ["12.9", 1290],
    ["0,05", 5],
    ["0", 0],
    [" 12,90 € ", 1290],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.234", 123400], // es-ES thousands
    ["1.234.567", 123456700],
    ["12.905", 1290500], // dot groups = thousands in es-ES
    ["1490", 149000],
  ])("parses %s → %d cents", (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each([["12,345"], ["1,234"], ["abc"], [""], ["12,90,10"], ["1.23.4"], ["-5"], ["12,"], [",90"]])(
    "rejects %s",
    (input) => {
      expect(parseMoneyInput(input)).toBeNull();
    },
  );

  it("round-trips its own formatting", () => {
    for (const cents of [0, 5, 90, 1290, 123456, 99999999]) {
      expect(parseMoneyInput(centsToInput(cents))).toBe(cents);
      expect(parseMoneyInput(formatCents(cents))).toBe(cents);
    }
  });
});

describe("formatCents / centsToInput", () => {
  it.each([
    [1290, "12,90 €"],
    [0, "0,00 €"],
    [5, "0,05 €"],
    [123456, "1.234,56 €"],
    [123456700, "1.234.567,00 €"],
    [-1290, "-12,90 €"],
  ])("formats %d → %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("centsToInput omits the currency symbol", () => {
    expect(centsToInput(1290)).toBe("12,90");
  });
});

describe("margin (handoff 02 field 5)", () => {
  it("matches the spec example: PVP 149,00 − Coste 112,40 → 36,60 € · 24,6%", () => {
    expect(marginCents(14900, 11240)).toBe(3660);
    expect(marginPct(14900, 11240)).toBe(24.6);
  });

  it("is null-safe on zero price", () => {
    expect(marginPct(0, 100)).toBeNull();
  });

  it("can be negative when selling under cost", () => {
    expect(marginCents(1000, 1500)).toBe(-500);
    expect(marginPct(1000, 1500)).toBe(-50);
  });
});
