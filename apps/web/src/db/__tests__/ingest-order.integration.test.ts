/**
 * One shop's pushes commit in `ingest_seq` order — ADR-0024 §4, against a real
 * Postgres through the transaction pooler the deployed routes use.
 *
 * Why it matters: the pull used to wait five seconds before serving a row,
 * because `ingest_seq` is taken at INSERT and visible at COMMIT, so two
 * concurrent pushes could commit out of order and a pull in between would move
 * its cursor past the lower row for ever — a sale missing from one till. The
 * per-shop lock in `recordBatch` removes the race instead of waiting it out.
 * This proves the lock holds: a second push for the same shop WAITS for the
 * first to commit, takes the higher number, and a pull taken while the first
 * is open serves neither, so nothing is ever behind the cursor. A different
 * shop is not held up at all.
 *
 * Throwaway accounts, deleted at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { SHARED_ENTITIES, uuidv7, type SyncOp } from "@arkom/core";
import { pgStore } from "../pg-store";
import { accounts, devices, syncEntries, tenants } from "../schema";
import type { DeviceRow } from "../../sync/store";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI */
}

const ready = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);
let admin: ReturnType<typeof drizzle>;
let direct: ReturnType<typeof postgres>;
const store = pgStore();

const stamp = Date.now();
const ACCOUNT = uuidv7();
const SHOP = uuidv7();
const OTHER_ACCOUNT = uuidv7();
const OTHER_SHOP = uuidv7();
const [TILL_A, TILL_B, TILL_C] = [uuidv7(), uuidv7(), uuidv7()];

const device = (id: string, tenantId: string, accountId: string): DeviceRow => ({
  id,
  accountId,
  tenantId,
  locationId: "loc",
  terminalId: id,
  revokedAt: null,
  lastAckedSeq: 0,
});

const op = (tenantId: string, terminalId: string, seq: number): SyncOp => ({
  seq,
  opId: uuidv7(),
  tenantId,
  locationId: "loc",
  terminalId,
  entity: "product",
  entityId: uuidv7(),
  action: "create",
  before: null,
  after: { name: `Producto ${seq}` },
  userId: null,
  authorizedByUserId: null,
  createdAtMs: Date.now(),
});

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!ready) return;
  direct = postgres(process.env.DIRECT_URL!, { prepare: false, max: 2 });
  admin = drizzle(direct);
  await admin.insert(accounts).values([
    { id: ACCOUNT, name: "Order test", email: `order.${ACCOUNT}.${stamp}@codroon.invalid` },
    { id: OTHER_ACCOUNT, name: "Order test other", email: `order.${OTHER_ACCOUNT}.${stamp}@codroon.invalid` },
  ]);
  await admin.insert(tenants).values([
    { id: SHOP, accountId: ACCOUNT, name: "Tienda" },
    { id: OTHER_SHOP, accountId: OTHER_ACCOUNT, name: "Otra tienda" },
  ]);
  const rows = [
    [TILL_A, SHOP, ACCOUNT, "Caja 1"],
    [TILL_B, SHOP, ACCOUNT, "Caja 2"],
    [TILL_C, OTHER_SHOP, OTHER_ACCOUNT, "Caja 1"],
  ] as const;
  for (const [id, tenantId, accountId, name] of rows) {
    await admin.insert(devices).values({
      id, accountId, tenantId, locationId: "loc", terminalId: id, terminalName: name,
      tokenHash: `order-${id}-${stamp}`, appVersion: "1.4.0",
    });
  }
});

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await admin.delete(accounts).where(eq(accounts.id, OTHER_ACCOUNT));
  await direct.end();
});

describe.runIf(ready)("one shop's pushes, one at a time", () => {
  it("a second push waits for the first to commit, takes the higher number, and nothing is skipped", async () => {
    /* push A, held open mid-transaction exactly where recordBatch holds its lock */
    const held = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
    let releaseA!: () => void;
    const aGo = new Promise<void>((r) => (releaseA = r));
    let aSeq = 0;
    const pushA = held.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${SHOP}, 0))`;
      const [row] = await tx<{ ingest_seq: string }[]>`
        insert into sync_entries (tenant_id, op_id, device_id, seq, location_id, terminal_id, entity, entity_id, action, after, created_at, received_at)
        values (${SHOP}, ${uuidv7()}, ${TILL_A}, 1, 'loc', ${TILL_A}, 'product', ${uuidv7()}, 'create', ${held.json({ name: "A" })}, now(), now())
        returning ingest_seq`;
      aSeq = Number(row!.ingest_seq);
      await aGo;
    });
    await settle(300);

    /* push B for the same shop: must block on the lock */
    let bDone = false;
    const pushB = store
      .recordBatch({ device: device(TILL_B, SHOP, ACCOUNT), ops: [op(SHOP, TILL_B, 1)], appVersion: "1.4.0", now: new Date() })
      .then((r) => ((bDone = true), r));

    /* a different shop is NOT held up by it */
    const other = await store.recordBatch({
      device: device(TILL_C, OTHER_SHOP, OTHER_ACCOUNT),
      ops: [op(OTHER_SHOP, TILL_C, 1)],
      appVersion: "1.4.0",
      now: new Date(),
    });
    expect(other.stored).toBe(1);

    await settle(700);
    expect(bDone).toBe(false);

    /* a pull while A is open sees neither A (uncommitted) nor B (waiting) */
    const during = await store.pullBatch({
      device: device(TILL_C, SHOP, ACCOUNT), // a third till of the shop, so A and B are both "somebody else's"
      afterIngestSeq: 0,
      limit: 100,
      entities: SHARED_ENTITIES,
      settleBefore: null,
    });
    expect(during.entries).toHaveLength(0);
    expect(during.cursor).toBe(0);

    releaseA();
    await pushA;
    await pushB;
    await held.end();

    const rows = await admin
      .select({ deviceId: syncEntries.deviceId, ingestSeq: syncEntries.ingestSeq })
      .from(syncEntries)
      .where(eq(syncEntries.tenantId, SHOP))
      .orderBy(syncEntries.ingestSeq);
    expect(rows.map((r) => r.deviceId)).toEqual([TILL_A, TILL_B]);
    expect(Number(rows[1]!.ingestSeq)).toBeGreaterThan(aSeq);

    /* and the pull after both serves both, in order, with nothing behind the cursor */
    const after = await store.pullBatch({
      device: device(TILL_C, SHOP, ACCOUNT),
      afterIngestSeq: during.cursor,
      limit: 100,
      entities: SHARED_ENTITIES,
      settleBefore: null,
    });
    expect(after.entries.map((e) => e.terminalId)).toEqual([TILL_A, TILL_B]);
  }, 30_000);

  it("names the shop's tills and people for its other tills, from Postgres", async () => {
    await store.recordBatch({
      device: device(TILL_A, SHOP, ACCOUNT),
      ops: [
        { ...op(SHOP, TILL_A, 10), entity: "user", entityId: "u-rosa", after: { name: "Rosa", role: "technician" } },
        { ...op(SHOP, TILL_A, 11), entity: "user", entityId: "u-rosa", action: "update", after: { active: false } },
      ],
      appVersion: "1.4.0",
      now: new Date(),
      terminalName: "Mostrador",
    });
    const directory = await store.directory(SHOP);
    expect(directory.staff).toEqual([{ userId: "u-rosa", name: "Rosa" }]);
    expect(directory.tills).toContainEqual({ terminalId: TILL_A, name: "Mostrador" });
    expect(directory.tills).toContainEqual({ terminalId: TILL_B, name: "Caja 2" });
    expect(directory.tills.map((t) => t.terminalId)).not.toContain(TILL_C);
  });
});
