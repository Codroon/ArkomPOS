/**
 * Giving money back — ADR-0019.
 *
 * The figures here are computed by hand. A refund is the one operation where
 * the shop is out of pocket if the till is wrong in its favour, and where a
 * customer is out of pocket if it is wrong the other way.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { opsToText, parseIpcError, renderZReport, uuidv7, type ShiftTotals } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx, shiftTotals } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const FLOAT = 20000;

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-refund-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  db.insert(s.numberSeries)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      docType: "ticket",
      prefix: "T1-",
      nextNumber: 1,
    })
    .run();
  return { db, ctx: { ...ids, userId: null as string | null } };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

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

const openShift = () => env.db.select().from(s.shifts).all().find((x) => x.closedAt === null)!;
const totals = (): ShiftTotals => shiftTotals(env.db, openShift());
const expected = () => totals().expectedCashCents;

/* ------------------------------------------------------------ fixtures */

function makeProduct(name: string, over: Partial<typeof s.products.$inferInsert> = {}) {
  const id = uuidv7();
  const now = new Date();
  env.db
    .insert(s.products)
    .values({
      id,
      tenantId: env.ctx.tenantId,
      name,
      itemType: "stocked",
      costCents: 500,
      priceCents: 1000,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      active: true,
      createdAt: now,
      updatedAt: now,
      ...over,
    })
    .run();
  env.db.insert(s.productStock).values({ productId: id, locationId: env.ctx.locationId, onHand: 10, updatedAt: now }).run();
  return id;
}

/**
 * A completed ticket, written directly.
 *
 * The sale path has its own tests; what matters here is the SHAPE a refund
 * reads — snapshotted tax per line, and a tender the drawer counted.
 */
function makeTicket(
  lines: Array<{ productId: string | null; unitId?: string | null; description: string; qty: number; unitPriceCents: number; taxRegime: "IVA21" | "REBU"; lineType?: "product" | "serialized_unit" }>,
  method: "cash" | "card" = "cash",
) {
  const now = new Date();
  const docId = uuidv7();
  const series = env.db.select().from(s.numberSeries).all().find((x) => x.docType === "ticket")!;
  const number = series.nextNumber;
  env.db.update(s.numberSeries).set({ nextNumber: number + 1 }).where(eq(s.numberSeries.id, series.id)).run();

  let subtotal = 0;
  let tax = 0;
  let total = 0;
  const built = lines.map((l, i) => {
    const lineTotal = l.unitPriceCents * l.qty;
    /* IVA21 is tax-inclusive here, as the sale path stores it; REBU carries no
       deductible VAT at all (ADR-0007) */
    const base = l.taxRegime === "REBU" ? lineTotal : Math.floor((lineTotal * 10000 + 6050) / 12100);
    const lineTax = l.taxRegime === "REBU" ? 0 : lineTotal - base;
    subtotal += base;
    tax += lineTax;
    total += lineTotal;
    return {
      id: uuidv7(),
      tenantId: env.ctx.tenantId,
      documentId: docId,
      lineNo: i + 1,
      lineType: (l.lineType ?? "product") as "product" | "serialized_unit",
      productId: l.productId,
      unitId: l.unitId ?? null,
      description: l.description,
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      priceOverridden: false,
      overrideReason: null,
      taxRegime: l.taxRegime,
      taxRateBp: l.taxRegime === "REBU" ? 0 : 2100,
      baseCents: base,
      taxCents: lineTax,
      totalCents: lineTotal,
      unitCostCents: 500,
      refundsLineId: null,
      refundedQty: 0,
      createdAt: now,
    };
  });

  env.db
    .insert(s.documents)
    .values({
      id: docId,
      tenantId: env.ctx.tenantId,
      locationId: env.ctx.locationId,
      terminalId: env.ctx.terminalId,
      docType: "ticket",
      status: "completed",
      seriesId: series.id,
      number,
      docNumber: `T1-${String(number).padStart(6, "0")}`,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
      shiftId: openShift().id,
      userId: owner.id,
      createdAt: now,
      completedAt: now,
    })
    .run();
  for (const l of built) env.db.insert(s.documentLines).values(l).run();
  env.db
    .insert(s.documentTenders)
    .values({ id: uuidv7(), tenantId: env.ctx.tenantId, documentId: docId, method, amountCents: total, createdAt: now })
    .run();

  for (const l of built) {
    if (!l.productId) continue;
    const stock = env.db
      .select()
      .from(s.productStock)
      .where(and(eq(s.productStock.productId, l.productId), eq(s.productStock.locationId, env.ctx.locationId)))
      .all()[0];
    if (stock) {
      env.db
        .update(s.productStock)
        .set({ onHand: stock.onHand - l.qty })
        .where(and(eq(s.productStock.productId, l.productId), eq(s.productStock.locationId, env.ctx.locationId)))
        .run();
    }
  }
  return { docId, total, subtotal, tax, lines: built };
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
  openShiftTx(env.db, ctxOf(), { floatCents: FLOAT, breakdown: null });
});

/* ------------------------------------------------- 1 · the tax reversal */

describe("tax reverses at the original line's snapshot", () => {
  it("reverses IVA21 at 21% and REBU at nothing", async () => {
    const phone = makeProduct("Funda azul");
    const used = makeProduct("iPhone 11 (usado)", { taxRegime: "REBU", taxRateBp: 0 });
    const ticket = makeTicket([
      { productId: phone, description: "Funda azul", qty: 1, unitPriceCents: 1210, taxRegime: "IVA21" },
      { productId: used, description: "iPhone 11 (usado)", qty: 1, unitPriceCents: 24000, taxRegime: "REBU" },
    ]);
    // hand-checked: 12,10 € inc. VAT = 10,00 base + 2,10 tax; REBU = 240,00 with none
    expect(ticket.subtotal).toBe(1000 + 24000);
    expect(ticket.tax).toBe(210);
    expect(ticket.total).toBe(25210);

    const res = await call<{ docNumber: string; totalCents: number }>("refund:create", {
      documentId: ticket.docId,
      reason: "Se arrepintió",
      method: "cash",
      lines: ticket.lines.map((l) => ({ lineId: l.id, qty: l.qty, restock: true })),
    });

    expect(res.docNumber).toBe("D1-000001");
    expect(res.totalCents).toBe(-25210);

    const doc = env.db.select().from(s.documents).all().find((d) => d.docType === "refund")!;
    expect(doc.subtotalCents).toBe(-(1000 + 24000));
    expect(doc.taxCents).toBe(-210);

    const lines = env.db.select().from(s.documentLines).where(eq(s.documentLines.documentId, doc.id)).all();
    const rebu = lines.find((l) => l.taxRegime === "REBU")!;
    /* the margin scheme carries no VAT the customer could deduct, so there is
       none to give back — even though the same model is sold at 21% new */
    expect(rebu.taxCents).toBe(0);
    expect(rebu.totalCents).toBe(-24000);

    const iva = lines.find((l) => l.taxRegime === "IVA21")!;
    expect(iva.taxCents).toBe(-210);
    expect(iva.baseCents).toBe(-1000);
  });

  it("leaves the original document untouched", async () => {
    const p = makeProduct("Cable");
    const ticket = makeTicket([{ productId: p, description: "Cable", qty: 1, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const before = env.db.select().from(s.documents).where(eq(s.documents.id, ticket.docId)).all()[0]!;

    await call("refund:create", {
      documentId: ticket.docId,
      reason: "Defectuoso",
      method: "cash",
      lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }],
    });

    const after = env.db.select().from(s.documents).where(eq(s.documents.id, ticket.docId)).all()[0]!;
    /* the sale happened. Its record says so, unchanged — the reversal is its
       own numbered document pointing back (ADR-0007, ADR-0019) */
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.taxCents).toBe(before.taxCents);
    expect(after.status).toBe("completed");
    expect(after.docNumber).toBe(before.docNumber);
  });
});

/* ---------------------------------------------- 2 · no double refunds */

describe("what has already gone back cannot go back again", () => {
  it("refuses at the line, after a partial refund", async () => {
    const p = makeProduct("Protector");
    const ticket = makeTicket([{ productId: p, description: "Protector", qty: 3, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const lineId = ticket.lines[0]!.id;

    expect(await code("refund:create", { documentId: ticket.docId, reason: "Uno", method: "cash", lines: [{ lineId, qty: 2, restock: true }] })).toBe("OK");
    expect(env.db.select().from(s.documentLines).where(eq(s.documentLines.id, lineId)).all()[0]!.refundedQty).toBe(2);

    // one left, so two is one too many — and it says so rather than clamping
    expect(await code("refund:create", { documentId: ticket.docId, reason: "Dos", method: "cash", lines: [{ lineId, qty: 2, restock: true }] })).toBe("VALIDATION");
    expect(await code("refund:create", { documentId: ticket.docId, reason: "Dos", method: "cash", lines: [{ lineId, qty: 1, restock: true }] })).toBe("OK");
    expect(env.db.select().from(s.documentLines).where(eq(s.documentLines.id, lineId)).all()[0]!.refundedQty).toBe(3);

    // and now nothing is left at all
    expect(await code("refund:create", { documentId: ticket.docId, reason: "Tres", method: "cash", lines: [{ lineId, qty: 1, restock: true }] })).toBe("VALIDATION");
  });

  it("closes to exactly the sale, however it was split", async () => {
    /* 3 × 9,90 = 29,70. Two then one must give back 29,70 to the cent, not
       29,69 or 29,71 — which is why the last unit takes the remainder */
    const p = makeProduct("Protector");
    const ticket = makeTicket([{ productId: p, description: "Protector", qty: 3, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const lineId = ticket.lines[0]!.id;

    await call("refund:create", { documentId: ticket.docId, reason: "a", method: "cash", lines: [{ lineId, qty: 2, restock: true }] });
    await call("refund:create", { documentId: ticket.docId, reason: "b", method: "cash", lines: [{ lineId, qty: 1, restock: true }] });

    const refunds = env.db.select().from(s.documents).all().filter((d) => d.docType === "refund");
    expect(refunds.reduce((a, d) => a + d.totalCents, 0)).toBe(-ticket.total);
    expect(refunds.reduce((a, d) => a + d.taxCents, 0)).toBe(-ticket.tax);
    expect(refunds.reduce((a, d) => a + d.subtotalCents, 0)).toBe(-ticket.subtotal);
  });

  it("refuses the same line twice inside one request", async () => {
    const p = makeProduct("Cable");
    const ticket = makeTicket([{ productId: p, description: "Cable", qty: 2, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const lineId = ticket.lines[0]!.id;
    /* each entry passes the remaining-qty check alone and together exceeds it */
    expect(
      await code("refund:create", {
        documentId: ticket.docId,
        reason: "x",
        method: "cash",
        lines: [
          { lineId, qty: 2, restock: true },
          { lineId, qty: 1, restock: true },
        ],
      }),
    ).toBe("VALIDATION");
  });
});

/* --------------------------------------------------------- 3 · the money */

describe("how the money goes back", () => {
  const sell = () => {
    const p = makeProduct("Cargador");
    return makeTicket([{ productId: p, description: "Cargador", qty: 1, unitPriceCents: 1490, taxRegime: "IVA21" }]);
  };

  it("takes cash out of the drawer, exactly", async () => {
    const ticket = sell();
    const before = expected();
    await call("refund:create", { documentId: ticket.docId, reason: "x", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }] });
    expect(expected()).toBe(before - 1490);
  });

  it("leaves the drawer alone for a card refund", async () => {
    const ticket = sell();
    const before = expected();
    await call("refund:create", { documentId: ticket.docId, reason: "x", method: "card", lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }] });
    expect(expected()).toBe(before);
  });

  it("issues one voucher for a store-credit refund, redeemable at its full value", async () => {
    const ticket = sell();
    const before = expected();
    const res = await call<{ voucherId: string | null }>("refund:create", {
      documentId: ticket.docId,
      reason: "x",
      method: "store_credit",
      lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }],
    });
    expect(res.voucherId).toBeTruthy();
    expect(expected()).toBe(before); // credit is a promise, not a note

    const vouchers = env.db.select().from(s.storeCreditVouchers).all();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ amountCents: 1490, remainingCents: 1490, status: "issued" });
    // linked to the refund that created it, not to a purchase
    expect(vouchers[0]!.refundDocumentId).toBe(res.voucherId ? vouchers[0]!.refundDocumentId : null);
    expect(vouchers[0]!.purchaseId).toBeNull();
  });

  it("needs an open shift like every other completed document", async () => {
    const ticket = sell();
    env.db.update(s.shifts).set({ closedAt: new Date() }).where(eq(s.shifts.id, openShift().id)).run();
    expect(await code("refund:create", { documentId: ticket.docId, reason: "x", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }] })).toBe("SHIFT_REQUIRED");
  });
});

/* --------------------------------------------------- 4 · goods coming back */

describe("goods coming back", () => {
  it("puts quantity stock on the shelf, as a movement", async () => {
    const p = makeProduct("Cable");
    const ticket = makeTicket([{ productId: p, description: "Cable", qty: 2, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const onHandAfterSale = env.db.select().from(s.productStock).all()[0]!.onHand;

    await call("refund:create", { documentId: ticket.docId, reason: "x", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 2, restock: true }] });

    expect(env.db.select().from(s.productStock).all()[0]!.onHand).toBe(onHandAfterSale + 2);
    const move = env.db.select().from(s.stockMovements).all().find((m) => m.movementType === "return_in")!;
    // insert-only: a return is a movement, never an UPDATE of a quantity (ADR-0004)
    expect(move.qty).toBe(2);
  });

  it("moves no stock when the box is not ticked", async () => {
    const p = makeProduct("Cable");
    const ticket = makeTicket([{ productId: p, description: "Cable", qty: 1, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const onHand = env.db.select().from(s.productStock).all()[0]!.onHand;

    await call("refund:create", { documentId: ticket.docId, reason: "roto", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: false }] });

    expect(env.db.select().from(s.productStock).all()[0]!.onHand).toBe(onHand);
    expect(env.db.select().from(s.stockMovements).all().filter((m) => m.movementType === "return_in")).toEqual([]);
  });

  it("sends a serialized unit to review, never straight back to sellable", async () => {
    const productId = makeProduct("iPhone 11 64GB", { itemType: "serialized" });
    const unitId = uuidv7();
    const now = new Date();
    env.db
      .insert(s.units)
      .values({
        id: unitId,
        tenantId: env.ctx.tenantId,
        locationId: env.ctx.locationId,
        productId,
        imei: "352094118803184",
        status: "sold",
        costCents: 20000,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const ticket = makeTicket([
      { productId, unitId, description: "iPhone 11 64GB", qty: 1, unitPriceCents: 30000, taxRegime: "IVA21", lineType: "serialized_unit" },
    ]);

    const res = await call<{ unitsToReviewCount: number }>("refund:create", {
      documentId: ticket.docId,
      reason: "No le gustó",
      method: "cash",
      lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }],
    });

    expect(res.unitsToReviewCount).toBe(1);
    const unit = env.db.select().from(s.units).where(eq(s.units.id, unitId)).all()[0]!;
    /* `held` is bought-but-not-in-stock: on-hand stays 0 and the Sale screen
       never offers it, which is the whole point (ADR-0013 §1) */
    expect(unit.status).toBe("held");
    expect(unit.status).not.toBe("in_stock");
  });
});

/* -------------------------------------------------------------- 5 · the Z */

describe("the Z", () => {
  it("shows what was sold and what was handed back as two facts", async () => {
    const p = makeProduct("Cargador");
    const a = makeTicket([{ productId: p, description: "Cargador", qty: 1, unitPriceCents: 1490, taxRegime: "IVA21" }]);
    const b = makeTicket([{ productId: p, description: "Cargador", qty: 1, unitPriceCents: 1000, taxRegime: "IVA21" }]);

    await call("refund:create", { documentId: a.docId, reason: "x", method: "cash", lines: [{ lineId: a.lines[0]!.id, qty: 1, restock: true }] });
    await call("refund:create", { documentId: b.docId, reason: "y", method: "store_credit", lines: [{ lineId: b.lines[0]!.id, qty: 1, restock: true }] });

    const t = totals();
    expect(t.refunds).toBeDefined();
    expect(t.refunds!.count).toBe(2);
    expect(t.refunds!.totalCents).toBe(1490 + 1000);
    expect(t.refunds!.byMethod.find((m) => m.method === "cash")!.amountCents).toBe(1490);
    expect(t.refunds!.byMethod.find((m) => m.method === "store_credit")!.amountCents).toBe(1000);

    /* sold 24,90 and gave 24,90 back: gross nets to zero, and only the refunds
       block lets anybody check that both halves happened */
    expect(t.grossSalesCents).toBe(0);
    // float + 14,90 cash sale + 10,00 cash sale − 14,90 cash refund
    expect(t.expectedCashCents).toBe(FLOAT + 1490 + 1000 - 1490);

    const text = opsToText(
      renderZReport(
        {
          zDocNumber: "Z1-000001",
          terminalName: "Caja 1",
          openedAtMs: Date.now(),
          openedByName: "Ahmer",
          closedAtMs: Date.now(),
          closedByName: "Ahmer",
          printedAtMs: Date.now(),
          isCopy: false,
          totals: t,
          countedCashCents: null,
          varianceCents: null,
          varianceReason: null,
          approvedByName: null,
        },
        { legalName: "Arkom", nif: "B1", address: "C/ Mayor", footerLine: "" },
      ),
    );
    expect(text).toContain("DEVOLUCIONES");
    expect(text).toContain("Ya descontadas de las ventas.");
  });

  it("prints nothing about refunds on a shift that had none", () => {
    expect(totals().refunds).toBeUndefined();
  });

  it("leaves a v1/v2 snapshot exactly as it was", () => {
    const base = {
      openingFloatCents: FLOAT,
      salesCashCents: 5000,
      movementsCashCents: 0,
      expectedCashCents: FLOAT + 5000,
      netSalesCents: 4132,
      taxCents: 868,
      usedSalesCents: 0,
      grossSalesCents: 5000,
      tendersByMethod: [{ method: "cash", amountCents: 5000 }],
      tendersTotalCents: 5000,
      tenderImbalanceCents: 0,
      movementsByReason: [],
      depositsByMethod: [],
      refundsByMethod: [],
      payoutsByMethod: [],
      byMethod: [{ method: "cash", inCents: 5000, outCents: 0, netCents: 5000 }],
      series: [],
      usedPurchaseCount: 0,
      repairsCollectedCount: 0,
      parkedCount: 0,
    } as unknown as ShiftTotals;
    const doc = {
      zDocNumber: "Z1-000001",
      terminalName: "Caja 1",
      openedAtMs: Date.UTC(2026, 0, 2, 8, 0),
      openedByName: "Ahmer",
      closedAtMs: Date.UTC(2026, 0, 2, 20, 0),
      closedByName: "Ahmer",
      printedAtMs: Date.UTC(2026, 0, 2, 20, 1),
      isCopy: false,
      totals: base,
      countedCashCents: FLOAT + 5000,
      varianceCents: 0,
      varianceReason: null,
      approvedByName: null,
    };
    const shop = { legalName: "Arkom", nif: "B1", address: "C/ Mayor", footerLine: "" };
    const printed = opsToText(renderZReport(doc, shop));
    /* v1 had no transfers block and v2 no refunds one; a reprint is a file read
       and must render what it rendered then (ADR-0015 §7) */
    expect(printed).not.toContain("DEVOLUCIONES");
    expect(printed).not.toContain("GIROS");
    expect(opsToText(renderZReport({ ...doc, totals: { ...base, refunds: undefined } }, shop))).toBe(printed);
  });
});

/* -------------------------------------------------------- 6 · the reports */

describe("the reports", () => {
  it("nets a refund out of Sales", async () => {
    const p = makeProduct("Cargador");
    const ticket = makeTicket([{ productId: p, description: "Cargador", qty: 2, unitPriceCents: 1000, taxRegime: "IVA21" }]);

    const day = { fromMs: Date.now() - 3_600_000, toMs: Date.now() + 3_600_000, groupBy: "day" as const };
    const before = await call<{ summary: { grossCents: number; tickets: number; refundsCents: number } }>("reports:sales", day);
    expect(before.summary.grossCents).toBe(2000);
    expect(before.summary.refundsCents).toBe(0);

    await call("refund:create", { documentId: ticket.docId, reason: "x", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 1, restock: true }] });

    const after = await call<{ summary: { grossCents: number; tickets: number; refundsCents: number; refundCount: number } }>(
      "reports:sales",
      day,
    );
    expect(after.summary.grossCents).toBe(1000);
    expect(after.summary.refundsCents).toBe(1000);
    expect(after.summary.refundCount).toBe(1);
    /* a refund is not a sale: counting it would report an average nobody could
       reproduce from the tickets in the drawer */
    expect(after.summary.tickets).toBe(1);
  });

  it("shows a restocked line back in the valuation", async () => {
    const p = makeProduct("Cable", { costCents: 300 });
    const ticket = makeTicket([{ productId: p, description: "Cable", qty: 2, unitPriceCents: 990, taxRegime: "IVA21" }]);
    const before = await call<{ totalCents: number }>("reports:valuation", {});

    await call("refund:create", { documentId: ticket.docId, reason: "x", method: "cash", lines: [{ lineId: ticket.lines[0]!.id, qty: 2, restock: true }] });

    const after = await call<{ totalCents: number }>("reports:valuation", {});
    // two cables at 3,00 cost are back on the shelf and worth counting again
    expect(after.totalCents).toBe(before.totalCents + 600);
  });
});
