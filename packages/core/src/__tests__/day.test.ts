/**
 * The typed day.
 *
 * The point of this module is that a date means the same thing on a Spanish
 * Windows and an English one, so the cases that matter are the ambiguous
 * spellings (03/09 is 3 September, always) and the impossible ones.
 */
import { describe, expect, it } from "vitest";
import { addDays, dayToInput, parseDayInput, startOfDay } from "../day";

/** Local midnight, the way the parser returns it. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const TODAY = new Date(2026, 8, 1, 14, 30); // 1 September 2026, mid-afternoon

describe("parseDayInput", () => {
  it("reads day first, which is the whole reason it exists", () => {
    // the date a native input would have shown as March 9th on this machine
    expect(parseDayInput("03/09/2026", TODAY)).toBe(day(2026, 9, 3));
  });

  it("takes any separator the number pad can reach", () => {
    for (const s of ["3/9/2026", "03-09-2026", "3.9.2026", "3 9 2026"]) {
      expect(parseDayInput(s, TODAY)).toBe(day(2026, 9, 3));
    }
  });

  it("takes a two-digit year as this century", () => {
    expect(parseDayInput("3/9/26", TODAY)).toBe(day(2026, 9, 3));
  });

  it("takes digits only, so a hand never leaves the number pad", () => {
    expect(parseDayInput("0309", TODAY)).toBe(day(2026, 9, 3));
    expect(parseDayInput("030926", TODAY)).toBe(day(2026, 9, 3));
    expect(parseDayInput("03092026", TODAY)).toBe(day(2026, 9, 3));
  });

  it("returns midnight, not the moment it was typed", () => {
    const ms = parseDayInput("03/09/2026", TODAY)!;
    const d = new Date(ms);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });

  it("with no year, means the NEXT one — a promise is never in the past", () => {
    const december = new Date(2026, 11, 20);
    // typed in December for a January collection: January 2027, not 2026
    expect(parseDayInput("5/1", december)).toBe(day(2027, 1, 5));
    // and today itself still means today
    expect(parseDayInput("1/9", TODAY)).toBe(day(2026, 9, 1));
  });

  it("refuses a day the calendar does not have, instead of rolling it forward", () => {
    // Date(2026, 1, 31) is 3 March. Silently. On a printed promise.
    expect(parseDayInput("31/02/2026", TODAY)).toBeNull();
    expect(parseDayInput("31/04/2026", TODAY)).toBeNull();
    expect(parseDayInput("30/02", TODAY)).toBeNull();
  });

  it("knows a leap year from a lie about one", () => {
    expect(parseDayInput("29/02/2028", TODAY)).toBe(day(2028, 2, 29));
    expect(parseDayInput("29/02/2026", TODAY)).toBeNull();
  });

  it("refuses nonsense rather than guessing at it", () => {
    for (const s of ["", "   ", "abc", "13/13/2026", "0/9/2026", "32/1/2026", "3/9/202", "3//2026", "9", "12345", "3/9/2026/1"]) {
      expect(parseDayInput(s, TODAY)).toBeNull();
    }
  });

  it("refuses a year outside the shop's lifetime, which is a typo", () => {
    expect(parseDayInput("3/9/1926", TODAY)).toBeNull();
    expect(parseDayInput("3/9/9999", TODAY)).toBeNull();
  });

  it("round-trips with dayToInput", () => {
    for (const s of ["03/09/2026", "25/12/2026", "01/01/2030"]) {
      expect(dayToInput(parseDayInput(s, TODAY)!)).toBe(s);
    }
  });
});

describe("dayToInput", () => {
  it("pads, always, so a column of dates lines up", () => {
    expect(dayToInput(new Date(2026, 0, 5))).toBe("05/01/2026");
  });

  it("takes epoch ms as readily as a Date", () => {
    expect(dayToInput(day(2026, 9, 3))).toBe("03/09/2026");
  });
});

describe("startOfDay and addDays", () => {
  it("drops the time of day", () => {
    expect(startOfDay(TODAY).getTime()).toBe(day(2026, 9, 1));
  });

  it("crosses a month end", () => {
    expect(addDays(new Date(2026, 8, 30), 1).getTime()).toBe(day(2026, 10, 1));
  });

  it("crosses a year end", () => {
    expect(addDays(new Date(2026, 11, 31), 7).getTime()).toBe(day(2027, 1, 7));
  });

  it("lands on midnight even when given an afternoon", () => {
    // the chips are built from `new Date()`, which is never midnight
    expect(addDays(TODAY, 1).getTime()).toBe(day(2026, 9, 2));
  });
});
