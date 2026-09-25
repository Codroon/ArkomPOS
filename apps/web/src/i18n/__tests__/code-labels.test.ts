/**
 * Every code the till can send has a word, in both languages.
 *
 * `labelFor()` falls back to the raw code on purpose — the till can add a
 * movement reason in a version newer than this dashboard, and "adjust_write_off"
 * on screen is ugly but true. Inventing a label for something we do not
 * recognise would be worse.
 *
 * The cost of that kindness is that a MISSING label is silent. It does not
 * throw and it does not warn: it renders. A shop looking at its own
 * transactions saw twenty rows typed "purchase", because the dictionary had
 * invented `docType.used_purchase` — which no till has ever emitted — and had
 * no entry for the value that actually arrives. Its stock history read
 * "repair_part_out" for the same reason, and "tradein_in", the only movement a
 * used device makes, had no word at all.
 *
 * So the lists are not copied here. They are READ from `packages/db/src/schema.ts`
 * and `packages/core`, which CLAUDE.md names as the authority, and this fails
 * the moment one of them grows a value the cloud cannot say out loud.
 *
 * Read as SOURCE rather than imported: `@arkom/db` pulls in better-sqlite3, a
 * native module with no business in a web bundle that has to build on Vercel.
 * The parse is deliberately strict, so a change of shape fails here loudly
 * instead of quietly matching nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, labelFor, translatorFor, type MessageKey } from "../index";

const REPO = join(__dirname, "../../../../..");

/** `export const NAME = ["a", "b", …] as const;` out of a TypeScript file. */
function enumFrom(relPath: string, name: string): string[] {
  const source = readFileSync(join(REPO, relPath), "utf8");
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`, "s").exec(source);
  if (!match) throw new Error(`${name} not found in ${relPath} — has it been renamed?`);
  const codes = [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  if (codes.length === 0) throw new Error(`${name} in ${relPath} parsed to nothing`);
  return codes;
}

const SCHEMA = "packages/db/src/schema.ts";

/** prefix → the codes that can arrive under it, from the authority */
const FAMILIES: Record<string, string[]> = {
  docType: enumFrom(SCHEMA, "DOC_TYPES"),
  mv: enumFrom(SCHEMA, "MOVEMENT_TYPES"),
  tender: enumFrom(SCHEMA, "TENDER_METHODS"),
  regime: enumFrom(SCHEMA, "TAX_REGIMES"),
  uss: enumFrom(SCHEMA, "UNIT_STATUSES"),
  voucher: enumFrom(SCHEMA, "VOUCHER_STATUSES"),
  rps: enumFrom("packages/core/src/repair.ts", "REPAIR_STATUSES"),
  rpk: enumFrom("packages/core/src/repair.ts", "REPAIR_LINE_KINDS"),
  tfs: enumFrom("packages/core/src/transfer.ts", "TRANSFER_STATUSES"),
};

describe("the dictionary covers every code the till can emit", () => {
  it("found real enums to check against", () => {
    /* if the parse silently matched nothing, every test below would pass */
    expect(FAMILIES.docType).toContain("purchase");
    expect(FAMILIES.mv).toContain("tradein_in");
    expect(FAMILIES.tfs).toContain("sent");
    expect(Object.values(FAMILIES).flat().length).toBeGreaterThan(35);
  });

  for (const locale of LOCALES) {
    for (const [prefix, codes] of Object.entries(FAMILIES)) {
      it(`${locale}: ${prefix} — all ${codes.length} codes have a word`, () => {
        const t = translatorFor(locale);
        /* Ask the translator, not `labelFor`: a missing KEY renders as the key,
           which is the signal. Comparing the label to the code instead would
           call `regime.REBU` missing in Spanish, where "REBU" is the word —
           Régimen Especial de Bienes Usados — and not a fallback. */
        const missing = codes.filter((code) => {
          const key = `${prefix}.${code}` as MessageKey;
          return t(key) === key;
        });
        expect(missing).toEqual([]);
      });
    }
  }

  it("has dropped the ghost key no till ever sent", () => {
    const es = translatorFor("es");
    /* `docType.used_purchase` looked right, read well, and was never once
       rendered, because the value that arrives is `purchase` */
    expect(es("docType.used_purchase" as MessageKey)).toBe("docType.used_purchase");
  });
});

describe("a language toggle changes the words", () => {
  it("says the same code differently in each language", () => {
    const es = translatorFor("es");
    const en = translatorFor("en");
    expect(labelFor(es, "docType", "purchase")).toBe("Compra usado");
    expect(labelFor(en, "docType", "purchase")).toBe("Used purchase");
    expect(labelFor(es, "mv", "tradein_in")).not.toBe(labelFor(en, "mv", "tradein_in"));
    expect(labelFor(es, "mv", "repair_part_out")).not.toBe(
      labelFor(en, "mv", "repair_part_out"),
    );
  });
});
