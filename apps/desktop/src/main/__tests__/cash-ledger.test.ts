/**
 * The cash ledger: who writes a used-device payout, and the backfill that covers
 * the ones written before anybody did.
 *
 * Since v0.13.0 the purchase writes its own payout row inside its own
 * transaction (ADR-0015 §6). It used to be written by the startup fix-up, which
 * was right while the ledger was younger than the purchases — but a row that
 * appears only after the next restart makes the open shift's expected cash wrong
 * all day, and then lands inside a shift that has already frozen its Z.
 *
 * So the fix-up is now HISTORY ONLY, and the property that matters most is that
 * the two cannot both write: exactly one row per cash purchase, however many
 * times the app restarts.
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
import { openShiftTx } from "../repos/shift";

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
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
});

const payouts = () =>
  env.db.select().from(s.cashMovements).where(eq(s.cashMovements.reason, "used_purchase_payout")).all();

describe("logging a purchase", () => {
  it("writes the payout in the purchase's own transaction", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));

    // no restart, no fix-up: the money left the drawer now, so the row exists now
    const rows = payouts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(-8000); // OUT of the drawer
    expect(rows[0]!.userId).toBe(owner.id);
  });

  it("writes nothing for a payout that never touched the drawer", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!, { payout: "store_credit" }));
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[3]!, { payout: "transfer", payoutReference: "ES91" }));
    expect(payouts()).toHaveLength(0);
  });

  it("is still exactly one row after a restart runs the fix-up", async () => {
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    const afterPurchase = payouts().map((m) => m.id);
    expect(afterPurchase).toHaveLength(1);

    // the fix-up runs at every startup and must not see this as missing
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts().map((m) => m.id)).toEqual(afterPurchase);

    // and again, because a till gets restarted more than once
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts()).toHaveLength(1);
  });
});

/**
 * A purchase from before v0.13.0: the row exists, its payout row never did.
 * Deleting the movement is the only honest way to reproduce that state.
 */
async function historicPurchase(imei: string, over: Partial<UsedLogRequest> = {}) {
  const result = await logPurchase(env.db, ctxOf(), purchase(imei, over));
  env.db.delete(s.cashMovements).where(eq(s.cashMovements.reason, "used_purchase_payout")).run();
  return result;
}

describe("the payout backfill, for history only", () => {
  it("writes one row per cash purchase, and none for the others", async () => {
    await historicPurchase(IMEIS[0]!);
    await historicPurchase(IMEIS[1]!, { payout: "store_credit" });
    await historicPurchase(IMEIS[2]!, { buyPriceCents: 6000 });
    await historicPurchase(IMEIS[3]!, { payout: "transfer", payoutReference: "ES91" });

    const report = runDataFixups(env.db, uuidv7);
    expect(report.payoutsBackfilled).toBe(2); // the two cash ones
    expect(payouts()).toHaveLength(2);
  });

  it("reconciles exactly against the purchase documents", async () => {
    await historicPurchase(IMEIS[0]!, { buyPriceCents: 8000 });
    await historicPurchase(IMEIS[2]!, { buyPriceCents: 6000 });
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
    await historicPurchase(IMEIS[0]!);
    runDataFixups(env.db, uuidv7);
    expect(payouts()[0]!.userId).toBe(owner.id);
  });

  it("changes nothing on a second run", async () => {
    await historicPurchase(IMEIS[0]!);
    await historicPurchase(IMEIS[2]!);

    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(2);
    const after = payouts().map((m) => m.id).sort();

    // it runs at every startup; the second one must be a no-op
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts().map((m) => m.id).sort()).toEqual(after);
  });

  it("leaves a row the purchase already wrote completely alone", async () => {
    await historicPurchase(IMEIS[0]!); // old: needs backfilling
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[2]!)); // new: already has its row
    const newRow = payouts()[0]!;

    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(1); // only the old one
    expect(payouts()).toHaveLength(2);
    // byte-for-byte the row the purchase wrote, not a replacement
    expect(payouts().find((m) => m.id === newRow.id)).toEqual(newRow);
  });

  it("does nothing at all on a shop that has never bought a phone", () => {
    expect(runDataFixups(env.db, uuidv7).payoutsBackfilled).toBe(0);
    expect(payouts()).toHaveLength(0);
  });

  it("gives its rows time-ordered ids, like every other business row", async () => {
    await historicPurchase(IMEIS[0]!);
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
