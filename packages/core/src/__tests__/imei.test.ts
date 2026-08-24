import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { imeiCheckDigit, imeiWithCheckDigit, isValidImei, validateImeiBatch } from "../imei";

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

describe("validateImeiBatch (serialized stock entry, req 6.1)", () => {
  const a = imeiWithCheckDigit("35693810442003");
  const b = imeiWithCheckDigit("86209104778120");
  const c = imeiWithCheckDigit("35328711990245");

  const codeOf = (fn: () => unknown): string => {
    try {
      fn();
      return "NO_THROW";
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      return (err as AppError).ipc.code;
    }
  };

  it("accepts exactly expectedQty distinct valid IMEIs and trims them", () => {
    expect(validateImeiBatch({ expectedQty: 3, imeis: [a, ` ${b} `, c] })).toEqual([a, b, c]);
  });

  it("rejects a short batch — the panel keeps Confirmar disabled until the count matches", () => {
    expect(codeOf(() => validateImeiBatch({ expectedQty: 3, imeis: [a, b] }))).toBe("VALIDATION");
  });

  it("rejects an over-long batch", () => {
    expect(codeOf(() => validateImeiBatch({ expectedQty: 1, imeis: [a, b] }))).toBe("VALIDATION");
  });

  it("rejects an invalid check digit", () => {
    expect(codeOf(() => validateImeiBatch({ expectedQty: 1, imeis: ["353287119902457"] }))).toBe("VALIDATION");
  });

  it("rejects a duplicate inside the same batch", () => {
    expect(codeOf(() => validateImeiBatch({ expectedQty: 2, imeis: [a, a] }))).toBe("DUPLICATE_IMEI");
  });

  it("rejects a nonsense quantity", () => {
    expect(codeOf(() => validateImeiBatch({ expectedQty: 0, imeis: [] }))).toBe("VALIDATION");
  });
});
