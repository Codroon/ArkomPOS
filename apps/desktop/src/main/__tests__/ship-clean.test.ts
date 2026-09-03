/**
 * The handover pass — v0.18.0.
 *
 * Five things a shop notices in its first week and a developer never does on
 * a machine with a printer and a demo dataset: that completing a document
 * writes nothing to disk; that Eliminar is honest about what it does to a row;
 * that a used article typed in by hand sells under the margin scheme; that the
 * general VAT rate is a setting that reaches new lines and no old one; and that
 * an installed till starts with its shelves and nothing on them.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { openDb, runMigrations, schema as s, schema as s2 } from "@arkom/db";
import { imeiWithCheckDigit, parseIpcError, STARTER_GROUPS, uuidv7, type RepairCreateRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext, tillContext } from "../context";
import { createUser } from "../auth/users";
import { completeFirstRun, type FirstRunInput } from "../setup";
import { openShiftTx } from "../repos/shift";
import { getSettings, saveSettings, STARTER_CASH_CONCEPTS } from "../repos/settings";
import { addLine, collect, createTicket, markReady, recordApproval, upsertCustomer } from "../repos/repair";
import { seed } from "../../../scripts/db-seed";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-ship-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  return db;
}

const FIRST_RUN: FirstRunInput = {
  shopLegalName: "Arkom Electrónica S.L.",
  shopNif: "B00000000",
  shopAddress: "Calle Ejemplo 1",
  ticketFooter: "Precios claros.",
  terminalName: "Caja 1",
  seriesPrefix: "T1-",
  loadDemo: false,
  locale: "es",
};

let db: ReturnType<typeof freshDb>;
let owner: { id: string };
let ctx: { tenantId: string; locationId: string; terminalId: string; userId: string | null };
let groupId: string;

const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;
const code = async (channel: string, payload?: unknown): Promise<string> => {
  try {
    await handlers.get(channel)!({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  db = freshDb();
  completeFirstRun(db, FIRST_RUN);
  ctx = { ...tillContext(db).ctx, userId: null };
  owner = createUser(db, ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  ctx = { ...ctx, userId: owner.id };
  registerIpcHandlers(db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
  openShiftTx(db, ctx, { floatCents: 20000, breakdown: null });
  /* A configured printer is the ordinary state of a shop's till, and since
     v0.18.1 it is what the three customer-facing acts require. */
  saveSettings(db, ctx, { printerName: "Impresora de pruebas" });
  groupId = db.select().from(s.productGroups).all()[0]!.id;
});

/* ------------------------------------------------------------ fixtures */

type SaveResult = { kind: "saved"; product: { id: string; taxRateBp: number | null; taxRegime: string | null; active: boolean } };

async function saveProduct(over: Record<string, unknown> = {}) {
  const res = await call<SaveResult>("catalog:save", {
    name: `Artículo ${uuidv7().slice(-6)}`,
    barcode: null,
    groupId,
    itemType: "stocked",
    costCents: 500,
    priceCents: 1000,
    taxRegime: "IVA21",
    reorderPoint: 0,
    lowStockThreshold: 0,
    active: true,
    ...over,
  });
  expect(res.kind).toBe("saved");
  return res.product;
}

/** Shelf stock without a receiving flow: the cache row plus the movement it summarises. */
function putOnShelf(productId: string, qty: number) {
  const now = new Date();
  db.insert(s.productStock).values({ productId, locationId: ctx.locationId, onHand: qty, updatedAt: now }).run();
  db.insert(s.stockMovements)
    .values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      locationId: ctx.locationId,
      productId,
      terminalId: ctx.terminalId,
      movementType: "purchase_in",
      qty,
      unitCostCents: 500,
      reason: null,
      userId: owner.id,
      createdAt: now,
    })
    .run();
}

async function sell(req: { productId?: string; unitId?: string }, qty = 1) {
  const added = await call<{ kind: string; state: { docId: string; totalCents: number } }>("sale:addLine", { ...req, qty });
  expect(added.kind).toBe("state");
  const done = await call<{ docId: string; docNumber: string }>("sale:complete", {
    docId: added.state.docId,
    tenders: [{ method: "cash", amountCents: added.state.totalCents }],
  });
  const lines = db.select().from(s.documentLines).where(eq(s.documentLines.documentId, done.docId)).all();
  return { ...done, lines };
}

const intake = (customerId: string): RepairCreateRequest => ({
  customerId,
  deviceDescription: "Apple iPhone 11 64GB",
  imei: null,
  reportedFault: "Pantalla rota",
  conditionAtIntake: null,
  damage: { screen: true, back: false, dents: false, water: false },
  damageNote: null,
  accessories: null,
  devicePasscode: null,
  photos: [],
  promisedDate: null,
  promisedHalf: null,
  depositCents: 0,
  depositMethod: "cash",
  authorizedCapCents: null,
  assignedUserId: null,
});

async function collectedRepair() {
  const customerId = upsertCustomer(db, ctx, { name: "Joan Puig", phone: "+34 671 220 918" }).id;
  const ticket = await createTicket(db, ctx, intake(customerId));
  addLine(db, ctx, { kind: "labor", ticketId: ticket.ticketId, description: "Cambio de pantalla", chargeCents: 7900 });
  recordApproval(db, ctx, ticket.ticketId, "in_person");
  markReady(db, ctx, ticket.ticketId);
  collect(db, ctx, { ticketId: ticket.ticketId, tenders: [{ method: "cash", amountCents: 7900 }] });
  return ticket.ticketId;
}

const usedPayload = () => ({
  device: {
    brand: "Apple",
    model: "iPhone SE 2020",
    storage: "64GB",
    color: "Blanco",
    grade: "B",
    batteryPct: 86,
    imei: imeiWithCheckDigit(String(35209411880000 + Math.floor(Math.random() * 999)).padStart(14, "0")),
    accessories: { charger: true, box: false, cable: true, case: false },
  },
  seller: { name: "Imran Khan", phone: null, idType: "DNI", idNumber: "Y2841170F", channel: "private_individual" },
  photos: [],
  buyPriceCents: 8000,
  payout: "cash",
  payoutReference: null,
  barcode: null,
  gateConfirmed: true,
  action: "hold",
});

/** Every file under the app's data root, as relative paths — the whole disk footprint a test can see. */
function footprint(): string[] {
  const root = app.getPath("userData");
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).replace(/\\/g, "/"));
    }
  };
  walk(root);
  return out.sort();
}
const added = (before: string[], after: string[]) => after.filter((f) => !before.includes(f));

/* ------------------------------------- 1 · completing writes nothing */

describe.each([
  ["a thermal printer", "Citizen CT-S310S"],
  ["a Windows printer queue", "Microsoft Print to PDF"],
])("completing a document on a till with %s", (_label, printerName) => {
  beforeEach(() => {
    saveSettings(db, ctx, { printerName });
  });

  it("files nothing for a sale, a refund, a repair collection, a used purchase or a Z", async () => {
    const before = footprint();

    const product = await saveProduct();
    putOnShelf(product.id, 5);
    const sale = await sell({ productId: product.id }, 2);
    expect(footprint()).toEqual(before);

    await call("refund:create", {
      documentId: sale.docId,
      reason: "Cambio de opinión",
      method: "card",
      lines: [{ lineId: sale.lines[0]!.id, qty: 1, restock: true }],
    });
    expect(footprint()).toEqual(before);

    await collectedRepair();
    expect(footprint()).toEqual(before);

    await call("used:log", usedPayload());
    expect(footprint()).toEqual(before);

    await call("cash:close", { countedCents: 20000, breakdown: null, reason: "Prueba de cierre" });
    expect(footprint()).toEqual(before);
  });
});

describe("the fallback render", () => {
  it("lands in the swept TEMP directory as a PDF and leaves no HTML behind", async () => {
    const product = await saveProduct();
    putOnShelf(product.id, 5);
    const sale = await sell({ productId: product.id });
    const ticketId = await collectedRepair();
    const used = await call<{ purchaseId: string }>("used:log", usedPayload());
    const z = await call<{ shiftId: string }>("cash:close", { countedCents: 20000, breakdown: null, reason: "Prueba de cierre" });

    /* the printer is then taken away — a shop that unplugged it, or one still
       being set up. Documents already issued must still be printable. */
    saveSettings(db, ctx, { printerName: "" });
    const before = footprint();
    await call("print:ticket", { docId: sale.docId, copy: false, target: "auto" });
    await call("repair:print", { ticketId, what: "receipt", target: "auto", copy: false });
    await call("used:print", { purchaseId: used.purchaseId, what: "document", target: "auto", copy: false });
    await call("cash:print", { shiftId: z.shiftId, what: "z", locale: "es", target: "auto", copy: false });

    const rendered = added(before, footprint());
    expect(rendered.length).toBe(4);
    for (const file of rendered) {
      expect(file.startsWith("arkom-pdf/")).toBe(true);
      expect(file.endsWith(".pdf")).toBe(true);
    }
    // the HTML the PDF was printed from is gone the moment the PDF exists
    expect(rendered.some((f) => f.endsWith(".html"))).toBe(false);
  });

  it("writes nothing at all when the TILL starts the print and there is no printer", async () => {
    /* the shop's complaint, and the rule behind it: a fallback PDF is for a
       person who asked for paper. The till printing on its own behalf after
       every sale filed one file per document that nobody opened, and put a
       "PDF saved" toast in front of the next customer. */
    const product = await saveProduct();
    putOnShelf(product.id, 5);
    const sale = await sell({ productId: product.id });
    const ticketId = await collectedRepair();
    const used = await call<{ purchaseId: string }>("used:log", usedPayload());
    saveSettings(db, ctx, { printerName: "" });

    const before = footprint();
    const printsBefore = db.select().from(s2.oplog).all().filter((e) => e.action === "print").length;

    expect(await call("print:ticket", { docId: sale.docId, copy: false, target: "auto", auto: true })).toEqual({
      kind: "noPrinter",
    });
    expect(await call("repair:print", { ticketId, what: "receipt", target: "auto", copy: false, auto: true })).toEqual({
      kind: "noPrinter",
    });
    expect(await call("used:print", { purchaseId: used.purchaseId, what: "document", target: "auto", copy: false, auto: true })).toEqual({
      kind: "noPrinter",
    });

    // nothing rendered, nothing filed, and no print attempt to explain away
    expect(footprint()).toEqual(before);
    expect(db.select().from(s2.oplog).all().filter((e) => e.action === "print").length).toBe(printsBefore);

    // and the same document, asked for by a person, still falls back to a PDF
    const res = await call<{ kind: string; path: string }>("print:ticket", { docId: sale.docId, copy: false, target: "auto" });
    expect(res.kind).toBe("pdf");
    /* the same file name every time, on purpose: a document is immutable, so
       re-rendering T1-000001 must not leave T1-000001 (3).pdf behind */
    expect(res.path.split("\\").join("/")).toContain("arkom-pdf/");
    expect(existsSync(res.path)).toBe(true);
  });
});

/* ------------------------------- 1b · no printer, no money at the counter */

describe("a till with no printer configured", () => {
  let productId: string;
  let saleDocId: string;
  let saleLineId: string;
  let repairTicketId: string;

  beforeEach(async () => {
    // set up while the printer is still configured, then take it away
    const product = await saveProduct();
    productId = product.id;
    putOnShelf(productId, 10);
    const sale = await sell({ productId }, 1);
    saleDocId = sale.docId;
    saleLineId = sale.lines[0]!.id;

    const customerId = upsertCustomer(db, ctx, { name: "Joan Puig", phone: "+34 671 220 918" }).id;
    const ticket = await createTicket(db, ctx, intake(customerId));
    addLine(db, ctx, { kind: "labor", ticketId: ticket.ticketId, description: "Cambio de pantalla", chargeCents: 7900 });
    recordApproval(db, ctx, ticket.ticketId, "in_person");
    markReady(db, ctx, ticket.ticketId);
    repairTicketId = ticket.ticketId;

    saveSettings(db, ctx, { printerName: "" });
  });

  it("refuses to charge a sale, and creates no document", async () => {
    /* the rule the shop asked for: a till that takes money it cannot hand a
       ticket for leaves an argument for later. Configuration, not hardware —
       a configured printer that jams still lets the sale through (v0.18.1). */
    const docsBefore = db.select().from(s.documents).all().length;
    const added = await call<{ kind: string; state: { docId: string; totalCents: number } }>("sale:addLine", {
      productId,
      qty: 1,
    });
    expect(
      await code("sale:complete", {
        docId: added.state.docId,
        tenders: [{ method: "cash", amountCents: added.state.totalCents }],
      }),
    ).toBe("PRINTER_REQUIRED");

    // the draft is still a draft: nothing completed, nothing numbered, no tender
    const draft = db.select().from(s.documents).where(eq(s.documents.id, added.state.docId)).all()[0]!;
    expect(draft.status).toBe("draft");
    expect(draft.docNumber).toBeNull();
    expect(db.select().from(s.documentTenders).where(eq(s.documentTenders.documentId, draft.id)).all()).toEqual([]);
    expect(db.select().from(s.documents).all().filter((d) => d.status === "completed").length).toBe(
      db.select().from(s.documents).all().filter((d) => d.status === "completed").length,
    );
    expect(db.select().from(s.documents).all().length).toBe(docsBefore + 1); // the draft, and only the draft
  });

  it("refuses a refund and a repair collection, and moves no money", async () => {
    const drawerBefore = db.select().from(s.cashMovements).all().length;

    expect(
      await code("refund:create", {
        documentId: saleDocId,
        reason: "Cambio de opinión",
        method: "cash",
        lines: [{ lineId: saleLineId, qty: 1, restock: true }],
      }),
    ).toBe("PRINTER_REQUIRED");
    expect(await code("repair:collect", { ticketId: repairTicketId, tenders: [{ method: "cash", amountCents: 7900 }] })).toBe(
      "PRINTER_REQUIRED",
    );

    expect(db.select().from(s.cashMovements).all().length).toBe(drawerBefore);
    expect(db.select().from(s.documents).all().some((d) => d.docType === "refund")).toBe(false);
    const ticket = db.select().from(s.repairTickets).where(eq(s.repairTickets.id, repairTicketId)).all()[0]!;
    expect(ticket.collectionDocumentId).toBeNull();
  });

  it("refuses a repair intake and a used-device purchase, and writes nothing at all", async () => {
    /* both hand a person a document they sign: the customer's proof that they
       left a phone here, and the seller's receipt carrying their ID. Refused
       BEFORE anything is written — no ticket, no purchase row, no cash out of
       the drawer, and, for the purchase, no photographs on disk. */
    const disk = footprint();
    const customerId = upsertCustomer(db, ctx, { name: "Marta Ruiz", phone: "+34 600 000 000" }).id;

    expect(await code("repair:create", { ...intake(customerId), depositCents: 0 })).toBe("PRINTER_REQUIRED");
    expect(await code("used:log", usedPayload())).toBe("PRINTER_REQUIRED");

    expect(db.select().from(s.repairTickets).all().filter((r) => r.customerId === customerId)).toEqual([]);
    expect(db.select().from(s.usedPurchases).all()).toEqual([]);
    expect(db.select().from(s.cashMovements).all()).toEqual([]);
    expect(footprint()).toEqual(disk); // the photographs never reached the disk
  });

  it("still lets the shop keep its own books: the drawer, and closing the day", async () => {
    /* deliberately not blocked. A Z is the shop's own paperwork and reprints
       from its frozen snapshot any time — refusing to close would leave the
       shift open into tomorrow over a cable, which is worse than no paper. A
       paid-in/out is a note in the drawer, and nobody is handed anything. */
    expect(await code("cash:paidIn", { amountCents: 5000, concept: "Cambio", reason: null })).toBe("OK");
    expect(await code("cash:close", { countedCents: 25000, breakdown: null, reason: "Prueba de cierre" })).toBe("OK");
  });

  it("tells the screens before anybody fills in a form", async () => {
    /* the refusal is the rule; this is what keeps a cashier from photographing
       a phone from four angles only to meet it at the end */
    expect(await call<{ printerConfigured: boolean }>("meta:context")).toMatchObject({ printerConfigured: false });
    saveSettings(db, ctx, { printerName: "Impresora de pruebas" });
    expect(await call<{ printerConfigured: boolean }>("meta:context")).toMatchObject({ printerConfigured: true });
  });

  it("says what to do about it, once, in a typed code the UI can act on", async () => {
    try {
      await handlers.get("refund:create")!({}, {
        documentId: saleDocId,
        reason: "x",
        method: "cash",
        lines: [{ lineId: saleLineId, qty: 1, restock: true }],
      });
      throw new Error("expected a refusal");
    } catch (err) {
      const ipc = parseIpcError(err)!;
      expect(ipc.code).toBe("PRINTER_REQUIRED");
      expect(ipc.message).toContain("Ajustes");
    }
  });
});

/* ------------------------------------------------- 2 · Eliminar is honest */

describe("Eliminar on a catalogue row", () => {
  it("deletes a row nothing points at, and leaves an oplog entry saying so", async () => {
    const product = await saveProduct({ name: "Typo" });
    expect(await call("catalog:removal", { id: product.id })).toEqual({ kind: "delete", hasHistory: false, onHand: 0 });

    const res = await call<{ kind: string; product: unknown }>("catalog:remove", { id: product.id });
    expect(res).toEqual({ kind: "deleted", product: null });
    expect(db.select().from(s.products).where(eq(s.products.id, product.id)).all()).toEqual([]);
    expect(await code("catalog:get", { id: product.id })).toBe("VALIDATION");

    const entry = db.select().from(s.oplog).all().find((e) => e.entity === "product" && e.action === "delete");
    expect(entry?.entityId).toBe(product.id);
  });

  it("refuses to archive while stock is on the shelf", async () => {
    const product = await saveProduct();
    putOnShelf(product.id, 5);
    await sell({ productId: product.id }); // history, and 4 still on the shelf

    expect(await call("catalog:removal", { id: product.id })).toEqual({ kind: "blocked", hasHistory: true, onHand: 4 });
    expect(await code("catalog:remove", { id: product.id })).toBe("VALIDATION");
    // nothing moved: still active, still listed
    const rows = await call<{ id: string; active: boolean }[]>("catalog:list", {});
    expect(rows.find((r) => r.id === product.id)?.active).toBe(true);
  });

  it("archives a row with history once the shelf is empty, hides it from Venta, and restores it", async () => {
    const product = await saveProduct();
    putOnShelf(product.id, 1);
    await sell({ productId: product.id }); // sold out: history, zero on hand

    expect(await call("catalog:removal", { id: product.id })).toEqual({ kind: "archive", hasHistory: true, onHand: 0 });
    const res = await call<{ kind: string; product: { active: boolean } | null }>("catalog:remove", { id: product.id });
    expect(res.kind).toBe("archived");
    expect(res.product?.active).toBe(false);
    // the row is still there — the sale line has something to point at
    expect(db.select().from(s.products).where(eq(s.products.id, product.id)).all()).toHaveLength(1);

    // absent from what Venta loads, and from the plain catalogue list
    const forSale = await call<{ id: string }[]>("catalog:list", { includeUsed: true });
    expect(forSale.some((r) => r.id === product.id)).toBe(false);
    expect((await call<{ id: string }[]>("catalog:list", {})).some((r) => r.id === product.id)).toBe(false);
    // and refused if somebody scans it anyway
    expect(await code("sale:addLine", { productId: product.id, qty: 1 })).toBe("VALIDATION");
    // present only where the archive is asked for
    const archive = await call<{ id: string; active: boolean }[]>("catalog:list", { includeArchived: true });
    expect(archive.find((r) => r.id === product.id)?.active).toBe(false);

    const back = await call<{ active: boolean }>("catalog:restore", { id: product.id });
    expect(back.active).toBe(true);
    expect((await call<{ id: string }[]>("catalog:list", {})).some((r) => r.id === product.id)).toBe(true);

    const actions = db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "product" && e.entityId === product.id)
      .map((e) => e.action);
    expect(actions).toContain("archive");
    expect(actions).toContain("restore");
  });

  it("needs catalog.edit, like any other change to the row — a cashier gets the owner's keypad", async () => {
    const product = await saveProduct();
    const cashier = createUser(db, ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await code("catalog:remove", { id: product.id })).toBe("APPROVAL_REQUIRED");
    expect(await code("catalog:restore", { id: product.id })).toBe("APPROVAL_REQUIRED");
    expect(db.select().from(s.products).where(eq(s.products.id, product.id)).all()[0]!.active).toBe(true);
  });
});

/* -------------------------------------- 3 · a used article typed in by hand */

describe("a Used-type product created in the editor", () => {
  it("sells under the margin scheme: REBU on the line, no VAT in the breakdown", async () => {
    const product = await saveProduct({ name: "iPhone 11 64GB (usado)", itemType: "used_device", taxRegime: "REBU", priceCents: 0 });
    expect(product.taxRegime).toBe("REBU");
    expect(product.taxRateBp).toBe(0);

    const now = new Date();
    const unitId = uuidv7();
    db.insert(s.units)
      .values({
        id: unitId,
        tenantId: ctx.tenantId,
        locationId: ctx.locationId,
        productId: product.id,
        imei: imeiWithCheckDigit("49015420323751"),
        status: "in_stock",
        costCents: 8000,
        salePriceCents: 12000,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    // the on-hand cache counts units too (ADR-0004)
    db.insert(s.productStock).values({ productId: product.id, locationId: ctx.locationId, onHand: 1, updatedAt: now }).run();

    const sale = await sell({ unitId });
    expect(sale.lines).toHaveLength(1);
    const line = sale.lines[0]!;
    expect(line.taxRegime).toBe("REBU");
    expect(line.taxRateBp).toBe(0);
    expect(line.taxCents).toBe(0);
    expect(line.baseCents).toBe(12000);
    expect(line.totalCents).toBe(12000);

    const doc = db.select().from(s.documents).where(eq(s.documents.id, sale.docId)).all()[0]!;
    expect(doc.taxCents).toBe(0);
    expect(doc.totalCents).toBe(12000);
  });

  it("refuses the general rate on a used article — the regime follows the type", async () => {
    expect(
      await code("catalog:save", {
        name: "Usado mal tipado",
        barcode: null,
        groupId,
        itemType: "used_device",
        costCents: 0,
        priceCents: 0,
        taxRegime: "IVA21",
        reorderPoint: 0,
        lowStockThreshold: 0,
        active: true,
      }),
    ).toBe("VALIDATION");
  });
});

/* --------------------------------------------- 4 · the general rate is data */

describe("the general VAT rate", () => {
  it("reaches new snapshots only; every line already written keeps its rate", async () => {
    const product = await saveProduct();
    putOnShelf(product.id, 10);
    const first = await sell({ productId: product.id });
    expect(first.lines[0]!.taxRateBp).toBe(2100);
    expect(first.lines[0]!.taxCents).toBe(174); // 10,00 € inclusive at 21 %

    await call("settings:save", { vatRateBp: 1000 });
    expect(getSettings(db, ctx).vatRateBp).toBe(1000);

    const second = await sell({ productId: product.id });
    expect(second.lines[0]!.taxRateBp).toBe(1000);
    expect(second.lines[0]!.taxCents).toBe(91); // the same 10,00 € inclusive at 10 %

    // the historical line did not move
    const kept = db.select().from(s.documentLines).where(eq(s.documentLines.id, first.lines[0]!.id)).all()[0]!;
    expect(kept.taxRateBp).toBe(2100);
    expect(kept.taxCents).toBe(174);

    // the meta the renderer labels with, and the row a re-save writes
    expect((await call<{ vatRateBp: number }>("meta:context")).vatRateBp).toBe(1000);
    const resaved = await call<SaveResult>("catalog:save", {
      id: product.id,
      name: "Renombrado",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 500,
      priceCents: 1000,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    expect(resaved.product.taxRateBp).toBe(1000);
  });

  it("shows on the series card, which still has no way to change a series", async () => {
    const seriesBefore = db.select().from(s.numberSeries).all();
    await call("settings:save", { vatRateBp: 1000 });
    const overview = await call<{ taxRegimes: { code: string; rateBp: number }[] }>("settings:series", {});
    expect(overview.taxRegimes.find((r) => r.code === "IVA21")?.rateBp).toBe(1000);
    // the card is display-only: the save touched no series row, and no channel exists that could
    expect(db.select().from(s.numberSeries).all()).toEqual(seriesBefore);
    expect([...handlers.keys()].filter((c) => /series/i.test(c))).toEqual(["settings:series"]);
  });

  it("is applied to a repair's collection ticket as of the day it is collected", async () => {
    await call("settings:save", { vatRateBp: 1000 });
    const ticketId = await collectedRepair();
    const detail = db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    const lines = db.select().from(s.documentLines).where(eq(s.documentLines.documentId, detail.collectionDocumentId!)).all();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.taxRateBp === 1000)).toBe(true);
  });
});

/* ------------------------------------------ 5 · an installed till starts empty */

describe("a fresh install", () => {
  it("has the starter groups and nothing else, in the setup language", () => {
    const fresh = freshDb();
    completeFirstRun(fresh, { ...FIRST_RUN, locale: "en" });
    resetTillContext(); // the till cache still points at beforeEach's database
    const groups = fresh.select().from(s.productGroups).all();
    expect(groups).toHaveLength(STARTER_GROUPS.length);
    expect(groups.every((g) => !g.isDemo)).toBe(true);
    expect(fresh.select().from(s.products).all()).toEqual([]);
    expect(fresh.select().from(s.units).all()).toEqual([]);
    expect(fresh.select().from(s.suppliers).all()).toEqual([]);
    const freshCtx = { ...tillContext(fresh).ctx, userId: null };
    expect(getSettings(fresh, freshCtx).cashConcepts).toEqual(STARTER_CASH_CONCEPTS.en);
    // and the letterhead is exactly what was typed — no placeholder anywhere
    const settings = getSettings(fresh, freshCtx);
    expect([settings.shopLegalName, settings.shopNif, settings.shopAddress]).toEqual([
      FIRST_RUN.shopLegalName,
      FIRST_RUN.shopNif,
      FIRST_RUN.shopAddress,
    ]);
  });

  it("refuses the demo dataset when the till is an installed build", async () => {
    const fresh = freshDb();
    handlers.clear();
    resetTillContext();
    registerIpcHandlers(fresh);
    const stubApp = app as unknown as { isPackaged: boolean };
    stubApp.isPackaged = true;
    try {
      const status = await call<{ needed: boolean; packaged: boolean }>("setup:status");
      expect(status).toMatchObject({ needed: true, packaged: true });
      expect(await code("setup:complete", { ...FIRST_RUN, loadDemo: true })).toBe("VALIDATION");
      expect(fresh.select().from(s.tenants).all()).toEqual([]);
      expect(await code("setup:complete", { ...FIRST_RUN, loadDemo: false })).toBe("OK");
      expect(fresh.select().from(s.products).all()).toEqual([]);
    } finally {
      stubApp.isPackaged = false;
    }
  });

  it("refuses `db:seed` on an installed build and writes nothing", () => {
    const fresh = freshDb();
    expect(() => seed(fresh, { packaged: true })).toThrow(/development step/);
    expect(fresh.select().from(s.tenants).all()).toEqual([]);
    expect(fresh.select().from(s.settings).all()).toEqual([]);
    // the same call on a checkout still seeds
    expect(seed(fresh, { packaged: false }).seeded).toBe(true);
  });
});
