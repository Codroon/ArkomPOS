/**
 * The layout rules, as assertions over the source rather than as good intentions.
 *
 * Every defect pinned here was found by driving a real browser through the panel
 * at 390×844 and measuring, and every one of them had survived months of being
 * looked at:
 *
 *   · four KPI figures drawn on top of one another, and six on the reports
 *     screen — "506,1106,289 2,40 €" where three fiscal totals should be;
 *   · a table cutting 269,00 € down to "269" on a 1440px laptop;
 *   · the page itself scrolling sideways by 188px;
 *   · 92 links 17px tall, the only way into a transaction.
 *
 * A browser-driven audit catches those directly and is the right tool, but it
 * needs a server, a session and real rows, so it cannot run in `pnpm test`. What
 * CAN run here is the rule each fix rests on — the shapes in the source that let
 * the bug exist. A regression has to get past these first.
 *
 * This is a source test on purpose. It is not a substitute for looking; it is
 * what stops the next person from re-introducing a thing nobody would look for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith(".tsx") ? [path] : [];
  });

const screens = walk(join(ROOT, "app"));
const ui = walk(join(ROOT, "src/ui"));
const read = (path: string) => readFileSync(path, "utf8");
const rel = (path: string) => path.slice(ROOT.length + 1).replace(/\\/g, "/");

describe("a figure is never cut off", () => {
  /**
   * `min-width` on a table is what did the damage. A grid or flex child defaults
   * to `min-width:auto` — "at least as wide as my content wants" — so a table
   * with a floor pushes its CARD past the column, taking the page with it, and
   * the `overflow-x-auto` wrapper meant to catch it never sees an overflow
   * because nothing overflowed.
   */
  it("no component sets a minimum width on a table", () => {
    const offenders = [...screens, ...ui].filter((path) => {
      const source = read(path);
      return /min-w-\[\d{3,}px\]/.test(source) && /<table|DataTable/.test(source);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("every box that can hold a table starts at min-w-0", () => {
    const source = read(join(ROOT, "src/ui/index.tsx"));
    /* Card and CardBody are the two containers a DataTable is ever put in */
    expect(source).toMatch(/export function Card\([^)]*\)[\s\S]{0,400}?min-w-0/);
    expect(source).toMatch(/export const CardBody[\s\S]{0,300}?min-w-0/);
  });

  it("the big figure shrinks before its box does", () => {
    const source = read(join(ROOT, "src/ui/index.tsx"));
    /* a clamp, not a fixed size: four of these sit side by side */
    expect(source).toMatch(/lg:\s*"text-\[clamp\(/);
    expect(source).toContain("whitespace-nowrap");
  });
});

describe("the KPI row wraps instead of squeezing", () => {
  /**
   * Flex children with `min-width:0` SHRINK rather than wrap, so four stats in
   * 390px became four 95px columns with their labels overlapping. A grid gives
   * each cell a floor and moves to the next row.
   */
  it("StatGrid is a grid and never a wrapping flex row", () => {
    const source = read(join(ROOT, "src/ui/index.tsx"));
    const block = source.slice(source.indexOf("export const StatGrid"));
    expect(block).toContain("grid");
    expect(block.slice(0, 400)).not.toContain("flex-wrap");
  });

  it("no screen lays figures out with flex-wrap + divide-x", () => {
    const offenders = screens.filter((path) => /flex flex-wrap divide-line/.test(read(path)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("a phone is not given a table to swipe", () => {
  it("every screen goes through DataTable rather than raw table markup", () => {
    const offenders = screens.filter((path) => /<table[\s>]/.test(read(path)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("DataTable renders a card list below md and a table at md and up", () => {
    const source = read(join(ROOT, "src/ui/data-table.tsx"));
    expect(source).toMatch(/md:hidden/); // the cards
    expect(source).toMatch(/hidden[^"]*md:block/); // the table
  });

  it("a card's figures are laid on equal columns, so lists line up", () => {
    const source = read(join(ROOT, "src/ui/data-table.tsx"));
    expect(source).toContain("minmax(0, 1fr)");
  });
});

describe("things can be tapped", () => {
  /**
   * WCAG 2.5.8 puts the floor at 24px; the platforms say 44. The controls here
   * are h-9 (36) at the smallest and h-10/h-11 for anything a thumb aims at,
   * and a whole row is the target on a phone rather than the 17px number inside
   * it.
   */
  it("the shared control classes are at least 36px tall", () => {
    const source = read(join(ROOT, "src/ui/index.tsx"));
    for (const name of ["inputClass", "primaryClass", "ghostClass", "quietClass"]) {
      const line = source.slice(source.indexOf(`export const ${name}`));
      const height = line.match(/\bh-(\d+)\b/);
      expect(height, `${name} declares no height`).not.toBeNull();
      expect(Number(height![1]) * 4).toBeGreaterThanOrEqual(36);
    }
  });

  it("a row with a destination is a link as a whole, not a link inside it", () => {
    const source = read(join(ROOT, "src/ui/data-table.tsx"));
    /* the phone card wraps its entire body in the Link */
    expect(source).toMatch(/<Link href=\{rowHref\(row\)\} className="block px-4 py-3\.5/);
  });
});

describe("the shell", () => {
  it("keeps the phone's navigation on screen instead of in a sideways strip", () => {
    const source = read(join(ROOT, "app/panel/chrome.tsx"));
    expect(source).toContain("fixed inset-x-0 bottom-0");
    /* and clears the home indicator under it */
    expect(source).toContain("env(safe-area-inset-bottom)");
  });

  it("remembers whether the rail is collapsed, on the server", () => {
    expect(read(join(ROOT, "app/panel/chrome.tsx"))).toContain("RAIL_COOKIE");
    /* read in the layout so the FIRST paint is the right width */
    expect(read(join(ROOT, "app/panel/layout.tsx"))).toContain("RAIL_COOKIE");
  });

  /**
   * This one is here because it already happened, and it happened SILENTLY.
   *
   * `RAIL_COOKIE` was exported from `chrome.tsx`, which carries `"use client"`,
   * and the layout imported it from there to read on the server. It compiles
   * and it renders — but a Server Component importing from a client module gets
   * a client reference, so the name arrived as undefined, `cookies().get(...)`
   * found nothing, and the rail expanded itself on every navigation while the
   * cookie sat there saying collapsed. No error, no warning, just a feature
   * that does not work.
   */
  it("keeps a cookie NAME out of client-only modules, since the server reads it", () => {
    const prefs = read(join(ROOT, "src/lib/prefs.ts"));
    expect(prefs).toContain("RAIL_COOKIE");
    /* the DIRECTIVE, which must be the first thing in a file — not the words,
       which this module's own comment is entitled to use */
    expect(prefs.trimStart().startsWith('"use client"')).toBe(false);

    const defined = [...screens, ...ui].filter(
      (path) => /export const [A-Za-z_]*_COOKIE/.test(read(path)) && read(path).startsWith('"use client"'),
    );
    expect(defined.map(rel)).toEqual([]);
  });

  it("only offers the period where a period means something", () => {
    const source = read(join(ROOT, "app/panel/chrome.tsx"));
    const list = source.slice(source.indexOf("const RANGE_SCREENS"));
    expect(list).toContain("/panel/ventas");
    expect(list).toContain("/panel/informes");
    /* the catalogue is the shop as it stands now, not a period */
    expect(list.slice(0, 200)).not.toContain("/panel/catalogo");
  });
});

describe("the brand rules still hold", () => {
  /**
   * One file is allowed literal colour, because SVG leaves no choice: Recharts
   * sets `fill` as an ATTRIBUTE, and an attribute does not resolve `var(...)`.
   * An exception is only safe if something checks it, so rather than exempting
   * the file this asserts every value in it IS a token — change a token and
   * this fails until the chart follows.
   */
  it("keeps every literal colour in one file, and every one of them is a token", () => {
    const tokens = read(join(ROOT, "app/globals.css"));
    const source = read(join(ROOT, "src/ui/chart-colors.ts"));
    const literals = [...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);

    expect(literals.length).toBeGreaterThan(4);
    for (const hex of literals) {
      expect(tokens, `${hex} is in chart-colors but in no token`).toContain(hex);
    }
  });

  it("puts no raw hex anywhere else", () => {
    const offenders = [...screens, ...ui].filter(
      (path) => !path.endsWith("chart-colors.ts") && /#[0-9a-fA-F]{6}\b/.test(read(path)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("never puts white on the accent", () => {
    const offenders = [...screens, ...ui].filter((path) =>
      /bg-accent[^"]*text-white|text-white[^"]*bg-accent/.test(read(path)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
