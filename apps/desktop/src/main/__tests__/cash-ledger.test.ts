/**
 * The cash ledger, and the payout backfill that fills its history.
 *
 * `cash_movements` arrives with the repairs slice, but the shop has been paying
 * cash for used phones since v0.11.0 — that money left the drawer, and a ledger
 * that started empty would be wrong about it from its first day. The backfill is
 * a join, not a reconstruction: the amount, the method, the time, the till and
 * the actor are all already on the purchase.
 *
 * What this file guards is that the join is EXACT — one row per cash purchase,
 * none for any other kind, the right sign, and nothing added by running it twice.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runDataFixups, runMigrations, schema as s } from "@arkom/db";
import { imeiWithCheckDigit, uuidv7, type UsedLogRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { logPurchase } from "../repos/used";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const IMEIS = [
  imeiWithCheckDigit("35209411880318"),
  imeiWithCheckDigit("86123456789012"),
  imeiWithCheckDigit("49015420323751"),
  imeiWithCheckDigit("35528711000000"),
];

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-cash-"));
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
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

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
});

const payouts = () =>
  env.db.select().from(s.cashMovements).where(eq(s.cashMovements.reason, "used_purchase_payout")).all();

describe("the payout backfill", () => {
  it("writes one row per cash purchase, and none for the others", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!, { payout: "store_credit" }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[2]!, { buyPriceCents: 6000 }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[3]!, { payout: "transfer", payoutReference: "ES91" }));

    const report = runDataFixups(env.db, uuidv7);
    expect(report.payoutsBackfilled).toBe(2); // the two cash ones
    expect(payouts()).toHaveLength(2);
  });

  it("reconciles exactly against the purchase documents", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[2]!, { buyPriceCents: 6000 }));
    runDataFixups(env.db, uuidv7);

    const purchases = env.db
      .select()
      .from(s.usedPurchases)
      .where(eq(s.usedPurchases.payoutMethod, "cash"))
      .all();

    for (const p of purchases) {
      const row = payouts().find((m) => m.documentId === p.documentId);
      expect(row, `no payout row for ${p.id}`).toBeDefined();
      // money OUT: the shop handed it over, so the sign is negative
      expect(row!.amountCents).toBe(-p.buyPriceCents);
      expect(row!.createdAt.getTime()).toBe(p.purchasedAt.getTime());
      expect(row!.terminalId).toBe(p.terminalId);
    }

    const ledgerTotal = payouts().reduce((sum, m) => sum + m.amountCents, 0);
    const purchaseTotal = purchases.reduce((sum, p) => sum + p.buyPriceCents, 0);
    expect(ledgerTotal).toBe(-purchaseTotal);
  });

  it("names the actor who took the money", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    runDataFixups(env.db, uuidv7);
    expect(payouts()[0]!.userId).toBe(owner.id);
  });

  it("changes nothing on a second run", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[2]!));

    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(2);
    const after = payouts().map((m) => m.id).sort();

    // it runs at every startup; the second one must be a no-op
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts().map((m) => m.id).sort()).toEqual(after);
  });

  it("does nothing at all on a shop that has never bought a phone", () => {
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts()).toHaveLength(0);
  });

  it("gives its rows time-ordered ids, like every other business row", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    runDataFixups(env.db, uuidv7);
    // ADR-0006: UUIDv7, never a random id — SQL cannot mint one, which is why
    // the backfill lives in TypeScript rather than in the migration
    expect(payouts()[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the ledger's boundary", () => {
  it("holds nothing for a sale — those are document tenders", async () => {
    // ADR-0014 §7: copying sale cash here would create a second answer to
    // "what did we take today", and the two would disagree the first time a
    // copy was missed
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    runDataFixups(env.db, uuidv7);

    const reasons = new Set(env.db.select().from(s.cashMovements).all().map((m) => m.reason));
    expect([...reasons]).toEqual(["used_purchase_payout"]);
  });
});
