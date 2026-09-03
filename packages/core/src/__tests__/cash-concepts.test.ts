/**
 * Whose words are those? — v0.18.1.
 *
 * ADR-0011 draws the line between app copy, which the toggle translates, and
 * shop data, which it never touches. The drawer's five starter concepts sat on
 * the wrong side of it: nobody in the shop typed them, we did, and an English
 * till was showing our Spanish back to its owner as though it were theirs.
 */
import { describe, expect, it } from "vitest";
import { displayCashConcepts, isStarterCashConcepts, STARTER_CASH_CONCEPTS } from "../cash-concepts";

describe("the list the till ships with", () => {
  it("follows the reader's language while it is still ours", () => {
    expect(displayCashConcepts(STARTER_CASH_CONCEPTS.es, "en")).toEqual([...STARTER_CASH_CONCEPTS.en]);
    expect(displayCashConcepts(STARTER_CASH_CONCEPTS.en, "es")).toEqual([...STARTER_CASH_CONCEPTS.es]);
    // and back, so the toggle is not a one-way door
    expect(displayCashConcepts(STARTER_CASH_CONCEPTS.es, "es")).toEqual([...STARTER_CASH_CONCEPTS.es]);
  });

  it("is recognised in either language, ignoring stray whitespace", () => {
    expect(isStarterCashConcepts(STARTER_CASH_CONCEPTS.es)).toBe(true);
    expect(isStarterCashConcepts(STARTER_CASH_CONCEPTS.en)).toBe(true);
    expect(isStarterCashConcepts(STARTER_CASH_CONCEPTS.es.map((l) => ` ${l} `))).toBe(true);
  });
});

describe("the moment the shop makes it theirs", () => {
  it("freezes as typed, in every language", () => {
    const theirs = ["Al banco", "Proveedor Ahmed", "Gastos", "Cambio para la caja", "Corrección de arqueo"];
    expect(isStarterCashConcepts(theirs)).toBe(false);
    expect(displayCashConcepts(theirs, "en")).toEqual(theirs);
    expect(displayCashConcepts(theirs, "es")).toEqual(theirs);
  });

  it("counts adding a line as making it theirs", () => {
    const plusOne = [...STARTER_CASH_CONCEPTS.es, "Comida"];
    expect(isStarterCashConcepts(plusOne)).toBe(false);
    expect(displayCashConcepts(plusOne, "en")).toEqual(plusOne);
  });

  it("counts removing one, too", () => {
    const minusOne = STARTER_CASH_CONCEPTS.en.slice(0, 4);
    expect(isStarterCashConcepts(minusOne)).toBe(false);
    expect(displayCashConcepts(minusOne, "es")).toEqual(minusOne);
  });

  it("counts editing a single word", () => {
    const edited = [...STARTER_CASH_CONCEPTS.en];
    edited[1] = "Supplier invoice";
    expect(isStarterCashConcepts(edited)).toBe(false);
    expect(displayCashConcepts(edited, "es")).toEqual(edited);
  });

  it("leaves an empty list alone rather than inventing one", () => {
    expect(isStarterCashConcepts([])).toBe(false);
    expect(displayCashConcepts([], "en")).toEqual([]);
  });

  it("does not reorder the shop's own list into ours", () => {
    // same five words, different order: the shop moved them, so they are theirs
    const reordered = [...STARTER_CASH_CONCEPTS.es].reverse();
    expect(isStarterCashConcepts(reordered)).toBe(false);
    expect(displayCashConcepts(reordered, "en")).toEqual(reordered);
  });
});
