/**
 * The window a screen is looking at.
 *
 * Two things here are easy to get wrong and expensive when they are: the shop's
 * day is decided in Madrid and not on whatever machine renders the page, and a
 * URL is something people edit, paste and truncate. A gestor asking for "the
 * 1st to the 17th" and getting the last thirty days, silently, is the kind of
 * wrong that gets found in a tax return.
 *
 * The clock is injected, so these cases are the same in August and in January
 * and on a CI box set to UTC.
 */
import { describe, expect, it } from "vitest";
import {
  describePeriod,
  parseRange,
  previousPeriod,
  rangeParams,
  shopToday,
} from "../range";

/* a winter afternoon in Madrid (CET, UTC+1) */
const WINTER = new Date("2026-01-15T14:00:00Z");
/* 00:30 in Madrid on 1 July is 22:30 UTC on 30 June — the case that matters */
const SUMMER_MIDNIGHT = new Date("2026-06-30T22:30:00Z");

describe("the shop's day", () => {
  it("is Madrid's, not the server's", () => {
    expect(shopToday(WINTER)).toBe("2026-01-15");
  });

  it("has already turned over at 00:30 Madrid, when UTC still says yesterday", () => {
    /* a sale rung up at half past midnight belongs to the day the shop thinks
       it does. Reading this in UTC would file it under the day before. */
    expect(SUMMER_MIDNIGHT.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(shopToday(SUMMER_MIDNIGHT)).toBe("2026-07-01");
  });
});

describe("the presets", () => {
  it("counts today as one of the days", () => {
    const p = parseRange("7d", undefined, undefined, WINTER);
    expect(p).toMatchObject({ key: "7d", from: "2026-01-09", to: "2026-01-15", days: 7 });
  });

  it("makes today a window of one day, not of none", () => {
    const p = parseRange("today", undefined, undefined, WINTER);
    expect(p).toMatchObject({ from: "2026-01-15", to: "2026-01-15", days: 1 });
  });

  it("defaults rather than throwing, because a URL gets edited", () => {
    for (const bad of [undefined, "", "3000d", "yesterday", "../../etc"]) {
      expect(parseRange(bad, undefined, undefined, WINTER).key).toBe("30d");
    }
  });

  it("gives the previous window the same length, ending the day before", () => {
    const p = parseRange("7d", undefined, undefined, WINTER);
    expect(previousPeriod(p)).toEqual({ from: "2026-01-02", to: "2026-01-08" });
  });
});

describe("a custom window", () => {
  it("is taken as given, inclusive at both ends", () => {
    const p = parseRange("custom", "2026-01-01", "2026-01-10", WINTER);
    expect(p).toMatchObject({ key: "custom", from: "2026-01-01", to: "2026-01-10", days: 10 });
  });

  it("swaps a back-to-front pair instead of showing an empty screen", () => {
    const p = parseRange("custom", "2026-01-10", "2026-01-01", WINTER);
    expect(p).toMatchObject({ from: "2026-01-01", to: "2026-01-10" });
  });

  it("clamps a window that runs into the future", () => {
    /* nothing has happened tomorrow; showing an empty half looks like a fault */
    const p = parseRange("custom", "2026-01-10", "2026-03-01", WINTER);
    expect(p.to).toBe("2026-01-15");
  });

  it("falls back to the default when a date is missing or malformed", () => {
    for (const [from, to] of [
      ["2026-01-01", undefined],
      [undefined, "2026-01-17"],
      ["01/01/2026", "2026-01-17"],
      ["2026-13-45", "2026-01-17"],
      ["", ""],
    ] as const) {
      expect(parseRange("custom", from, to, WINTER).key).toBe("30d");
    }
  });

  it("counts a single day as one", () => {
    const p = parseRange("custom", "2026-01-05", "2026-01-05", WINTER);
    expect(p.days).toBe(1);
  });

  it("spans a month boundary and a leap day correctly", () => {
    const p = parseRange("custom", "2028-02-01", "2028-03-01", new Date("2028-06-01T12:00:00Z"));
    /* 29 days in February 2028, plus the 1st of March */
    expect(p.days).toBe(30);
  });
});

describe("the window survives a link", () => {
  it("carries three parameters when it is custom and one when it is not", () => {
    expect(rangeParams(parseRange("30d", undefined, undefined, WINTER))).toEqual({ range: "30d" });
    expect(rangeParams(parseRange("custom", "2026-01-01", "2026-01-10", WINTER))).toEqual({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-10",
    });
  });

  it("round-trips: what a link carries parses back to the same window", () => {
    const p = parseRange("custom", "2026-01-01", "2026-01-10", WINTER);
    const q = rangeParams(p);
    expect(parseRange(q.range, q.from, q.to, WINTER)).toEqual(p);
  });
});

describe("saying which window is on screen", () => {
  it("reads as a range in each language, and as one date when it is one day", () => {
    const week = parseRange("custom", "2026-01-01", "2026-01-10", WINTER);
    expect(describePeriod(week, "es")).toContain("–");
    expect(describePeriod(week, "en")).toContain("–");
    const day = parseRange("today", undefined, undefined, WINTER);
    expect(describePeriod(day, "es")).not.toContain("–");
  });
});
