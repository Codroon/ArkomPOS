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
import { groupName, productName, tillName } from "../our-words";
import { OUR_TILL_PREFILL } from "@arkom/core";

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
  /**
   * The fifth crossing of this line, and the first one a TEST had blessed.
   *
   * The case below used to read `expect(tillName("Caja 2", "en")).toBe("Caja 2")`
   * — "Caja 2" was filed under "a name the shop chose". It is not. It is our own
   * word with the number the shop happened to need, and the client saw it in
   * Spanish on an English screen. The old implementation held our prefill as two
   * LITERALS, and a prefill is only ever number one, so every till after the
   * first fell through.
   *
   * The lesson is in the test as much as the code: a case that pins the current
   * behaviour of a thing nobody has checked is not a test, it is a record of an
   * assumption. "Caja 2" should have looked wrong sitting in that list.
   */
  it("translates our word, keeping the number, in both directions", () => {
    expect(tillName("Caja 1", "en")).toBe("Till 1");
    expect(tillName("Till 1", "es")).toBe("Caja 1");
    expect(tillName("Caja 1", "es")).toBe("Caja 1");
    expect(tillName("Till 1", "en")).toBe("Till 1");
  });

  it("works for the SECOND till, and the ninth — the bug the client reported", () => {
    expect(tillName("Caja 2", "en")).toBe("Till 2");
    expect(tillName("Caja 9", "en")).toBe("Till 9");
    expect(tillName("Caja 12", "en")).toBe("Till 12");
    expect(tillName("Till 2", "es")).toBe("Caja 2");
    /* and never renumbers one: the till's own copy used to answer "Till 1" to
       everything it recognised, which is the right language and the wrong till */
    expect(tillName("Caja 4", "en")).not.toBe("Till 1");
  });

  it("matches our word however it was typed", () => {
    expect(tillName("caja 1", "en")).toBe("Till 1");
    expect(tillName("  Caja 1  ", "en")).toBe("Till 1");
    expect(tillName("Caja-2", "en")).toBe("Till 2");
    expect(tillName("Caja  3", "en")).toBe("Till 3");
    /* a single counter a shop calls just "Caja" is still our word */
    expect(tillName("Caja", "en")).toBe("Till");
  });

  it("never touches a name the shop chose", () => {
    for (const theirs of [
      "Mostrador",
      "Taller",
      "Caja principal",
      "TPV 1",
      "Planta 1",
      /* the anchors earn their keep here: both contain one of our words */
      "Caja de seguridad",
      "Untill 2",
      "Cajas",
    ]) {
      expect(tillName(theirs, "en"), theirs).toBe(theirs);
      expect(tillName(theirs, "es"), theirs).toBe(theirs);
    }
  });

  it("is the SAME code the till runs, not a copy that agrees with it", () => {
    /*
     * This replaces a case that asserted the till's list and the cloud's list
     * held the same pair. That was the right worry — the two halves drifting —
     * answered the wrong way: it kept two implementations and checked they
     * matched. Both were wrong, identically, and the check passed.
     *
     * `tillName` now delegates to `@arkom/core`, which the till's renderer also
     * imports, so there is nothing left to keep in step.
     */
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const source = readFileSync(new URL("../our-words.ts", import.meta.url), "utf8");
    expect(source).toContain('from "@arkom/core"');

    const till = readFileSync(
      new URL("../../../../desktop/src/renderer/src/lib/till-name.ts", import.meta.url),
      "utf8",
    );
    expect(till).toContain("displayTillName");
    expect(till).toContain('from "@arkom/core"');
    /* neither half may hold its own list of our words any more */
    expect(till).not.toMatch(/\[\s*"Caja 1"/);
    expect(source).not.toMatch(/\[\s*"Caja 1"/);
  });

  it("agrees with the wizard about what it prefills", () => {
    expect(OUR_TILL_PREFILL.es).toBe("Caja 1");
    expect(OUR_TILL_PREFILL.en).toBe("Till 1");
    /* and the prefill is, by construction, one of our own names */
    expect(tillName(OUR_TILL_PREFILL.es, "en")).toBe(OUR_TILL_PREFILL.en);
  });
});
