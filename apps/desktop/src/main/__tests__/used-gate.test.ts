/**
 * The purchase gate, against a REAL database.
 *
 * The gate's whole job is to answer "have we seen this phone before?", and that
 * question is a query — a mock that returns what the test wants proves nothing.
 * So this file inserts an actual unit and an actual purchase and then asks.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { imeiWithCheckDigit, parseIpcError, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const FRESH = imeiWithCheckDigit("35209411880318");
const IN_UNIT = imeiWithCheckDigit("86123456789012");
const IN_PURCHASE = imeiWithCheckDigit("49015420323751");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-used-gate-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();

  const groupId = uuidv7();
  db.insert(s.productGroups)
    .values({ id: groupId, tenantId: ids.tenantId, name: "Móviles", sortOrder: 0, createdAt: now })
    .run();

  const productId = uuidv7();
  db.insert(s.products)
    .values({
      id: productId,
      tenantId: ids.tenantId,
      groupId,
      name: "iPhone 11 64GB",
      itemType: "serialized",
      priceCents: 29900,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  /* a phone already in stock */
  db.insert(s.units)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      productId,
      imei: IN_UNIT,
      status: "in_stock",
      costCents: 20000,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  /* a purchase logged earlier and still on hold */
  const documentId = uuidv7();
  db.insert(s.documents)
    .values({
      id: documentId,
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      docType: "purchase",
      status: "completed",
      number: 7,
      docNumber: "C-000007",
      createdAt: now,
    })
    .run();
  db.insert(s.usedPurchases)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      documentId,
      brand: "Samsung",
      model: "Galaxy A52",
      grade: "B",
      imei: IN_PURCHASE,
      sellerName: "Imran K.",
      sellerIdType: "DNI",
      sellerIdNumber: "Y2841170F",
      buyPriceCents: 8000,
      payoutMethod: "cash",
      purchasedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { db, ctx: { ...ids, userId: null }, productId };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
let cashier: { id: string };
let blocked: { id: string };

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
  blocked = createUser(env.db, env.ctx, {
    name: "Nuevo",
    role: "cashier",
    pin: "7409",
    overrides: { "usedDevices.create": false },
  }).user;
  registerIpcHandlers(env.db);
});

const check = async (imei: string): Promise<{ ok: boolean; rejection: string | null; existing: { label: string } | null }> =>
  (await handlers.get("used:checkImei")!({}, { imei })) as never;

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/** The session the guard reads. Roles and overrides come from the row we made. */
const login = (user: { id: string; name: string; role: "owner" | "cashier"; overrides?: Record<string, boolean> }) =>
  startSession({ id: user.id, name: user.name, role: user.role, overrides: user.overrides ?? {} });

describe("the gate answers from the database", () => {
  beforeEach(() => login({ id: cashier.id, name: "Ana", role: "cashier" }));

  it("passes a valid IMEI the shop has never seen", async () => {
    const result = await check(FRESH);
    expect(result).toEqual({ ok: true, rejection: null, existing: null });
  });

  it("rejects a bad check digit without looking anything up", async () => {
    // the same Luhn rule serialized stock entry uses — one definition of an IMEI
    const result = await check("352094118803181");
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("format");
    expect(result.existing).toBeNull();
  });

  it("rejects a device already held as a unit, and names it", async () => {
    const result = await check(IN_UNIT);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("duplicate_unit");
    expect(result.existing?.label).toBe("iPhone 11 64GB");
  });

  it("rejects a device whose earlier purchase is still open, by its number", async () => {
    const result = await check(IN_PURCHASE);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe("duplicate_purchase");
    // the cashier will look for "C-7" in the drawer, not for a unit id
    expect(result.existing?.label).toContain("Samsung Galaxy A52");
  });

  it("tolerates surrounding whitespace from a scanner", async () => {
    expect((await check(`  ${FRESH}  `)).ok).toBe(true);
  });
});

describe("what the gate reveals", () => {
  beforeEach(() => login({ id: cashier.id, name: "Ana", role: "cashier" }));

  it("never returns seller data with a duplicate", async () => {
    // typing IMEIs into this field must not become a way to read the register
    const serialized = JSON.stringify(await check(IN_PURCHASE));
    expect(serialized).not.toContain("Imran");
    expect(serialized).not.toContain("Y2841170F");
    expect(serialized).not.toContain("8000");
  });
});

describe("who may ask", () => {
  it("refuses a cashier whose usedDevices.create is switched off", async () => {
    login({ id: blocked.id, name: "Nuevo", role: "cashier", overrides: { "usedDevices.create": false } });
    expect(await codeOf(() => check(FRESH))).toBe("PERMISSION_DENIED");
  });

  it("refuses with no session at all", async () => {
    endSession();
    expect(await codeOf(() => check(FRESH))).toBe("AUTH_REQUIRED");
  });

  it("lets the owner through", async () => {
    login({ id: owner.id, name: "Ahmer", role: "owner" });
    expect((await check(FRESH)).ok).toBe(true);
  });
});

describe("the audit trail", () => {
  const gateEntries = () =>
    env.db
      .select()
      .from(s.oplog)
      .where(and(eq(s.oplog.entity, "used_purchase"), eq(s.oplog.action, "gate_rejected")))
      .all();

  beforeEach(() => login({ id: cashier.id, name: "Ana", role: "cashier" }));

  it("records a device the shop has already seen, with the actor", async () => {
    await check(IN_UNIT);
    const entries = gateEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.entityId).toBe(IN_UNIT);
    expect(entries[0]!.userId).toBe(cashier.id);
  });

  it("says nothing about a typo", async () => {
    // a mistyped IMEI is a typo, and logging every keystroke-triggered check
    // would bury the one entry that matters
    await check("352094118803181");
    await check(FRESH);
    expect(gateEntries()).toHaveLength(0);
  });
});
