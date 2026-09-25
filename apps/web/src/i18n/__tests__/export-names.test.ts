/**
 * A report saved from the counter and from a phone is the same file.
 *
 * The cloud's export slugs were hardcoded Spanish, so an English dashboard
 * handed you `informe-ventas-2026-09-25.csv` with English contents inside it —
 * the words followed the staff language (ADR-0016 A1) and the name did not.
 * The till had been doing it correctly all along, which is what makes this a
 * drift rather than an oversight: two halves of one product disagreeing about
 * what a file is called.
 *
 * So the slugs are read from the TILL's own table here, and this fails if the
 * two ever part company again. The till is the reference on purpose: it is the
 * thing the shop uses every day, and its files are already in the gestor's
 * folder.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, translatorFor, type MessageKey } from "../index";

const TILL = join(__dirname, "../../../../../apps/desktop/src/main/reports-export.ts");

/** the `slug: { … }` block for one language out of the till's WORDS table */
function tillSlugs(locale: string): Record<string, string> {
  const source = readFileSync(TILL, "utf8");
  const half = source.slice(source.indexOf(`  ${locale}: {`));
  const block = half.slice(half.indexOf("slug: {"), half.indexOf("},", half.indexOf("slug: {")));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+):\s*"([^"]+)"/g)) out[m[1] ?? ""] = m[2] ?? "";
  return out;
}

/** cloud report → the till's key for the same report */
const SAME_REPORT: Record<string, string> = {
  "file.sales": "sales",
  "file.used": "used",
  "file.valuation": "valuation",
  "file.dead": "deadStock",
};

describe("the till's slugs are the reference", () => {
  it("parsed something to compare against", () => {
    const es = tillSlugs("es");
    expect(es.sales).toBe("informe-ventas");
    expect(Object.keys(es).length).toBeGreaterThanOrEqual(6);
    expect(tillSlugs("en").sales).toBe("sales-report");
  });

  for (const locale of LOCALES) {
    it(`${locale}: every shared report is named the same on both halves`, () => {
      const t = translatorFor(locale);
      const slugs = tillSlugs(locale);
      const drift = Object.entries(SAME_REPORT)
        .filter(([key, tillKey]) => t(key as MessageKey) !== slugs[tillKey])
        .map(([key, tillKey]) => `${key}=${t(key as MessageKey)} vs till ${tillKey}=${slugs[tillKey]}`);
      expect(drift).toEqual([]);
    });
  }
});

describe("every export has a name in every language", () => {
  const KEYS: MessageKey[] = [
    "file.transactions",
    "file.sales",
    "file.repairs",
    "file.used",
    "file.valuation",
    "file.dead",
  ];

  for (const locale of LOCALES) {
    it(`${locale}: all ${KEYS.length} are set, and are safe as a filename`, () => {
      const t = translatorFor(locale);
      for (const key of KEYS) {
        const slug = t(key);
        expect(slug, `${key} has no word`).not.toBe(key);
        /* it ends up in a Content-Disposition header and then on a disk:
           lowercase letters, digits and hyphens, nothing else */
        expect(slug, `${key} is not filename-safe: ${slug}`).toMatch(/^[a-z0-9-]+$/);
      }
    });
  }

  it("names the two languages differently, which was the whole complaint", () => {
    const es = translatorFor("es");
    const en = translatorFor("en");
    for (const key of KEYS) expect(es(key)).not.toBe(en(key));
  });
});
