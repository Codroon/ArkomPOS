/**
 * Store credit on the dashboard is the redemption ledger, not a stored number.
 *
 * Since v1.3.0 each till recomputes a voucher's balance from its redemptions
 * (ADR-0023 §4) and pushes the result as a cache. The dashboard used to read
 * that cache, which after two tills spend one voucher is whichever till pushed
 * LAST — one till's view, not the balance. These cases push exactly that: a
 * stale cached figure beside redemptions from two tills.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import { outstandingCredit } from "../report-queries";

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
const SPLIT = uuidv7(); /* spent in part at both tills */
const DOUBLE = uuidv7(); /* spent in full at both tills inside the sync window */
const UNTOUCHED = uuidv7(); /* issued before the ledger existed, never spent */
const VOIDED = uuidv7();
const stamp = Date.now();
const t = Date.now() - 3_600_000;
const seqOf: Record<string, number> = {};

const op = (device: string, entity: string, entityId: string, after: Record<string, unknown>, atMs: number) => ({
  tenantId: TENANT,
  opId: uuidv7(),
  deviceId: device,
  seq: (seqOf[device] = (seqOf[device] ?? 0) + 1),
  locationId: "loc",
  terminalId: device,
  entity,
  entityId,
  action: entity === "voucher_redemption" ? "create" : "update",
  before: null,
  after,
  userId: null,
  authorizedByUserId: null,
  createdAt: new Date(atMs),
});

const voucher = (id: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, amountCents, remainingCents: amountCents, status: "issued", createdAt: t, ...extra,
});
const spend = (device: string, voucherId: string, amountCents: number, atMs: number) =>
  op(device, "voucher_redemption", uuidv7(), { voucherId, documentId: uuidv7(), amountCents, terminalId: device, createdAt: atMs }, atMs);

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);
  await admin.insert(accounts).values({ id: ACCOUNT, name: "Credit test", email: `credit.${ACCOUNT}.${stamp}@codroon.invalid` });
  await admin.insert(tenants).values({ id: TENANT, accountId: ACCOUNT, name: "Tienda" });
  for (const id of [TILL_A, TILL_B]) {
    await admin.insert(devices).values({
      id, accountId: ACCOUNT, tenantId: TENANT, locationId: "loc", terminalId: id,
      terminalName: id, tokenHash: `credit-${id}-${stamp}`, appVersion: "1.3.1",
    });
  }
  await admin.insert(syncEntries).values([
    op(TILL_A, "store_credit_voucher", SPLIT, voucher(SPLIT, 5000), t),
    spend(TILL_A, SPLIT, 2000, t + 1_000),
    op(TILL_A, "store_credit_voucher", SPLIT, { remainingCents: 3000 }, t + 1_000),
    spend(TILL_B, SPLIT, 2000, t + 2_000),
    /* till B had not yet heard of A's redemption: its cache says 3000 too,
       and it pushed last. The truth is 1000. */
    op(TILL_B, "store_credit_voucher", SPLIT, { remainingCents: 3000 }, t + 2_000),

    op(TILL_A, "store_credit_voucher", DOUBLE, voucher(DOUBLE, 5000), t),
    spend(TILL_A, DOUBLE, 4000, t + 1_000),
    spend(TILL_B, DOUBLE, 4000, t + 1_500),
    op(TILL_B, "store_credit_voucher", DOUBLE, { remainingCents: 1000 }, t + 1_500),

    op(TILL_A, "store_credit_voucher", UNTOUCHED, voucher(UNTOUCHED, 2500), t),
    op(TILL_A, "store_credit_voucher", VOIDED, voucher(VOIDED, 1800, { voidReason: "error de caja" }), t),
  ]);
});

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await client.end();
});

describe.runIf(ready)("store credit on the dashboard", () => {
  it("is face value minus every redemption, whichever till pushed last", async () => {
    const shown = await outstandingCredit(ACCOUNT);
    expect(shown.find((v) => v.id === SPLIT)?.remainingCents).toBe(1000);
  });

  it("drops a voucher spent twice over, instead of showing one till's leftover", async () => {
    const shown = await outstandingCredit(ACCOUNT);
    expect(shown.map((v) => v.id)).not.toContain(DOUBLE);
  });

  it("keeps a voucher with no redemptions at its stored figure", async () => {
    const shown = await outstandingCredit(ACCOUNT);
    expect(shown.find((v) => v.id === UNTOUCHED)?.remainingCents).toBe(2500);
  });

  it("does not offer a cancelled voucher as credit", async () => {
    const shown = await outstandingCredit(ACCOUNT);
    expect(shown.map((v) => v.id)).not.toContain(VOIDED);
  });
});
