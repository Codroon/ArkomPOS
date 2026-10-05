/**
 * Our words vs the shop's words — ADR-0011, the one implementation.
 *
 * The cloud's own test exercises `displayTillName` through its `tillName`
 * wrapper in anger. What is here is the part both halves depend on and neither
 * had covered: the location name, the empty case the renderer leans on, and the
 * boundary that keeps a shop's own word safe.
 *
 * This line has now been crossed five times in this product, each found by a
 * human looking at an English screen and seeing Spanish. The fifth was a
 * second till called "Caja 2", which the old code filed under "the shop's word"
 * because it held our prefill as a literal and a prefill is only ever number
 * one. Hence a pattern, hence one copy, hence this file.
 */
import { describe, expect, it } from "vitest";
import {
  displayLocationName,
  displayTillName,
  isOurTillName,
  OUR_SHOP_PREFILL,
  OUR_TILL_PREFILL,
} from "../our-words";

describe("a till's name", () => {
  it("keeps the number our prefill never had", () => {
    /* the prefill is "Caja 1"; every till after the first is the shop typing
       over it, and those are still our word */
    expect(displayTillName("Caja 2", "en")).toBe("Till 2");
    expect(displayTillName("Caja 7", "en")).toBe("Till 7");
    expect(displayTillName("Till 3", "es")).toBe("Caja 3");
  });

  it("returns the shop's own word untouched, in both languages", () => {
    for (const theirs of ["Mostrador", "Taller", "TPV 1", "Planta 1", "Caja de seguridad", "Cajas"]) {
      expect(displayTillName(theirs, "en"), theirs).toBe(theirs);
      expect(displayTillName(theirs, "es"), theirs).toBe(theirs);
    }
  });

  it("answers empty for nothing, and lets the caller decide what to show", () => {
    /* the renderer substitutes its own dash; a query substitutes nothing. The
       rule about WORDS has no business picking a placeholder. */
    for (const nothing of ["", "   ", null, undefined]) {
      expect(displayTillName(nothing, "es")).toBe("");
    }
  });

  it("can be asked rather than only rendered", () => {
    expect(isOurTillName("Caja 2")).toBe(true);
    expect(isOurTillName("Till")).toBe(true);
    expect(isOurTillName("Mostrador")).toBe(false);
    expect(isOurTillName(null)).toBe(false);
  });
});

describe("a location's name", () => {
  it("translates the prefill onboarding writes without thinking", () => {
    /* "Tienda" was missed the first time this rule was applied, so an English
       till read "Tienda · Till 1" — half our prefill translated, half not */
    expect(displayLocationName("Tienda", "en")).toBe("Shop");
    expect(displayLocationName("Shop", "es")).toBe("Tienda");
  });

  it("leaves a real address or branch name alone", () => {
    for (const theirs of ["Alcalá", "Calle Mayor", "Tienda Centro", "Almacén"]) {
      expect(displayLocationName(theirs, "en"), theirs).toBe(theirs);
    }
  });

  it("takes no number, because nobody writes Tienda 2", () => {
    /* if that changes, this case is the reminder to widen the pattern rather
       than to discover it on a customer's screen */
    expect(displayLocationName("Tienda 2", "en")).toBe("Tienda 2");
  });
});

describe("the prefills the wizard uses", () => {
  it("are themselves recognised as ours", () => {
    /* a prefill the rule does not recognise would be a prefill that never
       follows the toggle — which is exactly the bug, in its first form */
    expect(displayTillName(OUR_TILL_PREFILL.es, "en")).toBe(OUR_TILL_PREFILL.en);
    expect(displayTillName(OUR_TILL_PREFILL.en, "es")).toBe(OUR_TILL_PREFILL.es);
    expect(displayLocationName(OUR_SHOP_PREFILL.es, "en")).toBe(OUR_SHOP_PREFILL.en);
    expect(displayLocationName(OUR_SHOP_PREFILL.en, "es")).toBe(OUR_SHOP_PREFILL.es);
  });
});
