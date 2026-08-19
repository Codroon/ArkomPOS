import { describe, expect, it } from "vitest";
import { imeiCheckDigit, imeiWithCheckDigit, isValidImei } from "../imei";

describe("IMEI (15 digits + Luhn, req 6.1)", () => {
  it("validates the canonical published example", () => {
    expect(isValidImei("490154203237518")).toBe(true); // classic GSM doc example
    expect(imeiCheckDigit("49015420323751")).toBe(8);
  });

  it("round-trips its own check digit", () => {
    for (const base of ["35693810442003", "86209104778120", "35328711990245"]) {
      expect(isValidImei(imeiWithCheckDigit(base))).toBe(true);
    }
  });

  it("rejects tampered, short, long and non-numeric codes", () => {
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
    expect(isValidImei("4901542032375188")).toBe(false);
    expect(isValidImei("49015420323751a")).toBe(false);
    expect(isValidImei("")).toBe(false);
  });

  it("throws on malformed bases", () => {
    expect(() => imeiCheckDigit("123")).toThrow();
  });
});
