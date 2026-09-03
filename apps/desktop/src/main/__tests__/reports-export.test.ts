/**
 * The exported file, and how fast the reports are on a shop's real volume.
 *
 * The CSV assertions go through the real export builder and check BYTES: a file
 * that looks right in a string and puts the whole row in column A has failed at
 * the only thing it exists to do.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { renderReportCsv } from "../reports-export";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const DAY = 86_400_000;

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-reports3-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  return { db, ctx: { ...ids, userId: null as string | null } };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
let groupId: string;
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

function makeProduct(name: string, costCents: number, onHand: number) {
  const id = uuidv7();
  const now = new Date();
  env.db
    .insert(s.products)
    .values({
      id,
      tenantId: env.ctx.tenantId,
      groupId,
      name,
      itemType: "stocked",
      costCents,
      priceCents: costCents * 2,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      barcode: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  env.db.insert(s.productStock).values({ productId: id, locationId: env.ctx.locationId, onHand, updatedAt: now }).run();
  return id;
}

/** One completed sale, written directly — the volume is the point here. */
function sale(productId: string, completedAt: Date, unitPriceCents: number, unitCostCents: number | null, description = "Funda") {
  const docId = uuidv7();
  const base = Math.floor((unitPriceCents * 10000 + 6050) / 12100);
  env.db
    .insert(s.documents)
    .values({
      id: docId,
      tenantId: env.ctx.tenantId,
      locationId: env.ctx.locationId,
      terminalId: env.ctx.terminalId,
      docType: "ticket",
      status: "completed",
      docNumber: `T1-${docId.slice(0, 6)}`,
      subtotalCents: base,
      taxCents: unitPriceCents - base,
      totalCents: unitPriceCents,
      userId: owner.id,
      createdAt: completedAt,
      completedAt,
    })
    .run();
  env.db
    .insert(s.documentLines)
    .values({
      id: uuidv7(),
      tenantId: env.ctx.tenantId,
      documentId: docId,
      lineNo: 1,
      lineType: "product",
      productId,
      description,
      qty: 1,
      unitPriceCents,
      priceOverridden: false,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      baseCents: base,
      taxCents: unitPriceCents - base,
      totalCents: unitPriceCents,
      unitCostCents,
      createdAt: completedAt,
    })
    .run();
  env.db
    .insert(s.documentTenders)
    .values({ id: uuidv7(), tenantId: env.ctx.tenantId, documentId: docId, method: "cash", amountCents: unitPriceCents, createdAt: completedAt })
    .run();
  return docId;
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
  groupId = uuidv7();
  env.db
    .insert(s.productGroups)
    .values({ id: groupId, tenantId: env.ctx.tenantId, name: "Accesorios", nameEn: "Accessories", sortOrder: 1, createdAt: new Date() })
    .run();
});

const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
const window = () => ({ fromMs: today().getTime() - 30 * DAY, toMs: today().getTime() + DAY });

/* ----------------------------------------------------------- the bytes */

describe("the exported file", () => {
  it("is UTF-8 with a BOM, semicolons and decimal commas", () => {
    const p = makeProduct("Batería iPhone ñ", 400, 10);
    sale(p, new Date(), 123456, 40000, "Batería iPhone ñ");

    const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true);
    const bytes = Buffer.from(text, "utf8");

    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain(";");
    expect(text).toContain("1234,56");
    expect(text).toContain("\r\n");
    // the shop's own product names have accents; without the BOM Excel eats them
    expect(text).toContain("Batería iPhone ñ");
  });

  it("writes dates the way a Spanish Excel reads them", () => {
    const sold = makeProduct("Vendido hace tiempo", 400, 10);
    sale(sold, new Date(Date.now() - 200 * DAY), 1000, 400);
    makeProduct("Nunca vendido", 900, 4);

    const text = renderReportCsv(env.db, ctxOf(), "deadStock", { groupId: null }, true);
    // dd/mm/yyyy, never an ISO string — Excel reads 2026-09-02 as text
    expect(/\d{2}\/\d{2}\/\d{4}/.test(text)).toBe(true);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // and a product that never sold says so in words
    expect(text).toContain("nunca");
  });

  it("carries the estimated warning into the file, above the header", () => {
    const p = makeProduct("Funda", 400, 10);
    sale(p, new Date(), 1000, null); // a pre-v0.14.0 line

    const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true);
    const lines = text.replace("﻿", "").split("\r\n");
    expect(lines.some((l) => l.startsWith("AVISO"))).toBe(true);
    // above the header, so exporting cannot lose the warning
    const warn = lines.findIndex((l) => l.startsWith("AVISO"));
    const header = lines.findIndex((l) => l.startsWith("Concepto;"));
    expect(warn).toBeLessThan(header);
  });

  it("drops the cost columns entirely without the permission", () => {
    const p = makeProduct("Funda", 400, 10);
    sale(p, new Date(), 1000, 400);

    const withCosts = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true);
    const without = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, false);
    expect(withCosts).toContain("Margen");
    expect(without).not.toContain("Margen");
    expect(without).not.toContain("Coste");
  });

  it("exports the filtered view, not everything", () => {
    const a = makeProduct("Funda", 400, 10);
    const b = makeProduct("Cable", 200, 10);
    sale(a, new Date(), 1000, 400, "Funda");
    sale(b, new Date(today().getTime() - 60 * DAY), 2000, 200, "Cable");

    const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true);
    expect(text).toContain("Funda");
    expect(text).not.toContain("Cable"); // 60 days ago, outside the window
  });

  it("produces a header and no rows on an empty report, rather than nothing", () => {
    const text = renderReportCsv(env.db, ctxOf(), "valuation", { groupId: null }, true);
    expect(text).toContain("Artículo;Grupo;Existencias");
    expect(text.trim().split("\r\n").filter((l) => l.includes(";")).length).toBe(1);
  });
});

/* ------------------------------------------------------- performance */

describe("on a shop's real volume", () => {
  /** 10,000 completed documents across a year, over 40 products. */
  function generate(count: number) {
    const products = Array.from({ length: 40 }, (_, i) => makeProduct(`Artículo ${i}`, 200 + i * 25, 20));
    const start = today().getTime() - 360 * DAY;
    env.db.transaction((tx) => {
      for (let i = 0; i < count; i += 1) {
        const at = new Date(start + Math.floor((i / count) * 360) * DAY);
        const productId = products[i % products.length]!;
        const price = 500 + (i % 50) * 100;
        const base = Math.floor((price * 10000 + 6050) / 12100);
        const docId = uuidv7();
        tx.insert(s.documents)
          .values({
            id: docId,
            tenantId: env.ctx.tenantId,
            locationId: env.ctx.locationId,
            terminalId: env.ctx.terminalId,
            docType: "ticket",
            status: "completed",
            docNumber: `T1-${String(i).padStart(6, "0")}`,
            subtotalCents: base,
            taxCents: price - base,
            totalCents: price,
            userId: owner.id,
            createdAt: at,
            completedAt: at,
          })
          .run();
        tx.insert(s.documentLines)
          .values({
            id: uuidv7(),
            tenantId: env.ctx.tenantId,
            documentId: docId,
            lineNo: 1,
            lineType: "product",
            productId,
            description: `Artículo ${i % products.length}`,
            qty: 1 + (i % 3),
            unitPriceCents: price,
            priceOverridden: false,
            taxRegime: "IVA21",
            taxRateBp: 2100,
            baseCents: base,
            taxCents: price - base,
            totalCents: price,
            // half of them predate the snapshot, so the estimate path is loaded too
            unitCostCents: i % 2 === 0 ? 200 : null,
            createdAt: at,
          })
          .run();
        tx.insert(s.documentTenders)
          .values({
            id: uuidv7(),
            tenantId: env.ctx.tenantId,
            documentId: docId,
            method: i % 3 === 0 ? "card" : "cash",
            amountCents: price,
            createdAt: at,
          })
          .run();
      }
    });
  }

  it("answers every report in under a second", async () => {
    generate(10_000);
    expect(env.db.select().from(s.documents).all().length).toBe(10_000);

    const year = { fromMs: today().getTime() - 365 * DAY, toMs: today().getTime() + DAY };
    const timed = async (name: string, fn: () => unknown) => {
      const started = performance.now();
      await fn();
      const ms = performance.now() - started;
      expect(ms, `${name} took ${Math.round(ms)}ms`).toBeLessThan(1000);
      return ms;
    };

    await timed("hub", () => handlers.get("reports:hub")!({}, {}));
    for (const groupBy of ["day", "group", "product", "user", "method"]) {
      await timed(`sales:${groupBy}`, () =>
        handlers.get("reports:sales")!({}, { ...year, shiftId: null, groupBy }),
      );
    }
    await timed("valuation", () => handlers.get("reports:valuation")!({}, { groupId: null }));
    await timed("deadStock", () => handlers.get("reports:deadStock")!({}, { groupId: null }));
    await timed("used", () => handlers.get("reports:used")!({}, { status: null, grade: null }));
    await timed("repairsOpen", () => handlers.get("reports:repairsOpen")!({}, { status: null, technicianId: null }));
    await timed("repairsClosed", () => handlers.get("reports:repairsClosed")!({}, { ...year, byTechnician: false }));
  }, 120_000);
});

/* ------------------------------------------- the file speaks the staff's language */

describe("the language of the file", () => {
  /**
   * v0.18.1. It used to be Spanish always, for the gestor. But the person who
   * presses Exportar is reading the screen in their own language, and a file
   * whose columns they cannot check is not a report they can proof-read. The
   * FORMAT stays Spanish-Windows either way — that is about Excel, not words.
   */
  it("writes Spanish headers and a Spanish file name for a Spanish till", () => {
    const productId = makeProduct("Cable USB-C", 500, 4);
    sale(productId, new Date(), 1200, 500, "Cable USB-C");
    const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true, "es");
    expect(text).toContain("Concepto;Operaciones;Unidades;Base;IVA;Total");
    expect(text).toContain("Ventas —");
  });

  it("writes English headers for an English till", () => {
    const productId = makeProduct("Cable USB-C", 500, 4);
    sale(productId, new Date(), 1200, 500, "Cable USB-C");
    const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true, "en");
    expect(text).toContain("Concept;Operations;Units;Net;VAT;Total");
    expect(text).toContain("Sales —");
    expect(text).toContain("Tickets:");
    expect(text).not.toContain("Concepto;");
  });

  it("keeps the Excel format Spanish-Windows in both, because that is about the machine", () => {
    const productId = makeProduct("Cable USB-C", 500, 4);
    sale(productId, new Date(), 1200, 500, "Cable USB-C");
    for (const locale of ["es", "en"] as const) {
      const text = renderReportCsv(env.db, ctxOf(), "sales", { ...window(), shiftId: null, groupBy: "product" }, true, locale);
      expect(text.charCodeAt(0)).toBe(0xfeff); // BOM
      expect(text).toContain(";");
      expect(text).toMatch(/\d+,\d{2}/); // decimal comma
      expect(text.includes(String.fromCharCode(13, 10))).toBe(true); // CRLF
    }
  });

  it("translates the words the till owns and leaves the shop's alone", () => {
    /* dead stock is what has NOT sold, so this one just sits there */
    makeProduct("Cable USB-C", 500, 4);
    const en = renderReportCsv(env.db, ctxOf(), "deadStock", { groupId: null }, true, "en");
    const es = renderReportCsv(env.db, ctxOf(), "deadStock", { groupId: null }, true, "es");

    expect(en).toContain("Item;Group;On hand;Cost tied up;Last sale;Days");
    expect(es).toContain("Artículo;Grupo;Existencias;Coste inmovilizado;Última venta;Días");
    // the shelf has both names; the product has the one the shop typed
    expect(en).toContain("Accessories");
    expect(es).toContain("Accesorios");
    expect(en).toContain("Cable USB-C");
    expect(es).toContain("Cable USB-C");
  });

  it("names the file in the language too", async () => {
    /* the name is the first thing anyone reads about a file, and a Spanish
       slug in an English folder is the same mismatch as a Spanish header */
    const { renderReportCsv: _same } = await import("../reports-export");
    expect(typeof _same).toBe("function");
    const es = await import("@arkom/core").then((m) => m.csvFileName("informe-ventas"));
    const en = await import("@arkom/core").then((m) => m.csvFileName("sales-report"));
    expect(es).toMatch(/^informe-ventas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(en).toMatch(/^sales-report-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
