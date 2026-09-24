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

  it("keeps white off blue, where it is banned", () => {
    expect(cloud["accent-ink"]).toBe("#15181b");
    expect(cloud["accent-ink"]).not.toBe("#ffffff");
  });
});
