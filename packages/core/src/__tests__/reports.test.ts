/**
 * The report foundations: the CSV bytes, the presets, and the margin.
 *
 * The CSV assertions are about BYTES, not about a string that looks right —
 * the BOM, the separator and the decimal comma are the whole reason the file
 * opens correctly when the accountant double-clicks it.
 */
import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  csvDate,
  csvDateTime,
  csvFileName,
  csvMoney,
  csvNumber,
  renderCsv,
} from "../csv";
import {
  COST_BEARING_REPORTS,
  daysBetween,
  isEstimated,
  marginCentsOf,
  marginPctOf,
  reportPermission,
  resolvePreset,
  totalsAgree,
} from "../reports";

/* ---------------------------------------------------------------- csv */

describe("the CSV Excel actually opens", () => {
  const doc = {
    columns: [
      { header: "Artículo", cell: (r: { name: string; cents: number }) => r.name },
      { header: "Valor", cell: (r: { name: string; cents: number }) => csvMoney(r.cents) },
    ],
    rows: [{ name: "Funda silicona", cents: 123456 }],
  };

  it("starts with a BOM, or every accent is mangled", () => {
    const text = renderCsv(doc);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    // and as bytes, which is what actually reaches the disk
    const bytes = Buffer.from(text, "utf8");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("separates with a semicolon, or the whole row lands in column A", () => {
    expect(renderCsv(doc)).toContain("Artículo;Valor");
  });

  it("writes a decimal comma, or Excel reads the number as text", () => {
    expect(renderCsv(doc)).toContain("1234,56");
    expect(renderCsv(doc)).not.toContain("1234.56");
  });

  it("ends every line with CRLF", () => {
    const text = renderCsv(doc);
    expect(text).toContain("\r\n");
    // no bare LF anywhere: a mixed file is the one Excel splits wrongly
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("quotes only what needs quoting", () => {
    const text = renderCsv({
      columns: [{ header: "Nombre", cell: (r: { name: string }) => r.name }],
      rows: [{ name: "Funda; con punto y coma" }, { name: 'Con "comillas"' }, { name: "Normal" }],
    });
    expect(text).toContain('"Funda; con punto y coma"');
    expect(text).toContain('"Con ""comillas"""');
    // a file full of unnecessary quotes is one somebody eventually "fixes"
    expect(text).toContain("\r\nNormal\r\n");
  });

  it("puts the preamble above the header row", () => {
    const text = renderCsv({ ...doc, preamble: ["Ventas — 01/09/2026", "AVISO: margen aproximado", ""] });
    const lines = text.replace(CSV_BOM, "").split("\r\n");
    expect(lines[0]).toBe("Ventas — 01/09/2026");
    expect(lines[1]).toContain("AVISO");
    expect(lines[3]).toBe("Artículo;Valor");
  });

  it("formats money, ratios and dates the Spanish way", () => {
    expect(csvMoney(0)).toBe("0,00");
    expect(csvMoney(5)).toBe("0,05");
    expect(csvMoney(-1250)).toBe("-12,50");
    expect(csvMoney(null)).toBe("");
    expect(csvNumber(24.6, 1)).toBe("24,6");
    expect(csvDate(Date.UTC(2026, 8, 2, 12))).toBe("02/09/2026");
    expect(csvDateTime(new Date(2026, 8, 2, 19, 4).getTime())).toBe("02/09/2026 19:04");
    expect(csvDate(null)).toBe("");
  });

  it("names the file so a folder of them sorts by date", () => {
    expect(csvFileName("informe-ventas", new Date(2026, 8, 2))).toBe("informe-ventas-2026-09-02.csv");
  });
});

/* ------------------------------------------------------------ presets */

describe("date presets", () => {
  // a Wednesday, mid-afternoon
  const now = new Date(2026, 8, 2, 15, 30);

  const days = (r: { fromMs: number; toMs: number }) => Math.round((r.toMs - r.fromMs) / 86_400_000);

  it("is half-open on local day boundaries", () => {
    const today = resolvePreset("today", now);
    expect(new Date(today.fromMs).getHours()).toBe(0);
    // the day AFTER, not 23:59:59.999 — a sentinel is a bug waiting for the one
    // sale that lands on the millisecond
    expect(new Date(today.toMs).getDate()).toBe(3);
    expect(days(today)).toBe(1);
  });

  it("yesterday is exactly the day before, and excludes today", () => {
    const r = resolvePreset("yesterday", now);
    expect(new Date(r.fromMs).getDate()).toBe(1);
    expect(new Date(r.toMs).getDate()).toBe(2);
  });

  it("starts the week on Monday, because Spain's does", () => {
    // 2 September 2026 is a Wednesday, so the week runs from Monday the 31st
    const r = resolvePreset("week", now);
    expect(new Date(r.fromMs).getDay()).toBe(1);
    expect(new Date(r.fromMs).getDate()).toBe(31);
  });

  it("handles a Sunday, which is where a Monday-based week goes wrong", () => {
    const sunday = new Date(2026, 8, 6, 10);
    const r = resolvePreset("week", sunday);
    expect(new Date(r.fromMs).getDay()).toBe(1);
    expect(days(r)).toBe(7); // Monday through Sunday inclusive
  });

  it("month runs from the 1st to today; last month is the whole month", () => {
    const m = resolvePreset("month", now);
    expect(new Date(m.fromMs).getDate()).toBe(1);
    expect(new Date(m.fromMs).getMonth()).toBe(8);

    const last = resolvePreset("lastMonth", now);
    expect(new Date(last.fromMs).getMonth()).toBe(7);
    expect(new Date(last.toMs).getMonth()).toBe(8);
    expect(days(last)).toBe(31); // August
  });

  it("crosses a year boundary without inventing a month", () => {
    const january = new Date(2027, 0, 12, 9);
    const last = resolvePreset("lastMonth", january);
    expect(new Date(last.fromMs).getFullYear()).toBe(2026);
    expect(new Date(last.fromMs).getMonth()).toBe(11);
  });
});

/* ------------------------------------------------------------- margin */

describe("margin", () => {
  it("is revenue minus cost, in exact cents", () => {
    expect(marginCentsOf(38000, 30000)).toBe(8000);
    expect(marginCentsOf(30000, 38000)).toBe(-8000);
  });

  it("is a percentage of revenue, to one decimal", () => {
    expect(marginPctOf(38000, 30000)).toBe(21.1);
    expect(marginPctOf(10000, 10000)).toBe(0);
    expect(marginPctOf(10000, 12000)).toBe(-20);
  });

  it("is undefined rather than zero when nothing was sold", () => {
    // "0,0 %" for a line that sold nothing is a lie the reader will act on
    expect(marginPctOf(0, 0)).toBeNull();
    expect(marginPctOf(0, 500)).toBeNull();
    expect(marginPctOf(-100, 0)).toBeNull();
  });
});

describe("the estimated flag", () => {
  it("is set by a single guessed line", () => {
    expect(isEstimated({ exactLines: 999, estimatedLines: 1 })).toBe(true);
    expect(isEstimated({ exactLines: 999, estimatedLines: 0 })).toBe(false);
  });
});

/* -------------------------------------------------------- the vocabulary */

describe("which reports cost money to look at", () => {
  it("gates the four that show the shop's buying position", () => {
    expect([...COST_BEARING_REPORTS].sort()).toEqual(["deadStock", "repairsClosed", "used", "valuation"]);
  });

  it("lets Sales and the open repairs list through on reports.view", () => {
    // "how many repairs are late" is a question a senior technician should be
    // able to answer for themselves
    expect(reportPermission("sales")).toBe("reports.view");
    expect(reportPermission("repairsOpen")).toBe("reports.view");
    expect(reportPermission("valuation")).toBe("reports.costs");
    expect(reportPermission("repairsClosed")).toBe("reports.costs");
  });
});

describe("totalsAgree", () => {
  it("catches a grouping that lost a row", () => {
    const ungrouped = { netCents: 1000, taxCents: 210, grossCents: 1210 };
    expect(totalsAgree([{ netCents: 600, taxCents: 126, grossCents: 726 }, { netCents: 400, taxCents: 84, grossCents: 484 }], ungrouped)).toBe(true);
    // the most common reporting bug there is, and the most plausible-looking
    expect(totalsAgree([{ netCents: 600, taxCents: 126, grossCents: 726 }], ungrouped)).toBe(false);
  });
});

describe("daysBetween", () => {
  it("floors, because 23 hours is not a day held", () => {
    const day = 86_400_000;
    expect(daysBetween(0, day * 3)).toBe(3);
    expect(daysBetween(0, day * 3 - 1)).toBe(2);
    expect(daysBetween(0, 0)).toBe(0);
  });
});
