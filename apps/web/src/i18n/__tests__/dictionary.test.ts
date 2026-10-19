/**
 * The Spanish dictionary contains Spanish — checked, not assumed.
 *
 * Every word on a cloud page goes through this dictionary (a scan of the pages
 * found no text written directly into them). So the only way English reaches a
 * Spanish screen is through the Spanish side of the dictionary, and this pins
 * the words that are legitimately the same in both languages. A new identical
 * pair fails here until somebody decides it belongs on the list.
 */
import { describe, expect, it } from "vitest";
import { translatorFor } from "../index";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const keys = [...new Set([...source.matchAll(/^\s*"([A-Za-z0-9_.]+)":/gm)].map((m) => m[1]!))];
const es = translatorFor("es");
const en = translatorFor("en");

/** Same word in Spain's retail Spanish and in English — decided, not missed. */
const SAME_IN_BOTH = new Set([
  "app.brand", // the product name
  "doc.base", // "Base" — the taxable base on every Spanish receipt
  "doc.total",
  "cat.stock", // "stock" is the word Spanish shops use
  "tf.mtcn", // Western Union's control number
  "tf.principal",
  "tender.bizum", // a Spanish payment brand
  "inf.sales.net", // "Base"
  "inf.sales.gross", // "Total"
]);

describe("the cloud dictionary", () => {
  it("has every key in both languages", () => {
    expect(keys.length).toBeGreaterThan(300);
    for (const key of keys) {
      expect(es(key as never), key).not.toBe("");
      expect(en(key as never), key).not.toBe("");
    }
  });

  it("only shares a word between languages where that is the right word in both", () => {
    const same = keys.filter((key) => es(key as never) === en(key as never) && !SAME_IN_BOTH.has(key));
    expect(same).toEqual([]);
  });
});
