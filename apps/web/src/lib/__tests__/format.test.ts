/**
 * Money on its way to a screen.
 *
 * Two things here have already been wrong in shipped code, and both are the
 * kind a Spanish shop notices immediately:
 *
 *   · the sales chart's tooltip printed "549.90 €" — an English decimal point
 *     — while the four figures directly above it said "549,90 €", because it
 *     built its own string with `toFixed(2)` instead of asking the formatter;
 *   · its axis printed a bare "10000", no separator and no unit, because the
 *     tick was `String(Math.round(cents / 100))`. Fine at 600, unreadable at
 *     the five figures a real shop turns over.
 *
 * There is no ceiling on that axis and never was — Recharts scales it to the
 * data. The cases below are about what it SAYS once the data gets big.
 */
import { describe, expect, it } from "vitest";
import { axisEuros, euros } from "../format";

/* non-breaking spaces and narrow no-break spaces come out of Intl; comparing
   them literally is how this test fails for no reason on another Node */
const flat = (s: string) => s.replace(/ | /g, " ");

describe("a figure with money in it", () => {
  it("uses Spanish separators — comma for decimals, dot for thousands", () => {
    expect(flat(euros(54990))).toBe("549,90 €");
    expect(flat(euros(1234567))).toBe("12.345,67 €");
  });

  it("keeps both decimal places, because money has two", () => {
    expect(flat(euros(500))).toBe("5,00 €");
    expect(flat(euros(0))).toBe("0,00 €");
  });

  it("carries a negative through — a refund is a real figure", () => {
    expect(flat(euros(-1290))).toBe("-12,90 €");
  });
});

describe("a chart axis, at the sizes a shop actually reaches", () => {
  it("reads plainly below a thousand", () => {
    expect(flat(axisEuros(0))).toBe("0");
    expect(flat(axisEuros(60000))).toBe("600");
    expect(flat(axisEuros(99900))).toBe("999");
  });

  it("switches to thousands rather than printing five digits", () => {
    /* this is the case the old tick got wrong: it printed "10000" */
    expect(flat(axisEuros(1_000_00))).toBe("1 k");
    expect(flat(axisEuros(5_000_00))).toBe("5 k");
    expect(flat(axisEuros(10_000_00))).toBe("10 k");
    expect(flat(axisEuros(12_500_00))).toBe("12,5 k");
    expect(flat(axisEuros(250_000_00))).toBe("250 k");
  });

  it("goes to millions for a year's takings", () => {
    expect(flat(axisEuros(1_000_000_00))).toBe("1 M");
    expect(flat(axisEuros(2_400_000_00))).toBe("2,4 M");
  });

  it("stays short enough for the gutter it sits in", () => {
    /* the axis reserves 56px at 11px type — about six characters */
    for (const cents of [0, 60000, 99900, 1_000_00, 12_500_00, 250_000_00, 2_400_000_00]) {
      expect(flat(axisEuros(cents)).length).toBeLessThanOrEqual(6);
    }
  });

  it("handles a negative day, which a refund-heavy one can be", () => {
    expect(flat(axisEuros(-5_000_00))).toBe("-5 k");
  });
});
