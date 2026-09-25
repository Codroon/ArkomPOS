/**
 * Rebuilding a row from the ops that made it — the bug this file exists for.
 *
 * The till does not push rows, it pushes CHANGES. `repair_ticket/status` is
 * literally `{ status: "quoted" }`: no id, no device, no fault. Identity lives
 * in the oplog's `entity_id` COLUMN, which is where the till put it (ADR-0005),
 * and the payload is free to be partial because the column already says which
 * row it is about.
 *
 * Every cloud query used to key on `after->>'id'`. That reads correctly for a
 * `create` and catastrophically for an update: every id-less payload collapses
 * into ONE group under a NULL key, so a shop with 20 used devices displayed 1
 * and 68 repairs came back with the wrong status counts. It agreed with the till
 * on money — documents are always pushed whole — which is exactly why it went
 * unnoticed until a figure nobody had summed by hand was compared against the
 * till's own SQLite.
 *
 * So: fold per FIELD, last writer wins, grouped by the row's real identity.
 * The cases below are the ones where a plausible implementation gets it wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import { folded } from "../fold";
import { repairsForAccount, usedForAccount } from "../workshop-queries";

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
const DEVICE = uuidv7();
const OTHER_ACCOUNT = uuidv7();
const OTHER_TENANT = uuidv7();
const OTHER_DEVICE = uuidv7();
const stamp = Date.now();
const NOW = Date.now();

/** two tickets, so an id-less update has somewhere wrong to land */
const TICKET_A = uuidv7();
const TICKET_B = uuidv7();
const PURCHASE_A = uuidv7();
const PURCHASE_B = uuidv7();

let seq = 0;

/**
 * An op as the till queues it. `entityId` is passed EXPLICITLY and the payload
 * may say nothing about which row it is — that separation is the whole point.
 */
const entry = (
  entity: string,
  action: string,
  entityId: string,
  after: Record<string, unknown> | null,
  tenant = TENANT,
  device = DEVICE,
) => ({
  tenantId: tenant,
  opId: uuidv7(),
  deviceId: device,
  seq: (seq += 1),
  locationId: "loc",
  terminalId: "term",
  entity,
  entityId,
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

  for (const [account, tenant, device, name] of [
    [ACCOUNT, TENANT, DEVICE, "Fold test"],
    [OTHER_ACCOUNT, OTHER_TENANT, OTHER_DEVICE, "Someone else"],
  ] as const) {
    await admin.insert(accounts).values({
      id: account, name, email: `fold.${account}.${stamp}@codroon.invalid`,
    });
    await admin.insert(tenants).values({ id: tenant, accountId: account, name: "Tienda" });
    await admin.insert(devices).values({
      id: device, accountId: account, tenantId: tenant, locationId: "loc", terminalId: "term",
      terminalName: "Caja", tokenHash: `fold-${device}-${stamp}`, appVersion: "1.3.0",
    });
  }

  await admin.insert(syncEntries).values([
    /* --- ticket A: created whole, then two PARTIAL updates ------------- */
    entry("repair_ticket", "create", TICKET_A, {
      id: TICKET_A, deviceDescription: "iPhone 13 negro", imei: "353474049489560",
      reportedFault: "No carga", status: "received", depositCents: 2000,
      promisedDate: "2026-10-02", createdAt: NOW - 3 * 3600_000,
    }),
    // the shape the till really sends: no id, no device, nothing else
    entry("repair_ticket", "status", TICKET_A, { status: "quoted" }),
    // a second partial op must not undo the first
    entry("repair_ticket", "update", TICKET_A, { promisedDate: "2026-10-09" }),

    /* --- ticket B: never updated, and must not absorb A's ops ---------- */
    entry("repair_ticket", "create", TICKET_B, {
      id: TICKET_B, deviceDescription: "Samsung A52", status: "received",
      depositCents: 0, createdAt: NOW - 2 * 3600_000,
    }),

    /* --- two used purchases, both with id-less follow-ups -------------- */
    entry("used_purchase", "create", PURCHASE_A, {
      id: PURCHASE_A, brand: "Apple", model: "iPhone 12", storage: "128GB", color: "Azul",
      grade: "B", buyPriceCents: 18000, refurbCostCents: 0, needsReview: true,
      sellerName: "Imran Ali", purchasedAt: NOW - 86_400_000,
    }),
    entry("used_purchase", "review", PURCHASE_A, { needsReview: false }),
    entry("used_purchase", "create", PURCHASE_B, {
      id: PURCHASE_B, brand: "Xiaomi", model: "Redmi Note 11", storage: "64GB", color: "Gris",
      grade: "C", buyPriceCents: 7000, refurbCostCents: 0, needsReview: true,
      sellerName: "Sara Gómez", purchasedAt: NOW - 43_200_000,
    }),
    entry("used_purchase", "cost", PURCHASE_B, { refurbCostCents: 2500 }),

    /* --- the shape that took the repairs screen down ------------------- */
    entry("repair_ticket", "ready", TICKET_B, { readyAt: "2026-09-24T23:08:42.180Z" }),

    /* --- a field CLEARED by a later op, which is not the same as absent  */
    entry("customer", "create", TICKET_A, { id: TICKET_A, name: "Marta Ruiz", email: "m@x.es" }),
    entry("customer", "update", TICKET_A, { email: null }),

    /* --- another account's ticket, which must never appear ------------- */
    entry("repair_ticket", "create", uuidv7(), {
      deviceDescription: "NO DEBE APARECER", status: "received", createdAt: NOW,
    }, OTHER_TENANT, OTHER_DEVICE),
  ]);
});

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await admin.delete(accounts).where(eq(accounts.id, OTHER_ACCOUNT));
  await client.end();
});

const rowsOf = async (entity: string, account = ACCOUNT) =>
  admin.execute<{ id: string; row: Record<string, unknown> }>(
    sql`select id, row from (${folded(account, entity)}) f order by id`,
  );

describe.runIf(ready)("folding a row out of its ops", () => {
  it("applies a payload that carries no id, using entity_id", async () => {
    const tickets = await rowsOf("repair_ticket");
    const a = tickets.find((t) => t.id === TICKET_A);
    expect(a?.row.status).toBe("quoted");
  });

  it("keeps the fields a later partial payload did not mention", async () => {
    const tickets = await rowsOf("repair_ticket");
    const a = tickets.find((t) => t.id === TICKET_A);
    // the status op said only { status }; everything else must survive it
    expect(a?.row.deviceDescription).toBe("iPhone 13 negro");
    expect(a?.row.imei).toBe("353474049489560");
    expect(a?.row.depositCents).toBe(2000);
    // and the newer of two partial ops wins on its own field
    expect(a?.row.promisedDate).toBe("2026-10-09");
  });

  it("does not collapse id-less payloads onto one row", async () => {
    const tickets = await rowsOf("repair_ticket");
    expect(tickets).toHaveLength(2);
    const b = tickets.find((t) => t.id === TICKET_B);
    expect(b?.row.status).toBe("received");
    expect(b?.row.deviceDescription).toBe("Samsung A52");
  });

  it("reads an explicit null as null, not as absent", async () => {
    const customers = await rowsOf("customer");
    const c = customers.find((r) => r.id === TICKET_A);
    expect(c?.row.name).toBe("Marta Ruiz");
    expect(c?.row.email).toBeNull();
  });

  it("stays inside the account", async () => {
    const mine = await rowsOf("repair_ticket");
    expect(JSON.stringify(mine)).not.toContain("NO DEBE APARECER");
    const theirs = await rowsOf("repair_ticket", OTHER_ACCOUNT);
    expect(theirs).toHaveLength(1);
  });
});

describe.runIf(ready)("the screens that read through it", () => {
  it("shows a repair at the status its latest op gave it", async () => {
    const repairs = await repairsForAccount(ACCOUNT);
    expect(repairs).toHaveLength(2);
    const byId = new Map(repairs.map((r) => [r.id, r]));
    expect(byId.get(TICKET_A)?.status).toBe("quoted");
    expect(byId.get(TICKET_A)?.device).toBe("iPhone 13 negro");
    expect(byId.get(TICKET_B)?.status).toBe("received");
  });

  it("counts every used device, not one per NULL id", async () => {
    const used = await usedForAccount(ACCOUNT);
    expect(used).toHaveLength(2);
    const byId = new Map(used.map((u) => [u.id, u]));
    // the review op cleared the flag without resending the device
    expect(byId.get(PURCHASE_A)?.needsReview).toBe(false);
    expect(byId.get(PURCHASE_A)?.device).toBe("Apple iPhone 12 128GB Azul");
    // and the cost op raised the refurb figure without resending the price
    expect(byId.get(PURCHASE_B)?.refurbCostCents).toBe(2500);
    expect(byId.get(PURCHASE_B)?.buyPriceCents).toBe(7000);
  });
});

/**
 * Two writers on the till sent `readyAt` as an ISO string while every other date
 * in the stream is epoch millis. The till is fixed, but seventeen rows had
 * already gone up and an oplog cannot be rewritten, so the reader has to cope
 * with both — and `(row->>'readyAt')::bigint` on an ISO string is not a wrong
 * figure, it is a 500 where the repairs list should be.
 */
describe.runIf(ready)("a date the till spelled differently", () => {
  it("folds an ISO string into millis, so the cast downstream still works", async () => {
    const tickets = await rowsOf("repair_ticket");
    const b = tickets.find((t) => t.id === TICKET_B);
    expect(typeof b?.row.readyAt).toBe("number");
    expect(b?.row.readyAt).toBe(Date.parse("2026-09-24T23:08:42.180Z"));
  });

  it("leaves a plain date alone, because promisedDate is a day and not an instant", async () => {
    const tickets = await rowsOf("repair_ticket");
    const a = tickets.find((t) => t.id === TICKET_A);
    expect(a?.row.promisedDate).toBe("2026-10-09");
  });

  it("lets the repairs screen render the ticket it used to choke on", async () => {
    const repairs = await repairsForAccount(ACCOUNT);
    const b = repairs.find((r) => r.id === TICKET_B);
    expect(b?.readyAt?.toISOString()).toBe("2026-09-24T23:08:42.180Z");
  });
});
