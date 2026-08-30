/**
 * Spanish written by the APP must not survive into an English till.
 *
 * A shop's own words are never translated — a product they called "Funda azul"
 * is their word for their thing. But the buy screen writes two names itself, in
 * Spanish, on every till: the "Usados" group it files second-hand devices under,
 * and the "(usado)" marker it appends to each product name. On an English till
 * those were the only Spanish left on the screen.
 */
import { describe, expect, it } from "vitest";
import { translateData } from "@arkom/ui";

describe("names the app wrote itself", () => {
  it("translates the group the buy screen creates", () => {
    expect(translateData("en", "Usados")).toBe("Used");
    expect(translateData("es", "Usados")).toBe("Usados");
  });

  it("translates the used marker while leaving the model alone", () => {
    const name = "Apple iPhone SE 2020 64GB Blanco (usado)";
    // the model is the shop's; only the marker is ours to change
    expect(translateData("en", name)).toBe("Apple iPhone SE 2020 64GB Blanco (used)");
    expect(translateData("es", name)).toBe(name);
  });
});

describe("names the shop wrote", () => {
  it("leaves them exactly as typed, in either language", () => {
    for (const name of ["Funda azul", "Cable USB-C 2m", "Reparación pantalla"]) {
      expect(translateData("en", name)).toBe(name);
      expect(translateData("es", name)).toBe(name);
    }
  });

  it("does not touch a name that merely mentions the word", () => {
    // only the exact trailing marker counts, not the word wherever it appears
    expect(translateData("en", "Funda (usado) protectora")).toBe("Funda (usado) protectora");
  });
});
