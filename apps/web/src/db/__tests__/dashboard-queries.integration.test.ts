/**
 * The dashboard's arithmetic, against a real Postgres and known rows.
 *
 * These are money queries over a jsonb stream, which is exactly the kind of SQL
 * that returns a plausible number when it is wrong. So the fixture is built by
 * hand — two tickets, one refund, one abandoned draft, one closed shift, one
 * sale from last week — and every total is asserted against a figure worked out
 * on paper.
 *
 * Four traps are pinned deliberately, because each produces a believable wrong
 * answer rather than an error:
 *
 *   · a refund arrives as `document/refund`, not `document/complete`
 *   · a draft that was never completed is not money
 *   · a document corrected by a later op must count once, at its latest figure
 *   · a day with no sales must still appear in the chart, at zero
 *
 * Throwaway account, deleted afterwards; accounts cascade.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { uuidv7 } from "@arkom/core";
import { lastDays } from "../../lib/range";
import { accounts, devices, syncEntries, tenants } from "../schema";
import {
  documentsInPeriod,
  paymentMix,
  periodTotals,
  recentShifts,
  takingsByDay,
  topProducts,
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

/**
 * Now, and a second before it.
 *
 * NOT "a couple of hours ago": these are bucketed by the shop's day in Madrid,
 * and a fixture dated two hours back lands on YESTERDAY whenever the suite runs
 * in the first two hours after midnight there. That failed at 00:30 Madrid and
 * passed every other hour of the day, which is the worst kind of test. The two
 * only need to differ enough to order.
 */
const TODAY = Date.now();
const EARLIER = TODAY - 1000;
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
    // and one from exactly a week ago, which is the PREVIOUS period for a 7-day window
    entry("document", "complete", doc(OLD_TICKET, {
      docNumber: "T1-000000", totalCents: 5000, taxCents: 868, completedAt: LAST_WEEK,
    })),

    // lines, for "what sells": the funda twice, the cable once
    entry("document_line", "create", {
      id: uuidv7(), documentId: TICKET_A, lineNo: 1, description: "Funda", qty: 2, totalCents: 2580,
    }),
    entry("document_line", "create", {
      id: uuidv7(), documentId: TICKET_B, lineNo: 1, description: "Cable USB-C", qty: 1, totalCents: 1200,
    }),
    // on the draft, so it must not count
    entry("document_line", "create", {
      id: uuidv7(), documentId: DRAFT, lineNo: 1, description: "Fantasma", qty: 9, totalCents: 9999,
    }),

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

describe.skipIf(!ready)("the period totals", () => {
  it("counts completed documents only, refunds included as negatives", async () => {
    /* 25,80 + 12,00 − 12,90 = 24,90. The draft's 99,99 is not money, and last
       week's 50,00 is not today. */
    const { current } = await periodTotals(ACCOUNT, lastDays(1));

    expect(current.netCents).toBe(2490);
    expect(current.documents).toBe(3);
    expect(current.refundCents).toBe(-1290);
    expect(current.refunds).toBe(1);
    expect(current.taxCents).toBe(448 + 208 - 224);
  });

  it("works out the average sale in whole cents", async () => {
    const { current } = await periodTotals(ACCOUNT, lastDays(1));
    // 2490 / 3, rounded once, in the query rather than in a component
    expect(current.averageCents).toBe(830);
  });

  it("compares against the period before, which is what a percentage means", async () => {
    /* a 7-day window ends today and starts six days back, so last week's 50,00
       lands in the PREVIOUS window — takings halved, and the dashboard says so */
    const { current, previous, delta } = await periodTotals(ACCOUNT, lastDays(7));

    expect(current.netCents).toBe(2490);
    expect(previous.netCents).toBe(5000);
    expect(delta.net).toBeCloseTo(-50.2, 1);
  });

  it("says nothing rather than infinity when there was nothing before", async () => {
    /* today against yesterday, and yesterday was empty. A percentage change
       from zero is not a number anybody should be shown. */
    const { delta } = await periodTotals(ACCOUNT, lastDays(1));
    expect(delta.net).toBeNull();
    expect(delta.documents).toBeNull();
  });
});

describe.skipIf(!ready)("the chart", () => {
  it("has a bar for every day, including the ones nothing happened on", async () => {
    /* a chart with the quiet days dropped lies about the shape of a week:
       Sunday closed has to look like Sunday closed */
    const days = await takingsByDay(ACCOUNT, lastDays(10));

    expect(days).toHaveLength(10);
    expect(days[days.length - 1]).toMatchObject({ netCents: 2490, documents: 3 });
    expect(days.find((day) => day.netCents === 5000)?.documents).toBe(1);
    expect(days.filter((day) => day.documents === 0)).toHaveLength(8);
  });

  it("is in calendar order, oldest first, so a chart reads left to right", async () => {
    const days = await takingsByDay(ACCOUNT, lastDays(10));
    expect([...days].sort((a, b) => a.day.localeCompare(b.day))).toEqual(days);
  });
});

describe.skipIf(!ready)("the document list", () => {
  it("shows each completed document once, at its latest figure", async () => {
    const docs = await documentsInPeriod(ACCOUNT, lastDays(30));

    expect(docs).toHaveLength(4);
    expect(docs.map((d) => d.docNumber)).toContain("D1-000001");
    expect(docs.find((d) => d.docNumber === "T1-000002")?.totalCents).toBe(1200);
  });

  it("is newest first", async () => {
    const docs = await documentsInPeriod(ACCOUNT, lastDays(30));
    const times = docs.map((d) => d.completedAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("narrows by number and by type, in SQL", async () => {
    expect(await documentsInPeriod(ACCOUNT, lastDays(30), { search: "D1" })).toHaveLength(1);
    expect(await documentsInPeriod(ACCOUNT, lastDays(30), { docType: "refund" })).toHaveLength(1);
    expect(await documentsInPeriod(ACCOUNT, lastDays(30), { docType: "ticket" })).toHaveLength(3);
  });
});

describe.skipIf(!ready)("how the shop was paid", () => {
  it("counts tenders on completed documents, never on a draft", async () => {
    /* the draft carried a 99,99 tender. Somebody tendered and walked away; the
       drawer never closed on it and it is not takings. */
    const mix = await paymentMix(ACCOUNT, lastDays(30));

    expect(mix).toEqual([
      { method: "cash", amountCents: 2580, count: 1 },
      { method: "card", amountCents: 1200, count: 1 },
    ]);
  });
});

describe.skipIf(!ready)("what sells", () => {
  it("ranks lines on completed documents by value, and ignores the draft's", async () => {
    const top = await topProducts(ACCOUNT, lastDays(30));

    expect(top.map((row) => row.description)).toEqual(["Funda", "Cable USB-C"]);
    expect(top[0]).toMatchObject({ qty: 2, totalCents: 2580 });
    expect(top.some((row) => row.description === "Fantasma")).toBe(false);
  });
});

describe.skipIf(!ready)("the Z history", () => {
  it("reads the close, with what was counted against what was expected", async () => {
    const shifts = await recentShifts(ACCOUNT, lastDays(30), 5);

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
      const totals = await periodTotals(stranger, lastDays(30));
      expect(totals.current.netCents).toBe(0);
      expect(totals.current.documents).toBe(0);
      expect(await documentsInPeriod(stranger, lastDays(30))).toEqual([]);
      expect(await paymentMix(stranger, lastDays(30))).toEqual([]);
      expect(await topProducts(stranger, lastDays(30))).toEqual([]);
      expect(await recentShifts(stranger, lastDays(30))).toEqual([]);
      // the calendar still comes back, empty — a chart with no bars, not no chart
      const days = await takingsByDay(stranger, lastDays(7));
      expect(days).toHaveLength(7);
      expect(days.every((day) => day.netCents === 0)).toBe(true);
    } finally {
      await admin.delete(accounts).where(eq(accounts.id, stranger));
    }
  });
});
