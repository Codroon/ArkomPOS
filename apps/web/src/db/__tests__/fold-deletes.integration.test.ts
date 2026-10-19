/**
 * A deletion is a fact — the bug the pilot shop found on its first day.
 *
 * A cashier scanned nine items, took eight back out, and charged for one phone.
 * The till deleted the eight lines and printed a correct receipt for 105 €. The
 * cloud folded only the keys of each op's `after`, a deletion has no `after`,
 * and so the dashboard showed all nine items under a total of 105 €. Every
 * check we had compared TOTALS — the receipt's own total was right the whole
 * time — so nothing caught it until a person looked at the lines.
 *
 * The till deletes exactly five kinds of record: a receipt (an emptied cart), a
 * receipt line, a product, a barcode and a repair part. Each is exercised here
 * through the screens that show it, not just through `folded()`, because a
 * screen is where a wrong row becomes a wrong decision.
 *
 * And the second rule the same function got wrong: with two tills editing one
 * product, "newest" must mean newest by TIME. `seq` is each till's own counter,
 * so a till with a long history would win every argument regardless of when.
 *
 * Runs against real Postgres with throwaway accounts; skips without credentials.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import { folded } from "../fold";
import { documentDetail } from "../document-queries";
import { topProducts, documentsInPeriod, periodTotals } from "../dashboard-queries";
import { productsForAccount } from "../catalogue-queries";
import { repairDetail } from "../workshop-queries";
import { salesByGroup } from "../report-queries";
import { lastDays } from "../../lib/range";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI */
}

const ready = Boolean(process.env.DIRECT_URL);

let admin: ReturnType<typeof drizzle>;
let client: ReturnType<typeof postgres>;

const ACCOUNT = uuidv7();
const TENANT = uuidv7();
const TILL_A = uuidv7();
const TILL_B = uuidv7();
const stamp = Date.now();
const NOW = Date.now();

const GROUP = uuidv7();
const PHONE = uuidv7();
const CASE = uuidv7();
const CHARGER = uuidv7();
const RETIRED = uuidv7();
const REBORN = uuidv7();
const SHARED = uuidv7();
const CODE_KEPT = uuidv7();
const CODE_DROPPED = uuidv7();

const RECEIPT = uuidv7();
const LINE_SOLD = uuidv7();
const LINE_TAKEN_OUT_1 = uuidv7();
const LINE_TAKEN_OUT_2 = uuidv7();
const LINE_QTY_CHANGED = uuidv7();
const EMPTIED_CART = uuidv7();

const TICKET = uuidv7();
const PART_FITTED = uuidv7();
const PART_REMOVED = uuidv7();

const seqOf: Record<string, number> = { [TILL_A]: 0, [TILL_B]: 0 };

/** An op as a till queues it: identity in the column, payload partial or null. */
const op = (
  device: string,
  entity: string,
  action: string,
  entityId: string,
  after: Record<string, unknown> | null,
  atMs: number,
  seqJump = 1,
) => ({
  tenantId: TENANT,
  opId: uuidv7(),
  deviceId: device,
  seq: (seqOf[device] = (seqOf[device] ?? 0) + seqJump),
  locationId: "loc",
  terminalId: device === TILL_A ? "term-a" : "term-b",
  entity,
  entityId,
  action,
  before: null,
  after,
  userId: "u1",
  authorizedByUserId: null,
  createdAt: new Date(atMs),
});

const product = (id: string, name: string, priceCents: number, extra: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, name, barcode: null, groupId: GROUP, itemType: "stocked", costCents: 100,
  priceCents, taxRegime: "IVA21", taxRateBp: 2100, reorderPoint: 0, lowStockThreshold: 0,
  active: true, isDemo: false, createdAt: NOW - 86_400_000, updatedAt: NOW - 86_400_000, ...extra,
});

const line = (id: string, lineNo: number, productId: string, description: string, qty: number, unitPriceCents: number) => {
  const total = qty * unitPriceCents;
  const base = Math.round(total / 1.21);
  return {
    id, tenantId: TENANT, documentId: RECEIPT, lineNo, lineType: "product", productId, unitId: null,
    description, qty, unitPriceCents, priceOverridden: false, overrideReason: null,
    taxRegime: "IVA21", taxRateBp: 2100, baseCents: base, taxCents: total - base, totalCents: total,
  };
};

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);

  await admin.insert(accounts).values({ id: ACCOUNT, name: "Deletes test", email: `del.${ACCOUNT}.${stamp}@codroon.invalid` });
  await admin.insert(tenants).values({ id: TENANT, accountId: ACCOUNT, name: "Tienda" });
  for (const [id, term] of [[TILL_A, "term-a"], [TILL_B, "term-b"]] as const) {
    await admin.insert(devices).values({
      id, accountId: ACCOUNT, tenantId: TENANT, locationId: "loc", terminalId: term,
      terminalName: term, tokenHash: `del-${id}-${stamp}`, appVersion: "1.3.1",
    });
  }

  const t = NOW - 3_600_000; /* an hour ago, inside every period below */
  const A = TILL_A;
  const B = TILL_B;

  await admin.insert(syncEntries).values([
    op(A, "product_group", "create", GROUP, { id: GROUP, tenantId: TENANT, name: "Móviles", sortOrder: 0, isDemo: false, createdAt: t }, t),
    op(A, "product", "create", PHONE, product(PHONE, "A07 PRO 3/64GB Blue", 10500), t),
    op(A, "product", "create", CASE, product(CASE, "Funda Galaxy", 1500), t),
    op(A, "product", "create", CHARGER, product(CHARGER, "Cargador 45W", 2500), t),

    /* a product deleted on the till: gone from the catalogue */
    op(A, "product", "create", RETIRED, product(RETIRED, "Producto borrado", 999), t),
    op(A, "product", "delete", RETIRED, null, t + 1_000),

    /* deleted, then created again with the same id: only the new life counts */
    op(A, "product", "create", REBORN, product(REBORN, "Nombre antiguo", 500, { barcode: "OLD-111" }), t),
    op(A, "product", "delete", REBORN, null, t + 1_000),
    op(A, "product", "create", REBORN, product(REBORN, "Nombre nuevo", 700), t + 2_000),

    /* one product edited on two tills: till A has the longer history (its seq
       jumps to 500) but till B's edit is later in time, so B must win */
    op(A, "product", "create", SHARED, product(SHARED, "Protector", 900), t),
    op(A, "product", "update", SHARED, { priceCents: 950 }, t + 10_000, 500),
    op(B, "product", "update", SHARED, { priceCents: 990 }, t + 20_000),

    /* barcodes: one kept, one removed */
    op(A, "product_code", "create", CODE_KEPT, { id: CODE_KEPT, tenantId: TENANT, productId: PHONE, code: "8400000000017", createdAt: t }, t),
    op(A, "product_code", "create", CODE_DROPPED, { id: CODE_DROPPED, tenantId: TENANT, productId: PHONE, code: "8400000000024", createdAt: t }, t),
    op(A, "product_code", "delete", CODE_DROPPED, null, t + 1_000),

    /* --- the receipt from the pilot, in miniature --------------------- */
    op(A, "document", "create", RECEIPT, {
      id: RECEIPT, tenantId: TENANT, locationId: "loc", terminalId: "term-a", docType: "ticket",
      status: "draft", docNumber: null, subtotalCents: 0, taxCents: 0, totalCents: 0, createdAt: t,
    }, t),
    op(A, "document_line", "create", LINE_TAKEN_OUT_1, line(LINE_TAKEN_OUT_1, 1, CASE, "Funda Galaxy", 1, 1500), t + 1_000),
    op(A, "document_line", "create", LINE_TAKEN_OUT_2, line(LINE_TAKEN_OUT_2, 2, CHARGER, "Cargador 45W", 1, 2500), t + 2_000),
    op(A, "document_line", "update", LINE_TAKEN_OUT_2, { qty: 2, totalCents: 5000, baseCents: 4132, taxCents: 868 }, t + 3_000),
    op(A, "document_line", "delete", LINE_TAKEN_OUT_1, null, t + 4_000),
    op(A, "document_line", "delete", LINE_TAKEN_OUT_2, null, t + 5_000),
    op(A, "document_line", "create", LINE_SOLD, line(LINE_SOLD, 1, PHONE, "A07 PRO 3/64GB Blue", 1, 10500), t + 6_000),
    /* a line whose quantity went up and back down stays, at its last quantity */
    op(A, "document_line", "create", LINE_QTY_CHANGED, line(LINE_QTY_CHANGED, 2, CASE, "Funda Galaxy", 1, 1500), t + 7_000),
    op(A, "document_line", "update", LINE_QTY_CHANGED, { qty: 3, totalCents: 4500, baseCents: 3719, taxCents: 781 }, t + 8_000),
    op(A, "document_line", "update", LINE_QTY_CHANGED, { qty: 1, totalCents: 1500, baseCents: 1240, taxCents: 260 }, t + 9_000),
    op(A, "document", "complete", RECEIPT, {
      status: "completed", docNumber: "T1-000001", number: 1,
      subtotalCents: 9918, taxCents: 2082, totalCents: 12000, completedAt: t + 10_000,
    }, t + 10_000),
    op(A, "document_tender", "create", uuidv7(), {
      id: uuidv7(), tenantId: TENANT, documentId: RECEIPT, method: "cash", amountCents: 12000, createdAt: t + 10_000,
    }, t + 10_000),

    /* a cart started and abandoned: the till deletes the empty draft */
    op(B, "document", "create", EMPTIED_CART, {
      id: EMPTIED_CART, tenantId: TENANT, locationId: "loc", terminalId: "term-b", docType: "ticket",
      status: "draft", subtotalCents: 0, taxCents: 0, totalCents: 0, createdAt: t,
    }, t),
    op(B, "document", "delete", EMPTIED_CART, null, t + 1_000),

    /* --- a repair with a part fitted and a part taken back off -------- */
    op(A, "repair_ticket", "create", TICKET, {
      id: TICKET, deviceDescription: "iPhone 13", reportedFault: "Pantalla", status: "received",
      depositCents: 0, createdAt: t,
    }, t),
    op(A, "repair_line", "create", PART_FITTED, {
      id: PART_FITTED, tenantId: TENANT, ticketId: TICKET, kind: "labor", description: "Mano de obra",
      qty: 1, chargeCents: 3000, createdAt: t + 1_000,
    }, t + 1_000),
    op(A, "repair_line", "create", PART_REMOVED, {
      id: PART_REMOVED, tenantId: TENANT, ticketId: TICKET, kind: "inventory_part", productId: CASE,
      description: "Pantalla equivocada", qty: 1, chargeCents: 8900, createdAt: t + 2_000,
    }, t + 2_000),
    op(A, "repair_line", "delete", PART_REMOVED, null, t + 3_000),
  ]);
});

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await client.end();
});

const rowsOf = async (entity: string) =>
  (await admin.execute(folded(ACCOUNT, entity))) as unknown as { id: string; row: Record<string, unknown> }[];

describe.runIf(ready)("a receipt with items taken back out of the cart", () => {
  it("shows only the line that was sold, and its quantity as it ended", async () => {
    const detail = await documentDetail(ACCOUNT, RECEIPT);
    const lines = detail!.lines.map((l) => `${l.qty}x ${l.description}`).sort();
    expect(lines).toEqual(["1x A07 PRO 3/64GB Blue", "1x Funda Galaxy"]);
  });

  it("has lines that add up to the receipt's own total", async () => {
    /* the invariant that would have caught the bug on day one */
    const detail = await documentDetail(ACCOUNT, RECEIPT);
    const sum = detail!.lines.reduce((total, l) => total + l.totalCents, 0);
    expect(sum).toBe(12_000);
  });

  it("does not count taken-out items as sold in top products", async () => {
    const top = await topProducts(ACCOUNT, lastDays(2), "es", 20);
    const names = top.map((p) => p.description);
    expect(names).not.toContain("Cargador 45W");
    const funda = top.find((p) => p.description === "Funda Galaxy");
    expect(funda?.qty).toBe(1);
    expect(top.reduce((total, p) => total + p.totalCents, 0)).toBe(12_000);
  });

  it("agrees with the period total in the sales-by-group report", async () => {
    const groups = await salesByGroup(ACCOUNT, lastDays(2), "es");
    const totals = await periodTotals(ACCOUNT, lastDays(2));
    /* lines grouped by product group, VAT included, must equal the receipts */
    const fromGroups = groups.reduce((total, g) => total + g.grossCents, 0);
    expect(fromGroups).toBe(12_000);
    expect(totals.current.netCents).toBe(12_000);
  });

  it("does not list an emptied cart the till threw away", async () => {
    const docs = await rowsOf("document");
    expect(docs.map((d) => d.id)).not.toContain(EMPTIED_CART);
    const listed = await documentsInPeriod(ACCOUNT, lastDays(2));
    expect(listed.map((d) => d.id)).not.toContain(EMPTIED_CART);
  });
});

describe.runIf(ready)("the catalogue", () => {
  it("drops a product the till deleted", async () => {
    const products = await productsForAccount(ACCOUNT);
    expect(products.map((p) => p.name)).not.toContain("Producto borrado");
  });

  it("shows a deleted-then-recreated product with only its new life", async () => {
    const products = await rowsOf("product");
    const reborn = products.find((p) => p.id === REBORN);
    expect(reborn?.row.name).toBe("Nombre nuevo");
    expect(reborn?.row.priceCents).toBe(700);
    /* the old barcode belonged to the deleted life */
    expect(reborn?.row.barcode ?? null).toBeNull();
  });

  it("drops a barcode the till removed", async () => {
    const codes = await rowsOf("product_code");
    expect(codes.map((c) => c.row.code)).toEqual(["8400000000017"]);
  });

  it("takes the later edit by time when two tills edit one product", async () => {
    /* till A's counter is far ahead; till B edited last */
    const products = await rowsOf("product");
    expect(products.find((p) => p.id === SHARED)?.row.priceCents).toBe(990);
  });
});

describe.runIf(ready)("a repair with a part taken back off", () => {
  it("shows only the parts still on it", async () => {
    const detail = await repairDetail(ACCOUNT, TICKET);
    expect(detail!.lines.map((l) => (l as unknown as { description: string }).description)).toEqual(["Mano de obra"]);
  });
});
