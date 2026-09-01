/**
 * The four reports that are not the Sales report.
 *
 * Three of them are POSITIONS — valuation, used holding and dead stock answer
 * "right now" — and the fourth, repairs, is one of each. Each carries the
 * cross-check that ties it to a figure the shop already trusts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { imeiWithCheckDigit, uuidv7, type UsedLogRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { listInventory } from "../repos/inventory";
import { openShiftTx } from "../repos/shift";
import { logPurchase } from "../repos/used";
import { addLine, createTicket, markReady, collect, upsertCustomer } from "../repos/repair";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const DAY = 86_400_000;
const IMEIS = [
  imeiWithCheckDigit("35209411880318"),
  imeiWithCheckDigit("86123456789012"),
  imeiWithCheckDigit("49015420323751"),
];

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-reports2-"));
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
let groupId: string;
const ctxOf = () => ({ ...env.ctx, userId: owner.id });
const get = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;

function makeProduct(name: string, costCents: number, onHand: number, itemType: "stocked" | "serialized" = "stocked") {
  const id = uuidv7();
  const now = new Date();
  env.db
    .insert(s.products)
    .values({
      id,
      tenantId: env.ctx.tenantId,
      groupId,
      name,
      itemType,
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

function purchase(imei: string, over: Partial<UsedLogRequest> = {}): UsedLogRequest {
  return {
    device: {
      brand: "Apple",
      model: "iPhone SE 2020",
      storage: "64GB",
      color: "Blanco",
      grade: "B",
      batteryPct: 86,
      imei,
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
    ...over,
  };
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
  env.db.insert(s.productGroups).values({ id: groupId, tenantId: env.ctx.tenantId, name: "Accesorios", sortOrder: 1, createdAt: new Date() }).run();
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
});

/* ================================================== valuation ========= */

describe("inventory valuation", () => {
  it("equals the Inventario screen's total, to the cent", async () => {
    makeProduct("Funda", 400, 10);
    makeProduct("Cargador", 850, 3);
    makeProduct("Protector", 0, 7); // a product whose cost nobody filled in

    const res = await get<{ totalCents: number }>("reports:valuation", { groupId: null });
    const screenTotal = listInventory(env.db, ctxOf(), {}).reduce((sum, r) => sum + r.valuationCents, 0);

    // if these ever differ, one of the two screens is lying and the shop cannot
    // tell which — so they use the same SQL expression, deliberately
    expect(res.totalCents).toBe(screenTotal);
    expect(res.totalCents).toBe(10 * 400 + 3 * 850);
  });

  it("values a serialized product at the sum of its units' own costs", async () => {
    const phone = makeProduct("iPhone", 0, 2, "serialized");
    const now = new Date();
    for (const [i, cost] of [30000, 34000].entries()) {
      env.db
        .insert(s.units)
        .values({
          id: uuidv7(),
          tenantId: env.ctx.tenantId,
          locationId: env.ctx.locationId,
          productId: phone,
          imei: IMEIS[i]!,
          status: "in_stock",
          costCents: cost,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const res = await get<{ totalCents: number; products: Array<{ unitCostCents: number | null; valueCents: number }> }>(
      "reports:valuation",
      { groupId: null },
    );
    expect(res.totalCents).toBe(64000);
    // five identical phones bought at three prices have no single unit cost
    expect(res.products[0]!.unitCostCents).toBeNull();
    expect(res.products[0]!.valueCents).toBe(64000);
    expect(res.totalCents).toBe(listInventory(env.db, ctxOf(), {}).reduce((sum, r) => sum + r.valuationCents, 0));
  });

  it("groups add up to the total", async () => {
    const other = uuidv7();
    env.db.insert(s.productGroups).values({ id: other, tenantId: env.ctx.tenantId, name: "Móviles", sortOrder: 2, createdAt: new Date() }).run();
    makeProduct("Funda", 400, 10);
    const p = makeProduct("Cable", 200, 5);
    env.db.update(s.products).set({ groupId: other }).where(eq(s.products.id, p)).run();

    const res = await get<{ totalCents: number; groups: Array<{ valueCents: number }> }>("reports:valuation", { groupId: null });
    expect(res.groups.reduce((sum, g) => sum + g.valueCents, 0)).toBe(res.totalCents);
  });
});

/* ================================================ used holding ========= */

describe("used device holding", () => {
  it("equals the sum of the held units' own costs", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!, { buyPriceCents: 12000 }));

    const res = await get<{ totalCostCents: number; rows: Array<{ costCents: number }>; summary: Array<{ state: string; count: number; costCents: number }> }>(
      "reports:used",
      { status: null, grade: null },
    );
    expect(res.totalCostCents).toBe(20000);
    expect(res.rows.reduce((sum, r) => sum + r.costCents, 0)).toBe(res.totalCostCents);
    expect(res.summary.find((x) => x.state === "held")).toEqual({ state: "held", count: 2, costCents: 20000 });
  });

  it("counts the refurbishment, because that money is tied up too", async () => {
    const result = await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));
    env.db.update(s.usedPurchases).set({ refurbCostCents: 2500 }).where(eq(s.usedPurchases.id, result.purchaseId)).run();

    const res = await get<{ totalCostCents: number }>("reports:used", { status: null, grade: null });
    expect(res.totalCostCents).toBe(10500);
  });

  it("puts the oldest first, which is the question it answers", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!));
    // age the first one
    const rows = env.db.select().from(s.usedPurchases).all();
    env.db
      .update(s.usedPurchases)
      .set({ purchasedAt: new Date(Date.now() - 90 * DAY) })
      .where(eq(s.usedPurchases.id, rows[1]!.id))
      .run();

    const res = await get<{ rows: Array<{ daysHeld: number }> }>("reports:used", { status: null, grade: null });
    expect(res.rows[0]!.daysHeld).toBe(90);
    expect(res.rows[0]!.daysHeld).toBeGreaterThanOrEqual(res.rows[1]!.daysHeld);
  });

  it("reports the credit the shop still owes, beside the money it holds", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { payout: "store_credit" }));
    const res = await get<{ storeCredit: { count: number; totalCents: number } }>("reports:used", { status: null, grade: null });
    expect(res.storeCredit).toEqual({ count: 1, totalCents: 8000 });
  });

  it("filters the table without changing the position", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!, { buyPriceCents: 12000, device: { ...purchase(IMEIS[1]!).device, imei: IMEIS[1]!, grade: "A" } }));

    const res = await get<{ totalCostCents: number; rows: unknown[] }>("reports:used", { status: null, grade: "A" });
    expect(res.rows).toHaveLength(1);
    // a filter narrows the table; it does not change how much is tied up
    expect(res.totalCostCents).toBe(20000);
  });
});

/* ==================================================== repairs ========== */

describe("repairs", () => {
  async function takeIn(over: Record<string, unknown> = {}) {
    const customer = upsertCustomer(env.db, ctxOf(), { name: "Joan Puig", phone: `6712209${Math.floor(Math.random() * 90 + 10)}` });
    return createTicket(env.db, ctxOf(), {
      customerId: customer.id,
      deviceDescription: "Apple iPhone 11",
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
      ...over,
    } as Parameters<typeof createTicket>[2]);
  }

  it("lists what is open, and highlights what is waiting on the customer", async () => {
    const a = await takeIn();
    await takeIn();
    // a quote makes the shop wait on somebody else
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: a.ticketId, description: "Cambio de pantalla", chargeCents: 3000 });

    const res = await get<{ summary: { open: number; waitingOnCustomer: number; overdue: number; oldest: { days: number } | null } }>(
      "reports:repairsOpen",
      { status: null, technicianId: null },
    );
    expect(res.summary.open).toBe(2);
    expect(res.summary.waitingOnCustomer).toBe(1);
    expect(res.summary.overdue).toBe(0);
    expect(res.summary.oldest).not.toBeNull();
  });

  it("flags a promise the shop has already missed", async () => {
    await takeIn({ promisedDate: Date.now() - 3 * DAY });
    const res = await get<{ summary: { overdue: number }; rows: Array<{ overdue: boolean }> }>("reports:repairsOpen", {
      status: null,
      technicianId: null,
    });
    expect(res.summary.overdue).toBe(1);
    expect(res.rows[0]!.overdue).toBe(true);
  });

  it("drops a ticket out of Open the moment it is collected", async () => {
    const ticket = await takeIn();
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 3000 });
    env.db
      .insert(s.repairApprovals)
      .values({
        id: uuidv7(),
        tenantId: env.ctx.tenantId,
        ticketId: ticket.ticketId,
        method: "in_person",
        approvedTotalCents: 3000,
        userId: owner.id,
        createdAt: new Date(),
      })
      .run();
    markReady(env.db, ctxOf(), ticket.ticketId);
    collect(env.db, ctxOf(), { ticketId: ticket.ticketId, tenders: [{ method: "cash", amountCents: 3000 }] });

    const open = await get<{ summary: { open: number } }>("reports:repairsOpen", { status: null, technicianId: null });
    expect(open.summary.open).toBe(0);
  });

  it("closed revenue equals the sum of the collection documents", async () => {
    const ticket = await takeIn();
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 7900 });
    env.db
      .insert(s.repairApprovals)
      .values({
        id: uuidv7(),
        tenantId: env.ctx.tenantId,
        ticketId: ticket.ticketId,
        method: "in_person",
        approvedTotalCents: 7900,
        userId: owner.id,
        createdAt: new Date(),
      })
      .run();
    markReady(env.db, ctxOf(), ticket.ticketId);
    const collected = collect(env.db, ctxOf(), { ticketId: ticket.ticketId, tenders: [{ method: "cash", amountCents: 7900 }] });

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const res = await get<{ summary: { collected: number; revenueCents: number; laborCents: number } }>(
      "reports:repairsClosed",
      { fromMs: from, toMs: from + DAY, byTechnician: false },
    );

    const docTotal = env.db.select().from(s.documents).where(eq(s.documents.id, collected.docId)).all()[0]!.totalCents;
    expect(res.summary.collected).toBe(1);
    expect(res.summary.revenueCents).toBe(docTotal);
    expect(res.summary.laborCents).toBe(7900);
  });

  it("counts a repair collection as a sale too, because it is one", async () => {
    const ticket = await takeIn();
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 7900 });
    env.db
      .insert(s.repairApprovals)
      .values({
        id: uuidv7(),
        tenantId: env.ctx.tenantId,
        ticketId: ticket.ticketId,
        method: "in_person",
        approvedTotalCents: 7900,
        userId: owner.id,
        createdAt: new Date(),
      })
      .run();
    markReady(env.db, ctxOf(), ticket.ticketId);
    collect(env.db, ctxOf(), { ticketId: ticket.ticketId, tenders: [{ method: "cash", amountCents: 7900 }] });

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const byGroup = await get<{ summary: { grossCents: number }; rows: Array<{ label: string; grossCents: number }> }>(
      "reports:sales",
      { fromMs: from, toMs: from + DAY, shiftId: null, groupBy: "group" },
    );
    // the T1- a hand-back creates is an invoice like any other
    expect(byGroup.summary.grossCents).toBe(7900);
    expect(byGroup.rows.map((r) => r.label)).toContain("Reparaciones");
  });
});

/* ================================================== dead stock ========= */

describe("dead stock", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

  function soldOnce(productId: string, at: Date) {
    const docId = uuidv7();
    env.db
      .insert(s.documents)
      .values({
        id: docId,
        tenantId: env.ctx.tenantId,
        locationId: env.ctx.locationId,
        terminalId: env.ctx.terminalId,
        docType: "ticket",
        status: "completed",
        docNumber: `T1-${Math.floor(Math.random() * 899999) + 100000}`,
        subtotalCents: 826,
        taxCents: 174,
        totalCents: 1000,
        createdAt: at,
        completedAt: at,
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
        description: "x",
        qty: 1,
        unitPriceCents: 1000,
        priceOverridden: false,
        taxRegime: "IVA21",
        taxRateBp: 2100,
        baseCents: 826,
        taxCents: 174,
        totalCents: 1000,
        unitCostCents: 400,
        createdAt: at,
      })
      .run();
  }

  it("is inclusive at exactly N days, and excludes N−1", async () => {
    const dead = makeProduct("Funda vieja", 400, 10);
    const alive = makeProduct("Funda nueva", 400, 10);
    soldOnce(dead, daysAgo(90));
    soldOnce(alive, daysAgo(89));

    const res = await get<{ thresholdDays: number; rows: Array<{ productId: string }> }>("reports:deadStock", { groupId: null });
    expect(res.thresholdDays).toBe(90);
    // "no sale in 90 days" is how the shop says it; a strict comparison would
    // put the answer one day out from the question
    expect(res.rows.map((r) => r.productId)).toEqual([dead]);
  });

  it("includes a product that has never sold at all", async () => {
    const never = makeProduct("Nunca vendido", 900, 4);
    const res = await get<{ rows: Array<{ productId: string; lastSaleAtMs: number | null; daysSinceSale: number | null }> }>(
      "reports:deadStock",
      { groupId: null },
    );
    const row = res.rows.find((r) => r.productId === never)!;
    expect(row.lastSaleAtMs).toBeNull();
    expect(row.daysSinceSale).toBeNull();
  });

  it("ignores a product with no stock, however long ago it sold", async () => {
    const empty = makeProduct("Agotado", 400, 0);
    soldOnce(empty, daysAgo(400));
    const res = await get<{ rows: Array<{ productId: string }> }>("reports:deadStock", { groupId: null });
    expect(res.rows.map((r) => r.productId)).not.toContain(empty);
  });

  it("excludes used devices — the holding report covers them", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { action: "inventory", sellPriceCents: 15000 }));
    const res = await get<{ rows: Array<{ name: string }> }>("reports:deadStock", { groupId: null });
    // a used phone unsold for 90 days is a different conversation from 40 cases
    expect(res.rows.some((r) => r.name.includes("(usado)"))).toBe(false);
  });

  it("sorts by money, not by count", async () => {
    const cheap = makeProduct("Barato", 200, 40); // 80,00 €
    const dear = makeProduct("Caro", 90000, 1); // 900,00 €
    const res = await get<{ rows: Array<{ productId: string }>; totalCostCents: number }>("reports:deadStock", { groupId: null });
    expect(res.rows[0]!.productId).toBe(dear);
    expect(res.rows.map((r) => r.productId)).toContain(cheap);
    expect(res.totalCostCents).toBe(90000 + 8000);
  });
});
