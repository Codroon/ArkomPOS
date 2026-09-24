/**
 * `pg-store.ts` against a real Postgres — the file no unit test can reach.
 *
 * Everything above this layer is pure and tested with an in-memory store, which
 * is the right way round: the RULES do not need a database. What does need one
 * is the half that only means something in SQL — a conditional UPDATE that
 * spends a code exactly once, ON CONFLICT DO NOTHING that stores a row exactly
 * once, a cascade that takes a shop's rows with it, and transactions that have
 * to work through a connection pooler in transaction mode.
 *
 * It runs against `DATABASE_URL` — the **transaction pooler**, deliberately,
 * because that is what a deployed route uses and it is the configuration most
 * likely to surprise us. Not the direct connection, which would prove the
 * easier thing.
 *
 * It creates two throwaway accounts, uses them, and deletes them. Accounts
 * cascade, so what it leaves behind is nothing. Run it with:
 *
 *     pnpm --filter @arkom/web test:db
 *
 * It is excluded from the ordinary suite: unit tests stay hermetic and fast,
 * and nobody's `pnpm test` should depend on somebody else's network.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7, type SyncOp } from "@arkom/core";
import { digest, newEnrolCode, ENROL_CODE_TTL_MS } from "../../lib/secrets";
import { pgStore } from "../pg-store";
import { accounts, devices, enrolCodes, syncEntries, tenants } from "../schema";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI, or a machine that exports the credentials itself */
}

const ready = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

/** Setup and teardown go direct; the store under test goes through the pooler. */
let admin: ReturnType<typeof drizzle>;
let client: ReturnType<typeof postgres>;

const store = pgStore();

/** Distinctive and disposable, so a failed run is obvious in the table editor. */
const stamp = Date.now();
const ACCOUNT_A = uuidv7();
const ACCOUNT_B = uuidv7();
const TENANT = uuidv7();
const TERMINAL = uuidv7();
const LOCATION = uuidv7();
let codeA = "";
let codeB = "";
let deviceToken = "";

const enrolInput = (code: string) => ({
  code,
  tenantId: TENANT,
  locationId: LOCATION,
  terminalId: TERMINAL,
  terminalName: "Caja de verificación",
  shopName: "Tienda de verificación",
  appVersion: "1.2.0",
  now: new Date(),
});

function op(over: Partial<SyncOp> = {}): SyncOp {
  return {
    seq: 1,
    opId: uuidv7(),
    tenantId: TENANT,
    locationId: LOCATION,
    terminalId: TERMINAL,
    entity: "document",
    entityId: uuidv7(),
    action: "complete",
    before: null,
    after: { docNumber: "T1-000001", totalCents: 12_500, customerName: "Verificación" },
    userId: "u1",
    authorizedByUserId: null,
    createdAtMs: Date.now(),
    ...over,
  };
}

async function issueCode(accountId: string): Promise<string> {
  const code = newEnrolCode();
  await admin.insert(enrolCodes).values({
    id: uuidv7(),
    accountId,
    codeHash: digest(code),
    label: `verify ${stamp}`,
    expiresAt: new Date(Date.now() + ENROL_CODE_TTL_MS),
  });
  return code;
}

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);
  await admin.insert(accounts).values([
    { id: ACCOUNT_A, name: "Verificación A", email: `verify.a.${stamp}@codroon.invalid` },
    { id: ACCOUNT_B, name: "Verificación B", email: `verify.b.${stamp}@codroon.invalid` },
  ]);
  codeA = await issueCode(ACCOUNT_A);
  codeB = await issueCode(ACCOUNT_B);
}, 60_000);

afterAll(async () => {
  if (!ready) return;
  /* accounts cascade to tenants, devices, codes and entries, so this is the
     whole cleanup — and it is the same cascade ADR-0020 §4 relies on */
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT_A));
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT_B));
  await client.end();
}, 60_000);

describe.skipIf(!ready)("the schema that actually landed", () => {
  it("has the five tables, and sync_entries is keyed by (tenant, op_id)", async () => {
    const tables = await client<Array<{ table_name: string }>>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const names = tables.map((t) => t.table_name);
    for (const expected of ["accounts", "tenants", "devices", "enrol_codes", "sync_entries"]) {
      expect(names).toContain(expected);
    }

    const pk = await client<Array<{ column_name: string }>>`
      select a.attname as column_name
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conrelid = 'sync_entries'::regclass and c.contype = 'p'
    `;
    expect(pk.map((r) => r.column_name).sort()).toEqual(["op_id", "tenant_id"]);
  });

  it("has no column anywhere for a passcode or a photograph", async () => {
    /* ADR-0020 §3 as a property of the database, not of a code path: what has
       no column cannot be stored by a handler somebody writes next year */
    const cols = await client<Array<{ column_name: string }>>`
      select column_name from information_schema.columns where table_schema = 'public'
    `;
    const names = cols.map((c) => c.column_name.toLowerCase());
    for (const forbidden of ["passcode", "device_passcode", "photo", "photo_path", "pin_hash"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe.skipIf(!ready)("enrolling a till, for real", () => {
  it("spends the code and hands back a token", async () => {
    const outcome = await store.enrol(enrolInput(codeA));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.accountName).toBe("Verificación A");
    expect(outcome.shopName).toBe("Tienda de verificación");
    deviceToken = outcome.deviceToken;

    const [row] = await admin.select().from(tenants).where(eq(tenants.id, TENANT));
    expect(row?.accountId).toBe(ACCOUNT_A);
  });

  it("stored a digest of the token and not the token", async () => {
    const [row] = await admin.select().from(devices).where(eq(devices.tenantId, TENANT));
    expect(row?.tokenHash).toBe(digest(deviceToken));
    expect(JSON.stringify(row)).not.toContain(deviceToken);
  });

  it("recognises that token through the pooler", async () => {
    const device = await store.deviceByToken(deviceToken);
    expect(device).toMatchObject({ tenantId: TENANT, terminalId: TERMINAL, revokedAt: null });
  });

  it("refuses the same code a second time", async () => {
    const again = await store.enrol(enrolInput(codeA));
    expect(again).toEqual({ ok: false, reason: "code" });
  });

  it("refuses another account's code for this shop, and does NOT spend it", async () => {
    const stolen = await store.enrol(enrolInput(codeB));
    expect(stolen).toEqual({ ok: false, reason: "tenant" });

    const [row] = await admin.select().from(enrolCodes).where(eq(enrolCodes.codeHash, digest(codeB)));
    expect(row?.usedAt).toBeNull();

    // and the shop is still where it was
    const [shop] = await admin.select().from(tenants).where(eq(tenants.id, TENANT));
    expect(shop?.accountId).toBe(ACCOUNT_A);
  });
});

describe.skipIf(!ready)("pushing a batch, for real", () => {
  const batch = [op({ seq: 1 }), op({ seq: 2 }), op({ seq: 3 })];

  it("stores it in one transaction through the pooler and acks the top seq", async () => {
    /* the configuration most likely to surprise: an interactive transaction
       across a pgbouncer connection in transaction mode, with prepared
       statements turned off */
    const device = (await store.deviceByToken(deviceToken))!;
    const result = await store.recordBatch({ device, ops: batch, appVersion: "1.2.0", now: new Date() });

    expect(result).toEqual({ stored: 3, duplicates: 0, ackedSeq: 3 });

    const rows = await admin.select().from(syncEntries).where(eq(syncEntries.tenantId, TENANT));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.deviceId === device.id)).toBe(true);
  });

  it("counts a replay as duplicates and stores nothing twice", async () => {
    const device = (await store.deviceByToken(deviceToken))!;
    const result = await store.recordBatch({ device, ops: batch, appVersion: "1.2.0", now: new Date() });

    expect(result).toEqual({ stored: 0, duplicates: 3, ackedSeq: 3 });
    const rows = await admin.select().from(syncEntries).where(eq(syncEntries.tenantId, TENANT));
    expect(rows).toHaveLength(3);
  });

  it("moved the cloud's own cursor, which the dashboard reads", async () => {
    const [row] = await admin.select().from(devices).where(eq(devices.tenantId, TENANT));
    expect(row?.lastAckedSeq).toBe(3);
    expect(row?.lastPushAt).not.toBeNull();
  });

  it("keeps jsonb payloads readable, not stringified", async () => {
    const rows = await admin.select().from(syncEntries).where(eq(syncEntries.tenantId, TENANT));
    const after = rows[0]?.after as { docNumber?: string } | null;
    expect(after?.docNumber).toBe("T1-000001");
  });
});

describe.skipIf(!ready)("deleting the shop, for real", () => {
  it("takes its rows and its tills with it in one statement", async () => {
    const removed = await store.deleteTenant(TENANT);

    expect(removed).toEqual({ entries: 3, devices: 1 });
    expect(await admin.select().from(syncEntries).where(eq(syncEntries.tenantId, TENANT))).toHaveLength(0);
    expect(await admin.select().from(devices).where(eq(devices.tenantId, TENANT))).toHaveLength(0);
    expect(await admin.select().from(tenants).where(eq(tenants.id, TENANT))).toHaveLength(0);
  });

  it("leaves the token dead, so a deleted shop's till cannot push", async () => {
    expect(await store.deviceByToken(deviceToken)).toBeNull();
  });

  it("leaves no pointer to a till that no longer exists", async () => {
    const [row] = await admin.select().from(enrolCodes).where(eq(enrolCodes.codeHash, digest(codeA)));
    expect(row?.usedByDeviceId ?? null).toBeNull();
  });
});
