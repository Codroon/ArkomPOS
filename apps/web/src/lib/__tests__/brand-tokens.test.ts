/**
 * The two halves agree about the brand.
 *
 * The till's tokens live in `packages/ui/src/styles/tokens.css` and the cloud
 * keeps a copy, because that file also pulls in font faces packaged for
 * Electron. A copy rots silently: somebody adjusts the blue on the till, the
 * web keeps the old one, and the product starts looking like two products made
 * by two companies.
 *
 * So the copy is checked. If this fails, the fix is to bring the web's `@theme`
 * block back in line with the till's — never the other way round: the till is
 * where the colours were chosen and where they are seen across a shop.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (...parts: string[]) => readFileSync(join(__dirname, "../../..", ...parts), "utf8");

/** `--color-name: #hex;` → { name: "#hex" }, comments and spacing ignored. */
function colours(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    out[match[1]!] = match[2]!.toLowerCase();
  }
  return out;
}

const till = colours(read("../../packages/ui/src/styles/tokens.css"));
const cloud = colours(read("app/globals.css"));

describe("the colours the cloud uses", () => {
  it("are the till's, value for value", () => {
    const drifted = Object.entries(cloud)
      .filter(([name, value]) => till[name] && till[name] !== value)
      .map(([name, value]) => `--color-${name}: web ${value} vs till ${till[name]}`);

    expect(drifted).toEqual([]);
  });

  it("include the ones the brand rules are about", () => {
    /* if these are missing, a screen will invent its own and the rules about
       where blue may land stop meaning anything */
    for (const name of ["canvas", "ink", "accent", "accent-ink", "line", "card", "muted"]) {
      expect(cloud[name], `--color-${name} is missing from the web theme`).toBeTruthy();
    }
  });

  it("names no colour the till has never heard of", () => {
    /* a token invented here is a token the till cannot honour, which is how a
       second palette starts */
    const invented = Object.keys(cloud).filter((name) => !till[name]);
    expect(invented).toEqual([]);
  });

});

/* WCAG relative luminance, so the rules can be asserted as the PROPERTY they
   are about rather than as a hex somebody has to remember to update. */
function luminance(hex: string): number {
  const channel = (pair: string) => {
    const v = parseInt(pair, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("the contrast bans, as contrast", () => {
  it("puts readable ink on the accent", () => {
    expect(contrast(cloud["accent-ink"]!, cloud["accent"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("proves white on the accent really would fail, which is why it is banned", () => {
    /* the ban is not taste. If a future accent made white legible this would go
       green and the rule could be revisited on evidence. */
    expect(contrast("#ffffff", cloud["accent"]!)).toBeLessThan(4.5);
  });

  it("keeps body ink strong on the canvas", () => {
    expect(contrast(cloud["ink"]!, cloud["canvas"]!)).toBeGreaterThanOrEqual(7);
    expect(contrast(cloud["ink-2"]!, cloud["canvas"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps LABELS readable, which is where a warm gray goes wrong", () => {
    /* Codroon's #8a857a is tertiary text on a DARK page; on Bone it lands near
       3:1. Labels and table headers use --color-muted, so it has to hold 4.5. */
    expect(contrast(cloud["muted"]!, cloud["canvas"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the chrome legible on the inverse surface", () => {
    expect(contrast(cloud["inverse-ink"]!, cloud["inverse"]!)).toBeGreaterThanOrEqual(7);
    expect(contrast(cloud["inverse-muted"]!, cloud["inverse"]!)).toBeGreaterThanOrEqual(3);
  });
});
