/**
 * The dashboard's arithmetic, against a real Postgres and known rows.
 *
 * These are money queries over a jsonb stream, which is exactly the kind of SQL
 * that returns a plausible number when it is wrong. So the fixture is built by
 * hand — two tickets, one refund, one abandoned draft, one closed shift — and
 * every total is asserted against a figure worked out on paper.
 *
 * Three traps are pinned deliberately, because each one produces a believable
 * wrong answer rather than an error:
 *
 *   · a refund arrives as `document/refund`, not `document/complete`
 *   · a draft that was never completed is not money
 *   · a document corrected by a later op must count once, at its latest figure
 *
 * Throwaway account, deleted afterwards; accounts cascade.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { accounts, devices, syncEntries, tenants } from "../schema";
import {
  dailyTakings,
  recentDocuments,
  recentShifts,
  tenderSplit,
  todayTotals,
} from "../dashboard-queries";

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

/** Today, a few hours ago — safely inside the same Madrid date as `now()`. */
const TODAY = Date.now() - 2 * 60 * 60 * 1000;
const EARLIER = TODAY - 40 * 60 * 1000;
const LAST_WEEK = Date.now() - 7 * 24 * 60 * 60 * 1000;

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

const TICKET_A = uuidv7();
const TICKET_B = uuidv7();
const REFUND = uuidv7();
const DRAFT = uuidv7();
const OLD_TICKET = uuidv7();

const doc = (id: string, over: Record<string, unknown>) => ({
  id,
  status: "completed",
  docType: "ticket",
  taxCents: 0,
  subtotalCents: 0,
  totalCents: 0,
  completedAt: TODAY,
  ...over,
});

beforeAll(async () => {
  if (!ready) return;
  client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  admin = drizzle(client);

  await admin.insert(accounts).values({
    id: ACCOUNT,
    name: "Panel test",
    email: `panel.${stamp}@codroon.invalid`,
  });
  await admin.insert(tenants).values({ id: TENANT, accountId: ACCOUNT, name: "Tienda de prueba" });
  await admin.insert(devices).values({
    id: DEVICE,
    accountId: ACCOUNT,
    tenantId: TENANT,
    locationId: "loc",
    terminalId: "term",
    terminalName: "Caja",
    tokenHash: `test-${stamp}`,
    appVersion: "1.2.0",
  });

  await admin.insert(syncEntries).values([
    // a ticket for 25,80 with 4,48 of IVA
    entry("document", "create", doc(TICKET_A, { status: "draft", completedAt: null })),
    entry("document", "complete", doc(TICKET_A, {
      docNumber: "T1-000001", totalCents: 2580, taxCents: 448, subtotalCents: 2132, completedAt: EARLIER,
    })),
    // a second ticket for 10,00, corrected AFTERWARDS to 12,00 — the later figure wins
    entry("document", "complete", doc(TICKET_B, { docNumber: "T1-000002", totalCents: 1000, taxCents: 174 })),
    entry("document", "update", doc(TICKET_B, { docNumber: "T1-000002", totalCents: 1200, taxCents: 208 })),
    // a refund of 12,90 — arrives as `refund`, not `complete`, and is negative
    entry("document", "refund", doc(REFUND, {
      docNumber: "D1-000001", docType: "refund", totalCents: -1290, taxCents: -224,
    })),
    // a draft nobody ever paid for: not money
    entry("document", "create", doc(DRAFT, { status: "draft", totalCents: 9999, completedAt: null })),
    // and one from last week, so "today" has to exclude it
    entry("document", "complete", doc(OLD_TICKET, {
      docNumber: "T1-000000", totalCents: 5000, taxCents: 868, completedAt: LAST_WEEK,
    })),
    // tenders: cash on ticket A, card on ticket B, and one on the draft
    entry("document_tender", "create", { id: uuidv7(), documentId: TICKET_A, method: "cash", amountCents: 2580 }),
    entry("document_tender", "create", { id: uuidv7(), documentId: TICKET_B, method: "card", amountCents: 1200 }),
    entry("document_tender", "create", { id: uuidv7(), documentId: DRAFT, method: "cash", amountCents: 9999 }),
    // a closed shift
    entry("shift", "close", {
      id: uuidv7(),
      zDocNumber: "Z1-000001",
      openedAt: EARLIER - 3600_000,
      closedAt: TODAY,
      openingFloatCents: 20000,
      countedCashCents: 22580,
      expectedCashCents: 22580,
      varianceCents: 0,
    }),
  ]);
}, 90_000);

afterAll(async () => {
  if (!ready) return;
  await admin.delete(accounts).where(eq(accounts.id, ACCOUNT));
  await client.end();
}, 60_000);

describe.skipIf(!ready)("today's takings", () => {
  it("counts completed documents only, refunds included as negatives", async () => {
    /* 25,80 + 12,00 − 12,90 = 24,90. The draft's 99,99 is not money, and last
       week's 50,00 is not today. */
    const totals = await todayTotals(ACCOUNT);

    expect(totals.netCents).toBe(2490);
    expect(totals.documents).toBe(3);
    expect(totals.refundCents).toBe(-1290);
    expect(totals.refunds).toBe(1);
  });
});

describe.skipIf(!ready)("the daily list", () => {
  it("puts today and last week on their own rows", async () => {
    const days = await dailyTakings(ACCOUNT, 10);

    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ netCents: 2490, documents: 3 });
    expect(days[1]).toMatchObject({ netCents: 5000, documents: 1 });
  });
});

describe.skipIf(!ready)("the document list", () => {
  it("shows each completed document once, at its latest figure", async () => {
    const docs = await recentDocuments(ACCOUNT, 20);

    const numbers = docs.map((d) => d.docNumber);
    expect(numbers).toContain("T1-000001");
    expect(numbers).toContain("D1-000001");
    expect(numbers).not.toContain(null); // the draft has no number and no place here
    expect(docs).toHaveLength(4);

    const corrected = docs.find((d) => d.docNumber === "T1-000002");
    expect(corrected?.totalCents).toBe(1200); // not the 1000 it was first completed at
  });

  it("is newest first", async () => {
    const docs = await recentDocuments(ACCOUNT, 20);
    const times = docs.map((d) => d.completedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe.skipIf(!ready)("how the shop was paid", () => {
  it("counts tenders on completed documents, never on a draft", async () => {
    /* the draft carried a 99,99 tender. Somebody tendered and walked away; the
       drawer never closed on it and it is not takings. */
    const split = await tenderSplit(ACCOUNT, 30);

    expect(split).toEqual([
      { method: "cash", amountCents: 2580, count: 1 },
      { method: "card", amountCents: 1200, count: 1 },
    ]);
  });
});

describe.skipIf(!ready)("the Z history", () => {
  it("reads the close, with what was counted against what was expected", async () => {
    const shifts = await recentShifts(ACCOUNT, 5);

    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      zDocNumber: "Z1-000001",
      openingFloatCents: 20000,
      countedCashCents: 22580,
      expectedCashCents: 22580,
      varianceCents: 0,
    });
  });
});

describe.skipIf(!ready)("another account's shop", () => {
  it("is invisible, because every query reaches rows through tenants", async () => {
    const stranger = uuidv7();
    await admin.insert(accounts).values({
      id: stranger,
      name: "Otra cuenta",
      email: `stranger.${stamp}@codroon.invalid`,
    });

    try {
      expect(await todayTotals(stranger)).toMatchObject({ netCents: 0, documents: 0 });
      expect(await recentDocuments(stranger)).toEqual([]);
      expect(await tenderSplit(stranger)).toEqual([]);
      expect(await recentShifts(stranger)).toEqual([]);
      expect(await dailyTakings(stranger)).toEqual([]);
    } finally {
      await admin.delete(accounts).where(eq(accounts.id, stranger));
    }
  });
});
