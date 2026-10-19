/**
 * Which language a first visit opens in, and the guard against Chrome's
 * translator — found when an owner saw "Boxes" and "Go out" on our dashboard.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
const { localeFromAcceptLanguage } = await import("../server");

describe("a first visit, before anyone picks a language", () => {
  it("opens in English for an English browser", () => {
    expect(localeFromAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en-US")).toBe("en");
  });

  it("opens in Spanish for a Spanish browser", () => {
    expect(localeFromAcceptLanguage("es-ES,es;q=0.9,en;q=0.8")).toBe("es");
  });

  it("takes the browser's FIRST preference", () => {
    expect(localeFromAcceptLanguage("en-GB,es;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("es,en;q=0.8")).toBe("es");
  });

  it("falls back to Spanish for any other language, because we sell in Spain", () => {
    expect(localeFromAcceptLanguage("ur-PK,ur;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("")).toBe("es");
    expect(localeFromAcceptLanguage(undefined)).toBe("es");
  });

  it("finds a supported language further down the list", () => {
    expect(localeFromAcceptLanguage("ur-PK,en;q=0.7")).toBe("en");
  });
});

describe("Chrome's translator stays off our pages", () => {
  const layout = readFileSync(new URL("../../../app/layout.tsx", import.meta.url), "utf8");

  it("marks the whole document as not to be translated", () => {
    expect(layout).toContain('translate="no"');
    expect(layout).toContain("notranslate");
    expect(layout).toContain('google: "notranslate"');
  });
});
