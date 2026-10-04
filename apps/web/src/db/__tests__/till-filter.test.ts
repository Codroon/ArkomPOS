/**
 * The per-till filter, and the one place it must never be used — ADR-0022 §10.
 *
 * A source test, like `layout-rules.test.ts`, and for the same reason: what
 * matters here is a SHAPE in the queries that a reader would not think to look
 * for, and the integration tests that could catch it need a Postgres.
 *
 * The trap, stated plainly. `folded()` groups a row's ops and takes the newest
 * value per field. Filtering those ops by terminal is correct for a document —
 * one till writes it start to finish — and silently wrong for a product:
 *
 *     till 1, 09:14   product/p1   { "name": "Funda iPhone 14" }
 *     till 2, 11:02   product/p1   { "priceCents": 1290 }
 *
 * Fold both and you get the row. Fold only till 2's and you get a product with
 * a price and NO NAME — not a subset of the catalogue but a corrupted version
 * of it, which would then be rendered as a blank row or crash a formatter.
 *
 * Which is also the answer to "why is there no till selector on the stock
 * screen": after ADR-0022 the stock is the SHOP's, and "the stock at till 2"
 * is not a question that has an answer.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARED_ENTITIES } from "@arkom/core";

const DB = join(__dirname, "..");
const APP = join(__dirname, "../../../app");

const queryFiles = readdirSync(DB)
  .filter((name) => name.endsWith("-queries.ts"))
  .map((name) => ({ name, text: readFileSync(join(DB, name), "utf8") }));

/** Entities a SINGLE till writes end to end, so filtering their ops is sound. */
const PER_TILL = ["document", "document_line", "document_tender", "shift", "cash_movement"];

describe("the fold's third argument", () => {
  it("exists, so a caller can ask for one till", () => {
    const fold = readFileSync(join(DB, "fold.ts"), "utf8");
    expect(fold).toContain("terminalId?: TillFilter");
    expect(fold).toContain("e.terminal_id = ${terminalId}");
  });

  it("is a no-op when nothing is asked for, so the default is the whole shop", () => {
    const fold = readFileSync(join(DB, "fold.ts"), "utf8");
    /* a falsy till yields empty SQL rather than `terminal_id = null`, which
       would match no rows and show an empty dashboard */
    expect(fold).toMatch(/terminalId \? sql`and e\.terminal_id = \$\{terminalId\}` : sql``/);
  });

  it("says in the file which entities it may be used on", () => {
    const fold = readFileSync(join(DB, "fold.ts"), "utf8");
    expect(fold).toContain("ADR-0022 §10");
    /* the warning has to name the failure, not just forbid the call */
    expect(fold.toLowerCase()).toContain("half its fields missing");
  });
});

describe("no query narrows a SHARED entity to one till", () => {
  /**
   * The assertion that would have caught the bug. Every `folded(...)` call with
   * three arguments is found, and the entity it names must be per-till.
   */
  const calls = queryFiles.flatMap(({ name, text }) =>
    [...text.matchAll(/folded(?:As)?\(\s*accountId\s*,\s*"([a-z_]+)"\s*(,[^)]*)?\)/g)].map((m) => ({
      file: name,
      entity: m[1]!,
      filtered: Boolean(m[2] && /till|terminal/.test(m[2])),
    })),
  );

  it("finds the calls at all, so this test cannot pass by matching nothing", () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it("never passes a till to a shared entity", () => {
    const offenders = calls
      .filter((call) => call.filtered && (SHARED_ENTITIES as readonly string[]).includes(call.entity))
      .map((call) => `${call.file}: folded(${call.entity}, till)`);

    expect(offenders).toEqual([]);
  });

  it("only passes a till to entities one till writes whole", () => {
    const offenders = calls
      .filter((call) => call.filtered && !PER_TILL.includes(call.entity))
      .map((call) => `${call.file}: folded(${call.entity}, till)`);

    expect(offenders).toEqual([]);
  });
});

describe("the screens that offer the filter are the ones it means something on", () => {
  const chrome = readFileSync(join(APP, "panel/chrome.tsx"), "utf8");

  it("shows it beside the period, on the same screens", () => {
    /* the period and the till are the same kind of control — "which slice of
       the shop" — and the catalogue and stock screens get neither */
    expect(chrome).toContain("const showTills = showRange && tills.length > 1;");
  });

  it("hides it from a shop with one till", () => {
    /* a choice between "all tills" and the only till is a control that cannot
       do anything */
    expect(chrome).toContain("tills.length > 1");
  });

  it("keeps the state in the URL, so a link opens on the same figures", () => {
    expect(chrome).toContain('params.get("till")');
    expect(chrome).toContain('query.set("till", next)');
    expect(chrome).toContain('query.delete("till")');
  });
});

describe("the export carries the filter the screen was showing", () => {
  it("passes the till through, so the CSV is the same answer (ADR-0016 §4)", () => {
    const route = readFileSync(join(APP, "panel/ventas/export/route.ts"), "utf8");
    expect(route).toContain('params.get("till")');
  });

  it("and the screen puts it in the export link", () => {
    const page = readFileSync(join(APP, "panel/ventas/page.tsx"), "utf8");
    expect(page).toContain('exportQuery.set("till", till)');
  });
});
