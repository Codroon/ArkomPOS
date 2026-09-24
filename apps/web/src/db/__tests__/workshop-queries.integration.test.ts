/**
 * Repairs, used devices, transfers and the reports — against a real Postgres
 * and rows worked out by hand.
 *
 * These four screens were built with no real data in the stream, from the till's
 * own writers, so the fixture IS the specification. The cases worth having are
 * the ones where a plausible wrong answer is easy:
 *
 *   · a repair's status is READ, never recomputed (ADR-0014 §1)
 *   · a device passcode cannot come out of these queries even if a row carried
 *     one, because no query selects it (ADR-0020 §3)
 *   · a transfer's PRINCIPAL is not revenue; only the fee is (ADR-0018)
 *   · REBU is its own tax row and never averaged into the general rate
 *   · dead stock includes what has NEVER sold, which is the deadest of all
 *
 * Throwaway account, deleted afterwards; accounts cascade.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import { repairDetail, repairsForAccount, transfersForAccount, usedForAccount } from "../workshop-queries";
import {
  deadStock,
  outstandingCredit,
  repairsClosed,
  repairsOpen,
  salesByGroup,
  salesSummary,
  taxByRegime,
  usedHolding,
  valuation,
} from "../report-queries";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI */
}

const ready = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

let admin: ReturnType<typeof drizzle>;
let client: ReturnType<typeof postgres>;

const ACCOUNT = uuidv7();
const TENANT = uuidv7();
const DEVICE = uuidv7();
const stamp = Date.now();

const TICKET = uuidv7();
const TICKET_DONE = uuidv7();
const CUSTOMER = uuidv7();
const PURCHASE = uuidv7();
const UNIT = uuidv7();
const GROUP = uuidv7();
const FUNDA = uuidv7();
const STALE = uuidv7();
const DOC = uuidv7();

const NOW = Date.now();
const LONG_AGO = NOW - 200 * 24 * 60 * 60 * 1000;

let seq = 0;
const entry = (entity: string, action: string, after: Record<string, unknown>) => ({
  tenantId: TENANT,
  opId: uuidv7(),
  deviceId: DEVICE,
  seq: (seq += 1),
  locationId: "loc",
  terminalId: "term",
  entity,
  entityId: String(after.id ?? uuidv7()),
  action,
  before: null,
  after,
  userId: "u1",
  authorizedByUserId: null,
  createdAt: new Date(),
});

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);

  await admin.insert(accounts).values({
    id: ACCOUNT, name: "Workshop test", email: `ws.${stamp}@codroon.invalid`,
  });
  await admin.insert(tenants).values({ id: TENANT, accountId: ACCOUNT, name: "Tienda" });
  await admin.insert(devices).values({
    id: DEVICE, accountId: ACCOUNT, tenantId: TENANT, locationId: "loc", terminalId: "term",
    terminalName: "Caja", tokenHash: `ws-${stamp}`, appVersion: "1.3.0",
  });

  await admin.insert(syncEntries).values([
    entry("customer", "create", { id: CUSTOMER, name: "Marta Ruiz", phone: "600123456" }),

    /* a ticket booked in, quoted, then a part fitted. The status column is what
       the till derived; a passcode is included ON PURPOSE to prove no query can
       surface it. */
    entry("repair_ticket", "create", {
      id: TICKET, customerId: CUSTOMER, deviceDescription: "iPhone 13 negro",
      imei: "353474049489560", reportedFault: "No carga", status: "received",
      depositCents: 2000, devicePasscode: "4417", promisedDate: "2026-10-02",
      createdAt: NOW - 3 * 60 * 60 * 1000,
    }),
    entry("repair_ticket", "update", {
      id: TICKET, customerId: CUSTOMER, deviceDescription: "iPhone 13 negro",
      imei: "353474049489560", reportedFault: "No carga", status: "in_repair",
      depositCents: 2000, devicePasscode: "4417", promisedDate: "2026-10-02",
      createdAt: NOW - 3 * 60 * 60 * 1000,
    }),
    entry("repair_line", "create", {
      id: uuidv7(), ticketId: TICKET, kind: "inventory_part", description: "Conector de carga",
      qty: 1, chargeCents: 4500, supplierText: "Distribuidora BCN",
    }),
    entry("repair_line", "create", {
      id: uuidv7(), ticketId: TICKET, kind: "labor", description: "Mano de obra",
      qty: 1, chargeCents: 2000,
    }),
    // a second ticket, already collected
    entry("repair_ticket", "create", {
      id: TICKET_DONE, deviceDescription: "Samsung A52", status: "collected",
      depositCents: 0, createdAt: NOW - 20 * 24 * 60 * 60 * 1000,
    }),

    /* a used device bought and still held */
    entry("used_purchase", "create", {
      id: PURCHASE, unitId: UNIT, brand: "Apple", model: "iPhone 12", storage: "128GB",
      color: "Azul", grade: "B", batteryPct: 87, imei: "356938035643809",
      sellerName: "Imran Ali", sellerIdNumber: "Y2841170F",
      buyPriceCents: 18000, refurbCostCents: 2500, needsReview: false, purchasedAt: NOW - 86400000,
    }),
    entry("unit", "create", { id: UNIT, status: "in_stock", salePriceCents: 29900, costCents: 20500 }),

    /* transfers: one paid, one cancelled */
    entry("transfer", "create", {
      id: uuidv7(), kind: "send", status: "paid", mtcn: "1234567890",
      senderName: "Ana", receiverName: "Luis", countryCode: "MA",
      principalCents: 50000, feeCents: 900, createdAt: NOW - 3600000,
    }),
    entry("transfer", "create", {
      id: uuidv7(), kind: "send", status: "cancelled", mtcn: "9999999999",
      senderName: "Pedro", receiverName: "Sara", countryCode: "CO",
      principalCents: 20000, feeCents: 600, createdAt: NOW - 7200000,
      cancelledAt: NOW - 3500000,
    }),

    /* stock for valuation and dead stock */
    entry("product_group", "create", { id: GROUP, name: "Accesorios" }),
    entry("product", "create", {
      id: FUNDA, name: "Funda", groupId: GROUP, costCents: 500, priceCents: 1290, active: true,
    }),
    entry("stock_movement", "create", {
      id: uuidv7(), productId: FUNDA, movementType: "purchase_in", qty: 10, createdAt: LONG_AGO,
    }),
    entry("stock_movement", "create", {
      id: uuidv7(), productId: FUNDA, movementType: "sale_out", qty: -2, createdAt: NOW - 86400000,
    }),
    // never sold at all: the deadest stock there is
    entry("product", "create", {
      id: STALE, name: "Cargador antiguo", groupId: GROUP, costCents: 800, priceCents: 1500, active: true,
    }),
    entry("stock_movement", "create", {
      id: uuidv7(), productId: STALE, movementType: "purchase_in", qty: 4, createdAt: LONG_AGO,
    }),

    /* a completed sale with two regimes, so REBU has to stay separate */
    entry("document", "complete", {
      id: DOC, status: "completed", docNumber: "T1-000100", docType: "ticket",
      totalCents: 31190, taxCents: 224, subtotalCents: 30966, completedAt: NOW - 7200000,
    }),
    entry("document_line", "create", {
      id: uuidv7(), documentId: DOC, lineNo: 1, description: "Funda", qty: 1, productId: FUNDA,
      taxRegime: "IVA21", baseCents: 1066, taxCents: 224, totalCents: 1290,
    }),
    entry("document_line", "create", {
      id: uuidv7(), documentId: DOC, lineNo: 2, description: "iPhone 12 usado", qty: 1,
      taxRegime: "REBU", baseCents: 29900, taxCents: 0, totalCents: 29900,
    }),

    /* a voucher with money still on it */
    entry("store_credit_voucher", "create", {
      id: uuidv7(), amountCents: 18000, remainingCents: 5000, status: "active", createdAt: NOW - 86400000,
    }),
    entry("store_credit_voucher", "create", {
      id: uuidv7(), amountCents: 3000, remainingCents: 0, status: "spent", createdAt: NOW - 86400000,
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await client.end();
}, 60_000);

describe.skipIf(!ready)("repairs", () => {
  it("reads the status the till derived, at its latest value", async () => {
    const repairs = await repairsForAccount(ACCOUNT);
    const ticket = repairs.find((row) => row.id === TICKET);

    expect(ticket?.status).toBe("in_repair"); // not the "received" it was booked in as
    expect(ticket?.customerName).toBe("Marta Ruiz");
    expect(ticket?.device).toBe("iPhone 13 negro");
  });

  it("totals the parts and the labour into what was quoted", async () => {
    const ticket = (await repairsForAccount(ACCOUNT)).find((row) => row.id === TICKET);
    expect(ticket?.parts).toBe(2);
    expect(ticket?.quotedCents).toBe(6500); // 45,00 + 20,00
  });

  it("CANNOT surface a device passcode, even though the fixture row carries one", async () => {
    /* the till strips it before queuing and the ingest strips it again; this is
       the third gate — no query selects it, so a row that somehow arrived with
       one still cannot put it on a screen */
    const repairs = await repairsForAccount(ACCOUNT);
    const detail = await repairDetail(ACCOUNT, TICKET);

    const dump = JSON.stringify({ repairs, detail });
    expect(dump).not.toContain("4417");
    expect(dump).not.toContain("devicePasscode");
    expect(dump).not.toContain("passcode");
  });

  it("opens one ticket with its lines in the order they were added", async () => {
    const detail = await repairDetail(ACCOUNT, TICKET);
    expect(detail?.lines.map((line) => line.kind)).toEqual(["inventory_part", "labor"]);
    expect(detail?.lines[0]?.supplier).toBe("Distribuidora BCN");
  });

  it("returns nothing for a ticket belonging to another account", async () => {
    const stranger = uuidv7();
    await admin.insert(accounts).values({
      id: stranger, name: "Otra", email: `ws2.${stamp}@codroon.invalid`,
    });
    try {
      expect(await repairDetail(stranger, TICKET)).toBeNull();
      expect(await repairsForAccount(stranger)).toEqual([]);
    } finally {
      await admin.delete(accounts).where(eq(accounts.id, stranger));
    }
  });
});

describe.skipIf(!ready)("used devices", () => {
  it("joins the purchase to its unit, so the shelf state is visible", async () => {
    const used = await usedForAccount(ACCOUNT);

    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({
      device: "Apple iPhone 12 128GB Azul",
      grade: "B",
      batteryPct: 87,
      buyPriceCents: 18000,
      refurbCostCents: 2500,
      unitStatus: "in_stock",
      salePriceCents: 29900,
    });
  });

  it("keeps the seller's name and leaves their ID document out of the list", async () => {
    /* the row carries it (ADR-0020 §3 syncs seller rows) but a list on a screen
       is not where an identity document belongs */
    const used = await usedForAccount(ACCOUNT);
    const dump = JSON.stringify(used);
    expect(dump).toContain("Imran Ali");
    expect(dump).not.toContain("Y2841170F");
  });
});

describe.skipIf(!ready)("transfers", () => {
  it("keeps the principal and the fee apart, and marks the cancelled one", async () => {
    const transfers = await transfersForAccount(ACCOUNT);

    expect(transfers).toHaveLength(2);
    const paid = transfers.find((row) => row.mtcn === "1234567890");
    expect(paid).toMatchObject({ principalCents: 50000, feeCents: 900, cancelledAt: null });

    const cancelled = transfers.find((row) => row.mtcn === "9999999999");
    expect(cancelled?.cancelledAt).not.toBeNull();
  });
});

describe.skipIf(!ready)("the reports", () => {
  it("gives REBU its own row instead of averaging it into the general rate", async () => {
    const tax = await taxByRegime(ACCOUNT, 30);

    const rebu = tax.find((row) => row.regime === "REBU");
    const general = tax.find((row) => row.regime === "IVA21");
    expect(rebu).toMatchObject({ baseCents: 29900, taxCents: 0, lines: 1 });
    expect(general).toMatchObject({ baseCents: 1066, taxCents: 224, lines: 1 });
  });

  it("values the shelves at cost and at retail, from the movement sums", async () => {
    const rows = await valuation(ACCOUNT);

    // funda: 10 − 2 = 8 at 5,00 = 40,00 · cargador: 4 at 8,00 = 32,00
    const accesorios = rows.find((row) => row.group === "Accesorios");
    expect(accesorios).toMatchObject({ items: 2, units: 12, atCostCents: 7200 });
    expect(accesorios?.atRetailCents).toBe(8 * 1290 + 4 * 1500);
  });

  it("counts what has NEVER sold as dead stock", async () => {
    const dead = await deadStock(ACCOUNT, 90);

    const never = dead.find((row) => row.name === "Cargador antiguo");
    expect(never).toBeTruthy();
    expect(never?.lastSoldAt).toBeNull();
    expect(never?.atCostCents).toBe(3200);

    // the funda sold yesterday, so it is not dead
    expect(dead.some((row) => row.name === "Funda")).toBe(false);
  });

  it("lists only vouchers with money left on them", async () => {
    const vouchers = await outstandingCredit(ACCOUNT);

    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ amountCents: 18000, remainingCents: 5000 });
  });
});

describe.skipIf(!ready)("the reports that mirror the till's", () => {
  it("summarises sales the way the till's sales report does", async () => {
    const summary = await salesSummary(ACCOUNT, 30);

    expect(summary.tickets).toBe(1);
    expect(summary.grossCents).toBe(31190);
    expect(summary.taxCents).toBe(224);
    expect(summary.netCents).toBe(30966);
    expect(summary.averageTicketCents).toBe(31190);
    /* the margin-scheme line on its own figure: it carries no VAT and must not
       be read as if it did */
    expect(summary.usedSalesCents).toBe(29900);
    expect(summary.refundCount).toBe(0);
  });

  it("splits sales by the shelf they came off", async () => {
    const rows = await salesByGroup(ACCOUNT, 30);

    const accesorios = rows.find((row) => row.label === "Accesorios");
    expect(accesorios).toMatchObject({ count: 1, qty: 1, netCents: 1066, grossCents: 1290 });

    /* the used phone was sold as a line with no product behind it, so it lands
       in the ungrouped row rather than being dropped */
    const ungrouped = rows.find((row) => row.label === "—");
    expect(ungrouped?.grossCents).toBe(29900);
  });

  it("lists the repairs the shop still has, and not the ones it handed back", async () => {
    const open = await repairsOpen(ACCOUNT);

    expect(open.map((row) => row.device)).toEqual(["iPhone 13 negro"]);
    expect(open[0]).toMatchObject({ status: "in_repair", customerName: "Marta Ruiz" });
    expect(open[0]?.daysSinceIntake).toBeGreaterThanOrEqual(0);
  });

  it("lists the closed ones with what the lines say, and no invented margin", async () => {
    const closed = await repairsClosed(ACCOUNT);

    expect(closed.map((row) => row.device)).toEqual(["Samsung A52"]);
    expect(closed[0]).toMatchObject({ status: "collected", chargedCents: 0 });
    /* no `marginCents` on the row at all — the collection ticket is a separate
       document and tying it back is not something this report can do honestly */
    expect(closed[0]).not.toHaveProperty("marginCents");
  });

  it("shows used stock at what it cost to get there, not what was paid to the seller", async () => {
    const held = await usedHolding(ACCOUNT);

    expect(held).toHaveLength(1);
    // 180,00 paid + 25,00 refurbished
    expect(held[0]).toMatchObject({ state: "in_stock", costCents: 20500, salePriceCents: 29900 });
    expect(held[0]?.daysHeld).toBeGreaterThanOrEqual(0);
  });

  it("shows none of it to another account", async () => {
    const stranger = uuidv7();
    await admin.insert(accounts).values({
      id: stranger, name: "Otra", email: `ws3.${stamp}@codroon.invalid`,
    });
    try {
      expect((await salesSummary(stranger, 30)).tickets).toBe(0);
      expect(await salesByGroup(stranger, 30)).toEqual([]);
      expect(await repairsOpen(stranger)).toEqual([]);
      expect(await repairsClosed(stranger)).toEqual([]);
      expect(await usedHolding(stranger)).toEqual([]);
    } finally {
      await admin.delete(accounts).where(eq(accounts.id, stranger));
    }
  });
});
