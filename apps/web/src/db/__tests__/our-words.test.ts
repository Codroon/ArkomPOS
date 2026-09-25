/**
 * Our words follow the language toggle. The shop's words never do.
 *
 * This line has now been crossed four times, in four places, each found by
 * someone looking at an English screen and seeing Spanish:
 *
 *   · the starter shelves ("Fundas y carcasas"), which ship with an English
 *     name the cloud was ignoring;
 *   · the "(usado)" the till appends to a used device's catalogue name;
 *   · "Caja 1", the till's own prefilled name, shown raw under a column headed
 *     "Till";
 *   · "Tienda", the location prefill, which the till itself translated the
 *     terminal beside and not this.
 *
 * Each time the temptation is to translate a bit more, and each time the answer
 * is the same: rewrite ONLY where the text is one WE wrote. "Negro" is the
 * colour somebody chose for that phone. Translating it would invent data, and
 * it would make the dashboard disagree with the receipt in the customer's hand.
 *
 * The SQL helpers here are `sql.raw` fragments, so these cases check the
 * FRAGMENT — that Spanish leaves the row alone, that English reaches for the
 * right column, and that the rewrite is anchored so it cannot fire in the
 * middle of a name. `tillName` is plain TypeScript and is exercised directly.
 */
import { describe, expect, it } from "vitest";
import { groupName, productName, tillName, OUR_TILL_NAMES } from "../our-words";

/** what the fragment will put into the query */
const raw = (fragment: { queryChunks?: unknown[] }) =>
  JSON.stringify(fragment.queryChunks ?? fragment);

describe("a shelf's name", () => {
  it("is left alone in Spanish", () => {
    expect(raw(groupName("g.row", "es"))).toContain("g.row->>'name'");
    expect(raw(groupName("g.row", "es"))).not.toContain("nameEn");
  });

  it("prefers the English name the till shipped, in English", () => {
    const sql = raw(groupName("g.row", "en"));
    expect(sql).toContain("nameEn");
    /* and falls back to the shop's own name — a group they created has none */
    expect(sql).toContain("g.row->>'name'");
  });

  it("treats an empty translation as no translation", () => {
    /* coalesce would happily take "" and blank the column */
    expect(raw(groupName("g.row", "en"))).toContain("nullif");
  });
});

describe("a used device's catalogue name", () => {
  it("is left alone in Spanish", () => {
    expect(raw(productName("p.row->>'name'", "es"))).not.toContain("regexp_replace");
  });

  it("rewrites only our suffix, anchored to the end", () => {
    const sql = raw(productName("p.row->>'name'", "en"));
    expect(sql).toContain("usado");
    expect(sql).toContain("(used)");
    /* `$` matters: without it, a shop's "Funda (usado) azul" would be mangled
       in the middle, and a name that never had the suffix would be untouched
       only by luck */
    expect(sql).toContain("$'");
  });

  it("carries no backslash, because one cannot survive the trip", () => {
    /*
     * This is the case that would have caught the first version. The pattern
     * is written in a TEMPLATE LITERAL and read as a SQL STRING, and `\s` is
     * not a valid escape in either: it collapses to a bare `s`, turning
     * `\s*\(usado\)\s*$` into `s*(usado)s*$` — a regex that matches nothing
     * any shop has. It threw nothing and rewrote nothing, and the suffix stayed
     * on screen. Bracket expressions say the same thing and cannot be eaten.
     */
    const sql = raw(productName("p.row->>'name'", "en"));
    expect(sql).not.toContain("\\");
    expect(sql).toContain("[(]usado[)]");
  });
});

describe("what a till is called", () => {
  it("translates the name WE prefilled, in both directions", () => {
    expect(tillName("Caja 1", "en")).toBe("Till 1");
    expect(tillName("Till 1", "es")).toBe("Caja 1");
    expect(tillName("Caja 1", "es")).toBe("Caja 1");
    expect(tillName("Till 1", "en")).toBe("Till 1");
  });

  it("matches our prefill however it was typed", () => {
    expect(tillName("caja 1", "en")).toBe("Till 1");
    expect(tillName("  Caja 1  ", "en")).toBe("Till 1");
  });

  it("never touches a name the shop chose", () => {
    for (const theirs of ["Mostrador", "Taller", "Caja 2", "Caja principal", "TPV 1"]) {
      expect(tillName(theirs, "en")).toBe(theirs);
      expect(tillName(theirs, "es")).toBe(theirs);
    }
  });

  it("agrees with the till about which names are ours", () => {
    /* `apps/desktop/src/renderer/src/lib/till-name.ts` holds the same pair;
       if one side grows a spelling the other has to as well */
    expect([...OUR_TILL_NAMES]).toEqual(["Caja 1", "Till 1"]);
  });
});
