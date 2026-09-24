/**
 * The catalogue's stock arithmetic and one document opened up, against a real
 * Postgres and rows worked out by hand.
 *
 * The trap here is the same shape as the dashboard's: a query over a jsonb
 * stream returns a plausible number when it is wrong. Specifically —
 *
 *   · on-hand is a SUM of signed quantities, so a sale that stored +2 instead
 *     of −2 would read as a shelf twice as full as it is
 *   · a product edited after creation must show its LATEST price, not its first
 *   · a line edited after it was written must read the way the receipt did
 *
 * Throwaway account, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import { productsForAccount, recentMovements } from "../catalogue-queries";
import { documentDetail } from "../document-queries";

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

const GROUP = uuidv7();
const FUNDA = uuidv7();
const CABLE = uuidv7();
const RETIRADO = uuidv7();
const TICKET = uuidv7();
const LINE_A = uuidv7();
const LINE_B = uuidv7();

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

const product = (id: string, over: Record<string, unknown>) => ({
  id,
  name: "Producto",
  active: true,
  barcode: null,
  groupId: GROUP,
  itemType: "stocked",
  costCents: 0,
  priceCents: 0,
  taxRegime: "IVA21",
  taxRateBp: 2100,
  lowStockThreshold: 0,
  ...over,
});

const movement = (productId: string, type: string, qty: number, cost = 0) => ({
  id: uuidv7(),
  productId,
  movementType: type,
  qty,
  unitCostCents: cost,
  createdAt: Date.now(),
});

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);

  await admin.insert(accounts).values({
    id: ACCOUNT, name: "Catalogue test", email: `cat.${stamp}@codroon.invalid`,
  });
  await admin.insert(tenants).values({ id: TENANT, accountId: ACCOUNT, name: "Tienda" });
  await admin.insert(devices).values({
    id: DEVICE, accountId: ACCOUNT, tenantId: TENANT, locationId: "loc", terminalId: "term",
    terminalName: "Caja", tokenHash: `cat-${stamp}`, appVersion: "1.2.0",
  });

  await admin.insert(syncEntries).values([
    entry("product_group", "create", { id: GROUP, name: "Accesorios" }),

    // a funda, later repriced: the second figure is the real one
    entry("product", "create", product(FUNDA, { name: "Funda", priceCents: 1290, costCents: 500, barcode: "2087956346121" })),
    entry("product", "update", product(FUNDA, { name: "Funda", priceCents: 1490, costCents: 500, barcode: "2087956346121" })),
    // +4 in, −2 sold, +1 returned  =>  3 on the shelf
    entry("stock_movement", "create", movement(FUNDA, "purchase_in", 4, 500)),
    entry("stock_movement", "create", movement(FUNDA, "sale_out", -2)),
    entry("stock_movement", "create", movement(FUNDA, "return_in", 1)),

    // a cable that sold out completely, and is at its low-stock threshold
    entry("product", "create", product(CABLE, { name: "Cable USB-C", priceCents: 900, costCents: 300, lowStockThreshold: 2 })),
    entry("stock_movement", "create", movement(CABLE, "purchase_in", 2, 300)),
    entry("stock_movement", "create", movement(CABLE, "sale_out", -2)),

    // and one archived: still listed, flagged, and last
    entry("product", "create", product(RETIRADO, { name: "Descatalogado", priceCents: 100 })),
    entry("product", "update", product(RETIRADO, { name: "Descatalogado", priceCents: 100, active: false })),

    // a ticket with two lines, the second corrected afterwards
    entry("document", "complete", {
      id: TICKET, status: "completed", docNumber: "T1-000009", docType: "ticket",
      totalCents: 3880, taxCents: 673, subtotalCents: 3207, completedAt: Date.now(),
    }),
    entry("document_line", "create", {
      id: LINE_A, documentId: TICKET, lineNo: 1, description: "Funda", qty: 2,
      unitPriceCents: 1490, baseCents: 2463, taxCents: 517, totalCents: 2980, taxRegime: "IVA21",
    }),
    entry("document_line", "create", {
      id: LINE_B, documentId: TICKET, lineNo: 2, description: "Cable USB-C", qty: 1,
      unitPriceCents: 900, baseCents: 744, taxCents: 156, totalCents: 900, taxRegime: "IVA21",
    }),
    entry("document_line", "update", {
      id: LINE_B, documentId: TICKET, lineNo: 2, description: "Cable USB-C", qty: 1,
      unitPriceCents: 900, baseCents: 744, taxCents: 156, totalCents: 900, taxRegime: "IVA21",
      priceOverridden: true, overrideReason: "Cliente habitual",
    }),
    entry("document_tender", "create", { id: uuidv7(), documentId: TICKET, method: "cash", amountCents: 4000 }),
  ]);
}, 90_000);

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await client.end();
}, 60_000);

describe.skipIf(!ready)("what is on the shelf", () => {
  it("is the sum of the signed movements, not a stored figure", async () => {
    const products = await productsForAccount(ACCOUNT);
    const funda = products.find((p) => p.name === "Funda");

    // +4 − 2 + 1
    expect(funda?.onHand).toBe(3);
  });

  it("shows a repriced product at its latest price", async () => {
    const products = await productsForAccount(ACCOUNT);
    const funda = products.find((p) => p.name === "Funda");

    expect(funda?.priceCents).toBe(1490); // not the 1290 it was created at
    expect(funda?.costCents).toBe(500);
    expect(funda?.group).toBe("Accesorios");
    expect(funda?.barcode).toBe("2087956346121");
  });

  it("reaches zero without going negative or disappearing", async () => {
    const products = await productsForAccount(ACCOUNT);
    const cable = products.find((p) => p.name === "Cable USB-C");

    expect(cable?.onHand).toBe(0);
    expect(cable?.lowStockThreshold).toBe(2); // at or below: the screen flags it
  });

  it("keeps an archived article, marked and out of the way", async () => {
    const products = await productsForAccount(ACCOUNT);
    const gone = products.find((p) => p.name === "Descatalogado");

    expect(gone?.active).toBe(false);
    expect(products[products.length - 1]?.name).toBe("Descatalogado");
  });

  it("lists the movements that produced those figures", async () => {
    const movements = await recentMovements(ACCOUNT, 50);

    expect(movements).toHaveLength(5);
    expect(movements.some((m) => m.movementType === "sale_out" && m.qty === -2)).toBe(true);
    expect(movements.every((m) => m.productName !== "—")).toBe(true);
  });
});

describe.skipIf(!ready)("one document, opened up", () => {
  it("reads its lines at their latest state", async () => {
    const detail = await documentDetail(ACCOUNT, TICKET);

    expect(detail?.head).toMatchObject({ docNumber: "T1-000009", totalCents: 3880, taxCents: 673 });
    expect(detail?.lines).toHaveLength(2);
    expect(detail?.lines[0]).toMatchObject({ lineNo: 1, description: "Funda", qty: 2 });
    /* the correction: the line was written plainly and edited afterwards, and
       the receipt the customer holds says the price was changed */
    expect(detail?.lines[1]).toMatchObject({ lineNo: 2, priceOverridden: true });
  });

  it("carries the tender, so the change can be shown", async () => {
    const detail = await documentDetail(ACCOUNT, TICKET);
    expect(detail?.tenders).toEqual([{ method: "cash", amountCents: 4000 }]);
  });

  it("is invisible to another account, id or no id", async () => {
    const stranger = uuidv7();
    await admin.insert(accounts).values({
      id: stranger, name: "Otra", email: `otra.${stamp}@codroon.invalid`,
    });
    try {
      expect(await documentDetail(stranger, TICKET)).toBeNull();
      expect(await productsForAccount(stranger)).toEqual([]);
      expect(await recentMovements(stranger)).toEqual([]);
    } finally {
      await admin.delete(accounts).where(eq(accounts.id, stranger));
    }
  });
});
