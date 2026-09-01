/**
 * The shift record itself: what the database guarantees, and what gets stamped.
 *
 * The write flows (open, close, movements) arrive in later slices. What this file
 * pins is the layer underneath them — the constraint SQLite enforces whatever the
 * code does, and the fact that every new document and cash movement remembers
 * which shift it belonged to.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { imeiWithCheckDigit, shiftStatus, uuidv7, type UsedLogRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { logPurchase } from "../repos/used";
import { createTicket, markNotRepaired, upsertCustomer } from "../repos/repair";
import { currentShiftId, loadShiftFacts, openShift, requireOpenShift, shiftTotals } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const IMEIS = [imeiWithCheckDigit("35209411880318"), imeiWithCheckDigit("86123456789012")];

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-shift-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  db.insert(s.numberSeries)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      docType: "ticket",
      prefix: "T1-",
      nextNumber: 1,
    })
    .run();
  return { db, ctx: { ...ids, userId: null as string | null } };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

/** A shift row inserted directly — `cash:open` arrives in the next slice. */
function insertShift(over: Partial<typeof s.shifts.$inferInsert> = {}) {
  const now = new Date();
  const row = {
    id: uuidv7(),
    tenantId: env.ctx.tenantId,
    locationId: env.ctx.locationId,
    terminalId: env.ctx.terminalId,
    openedByUserId: owner.id,
    openedAt: now,
    openingFloatCents: 20000,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  env.db.insert(s.shifts).values(row).run();
  return row;
}

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

async function takeInDevice(over: Parameters<typeof createTicket>[2] | Record<string, unknown> = {}) {
  const customer = upsertCustomer(env.db, ctxOf(), { name: "Joan Puig", phone: "671220918" });
  return createTicket(env.db, ctxOf(), {
    customerId: customer.id,
    deviceDescription: "Apple iPhone 11",
    imei: null,
    reportedFault: "Pantalla rota",
    conditionAtIntake: null,
    damage: { screen: true, back: false, dents: false, water: false },
    damageNote: null,
    accessories: null,
    devicePasscode: null,
    photos: [],
    promisedDate: null,
    promisedHalf: null,
    depositCents: 0,
    authorizedCapCents: null,
    assignedUserId: null,
    ...(over as Record<string, unknown>),
  } as Parameters<typeof createTicket>[2]);
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
});

/* ---------------------------------------------------- the guarantee */

describe("one open shift per till", () => {
  it("is enforced by SQLite, not by the code that happened to check first", () => {
    insertShift();
    // a partial unique index on (terminal_id) WHERE closed_at IS NULL. Two
    // windows, a double click or a retry cannot get past this (ADR-0015 §1)
    expect(() => insertShift()).toThrow(/UNIQUE/i);
  });

  it("permits the next shift once the first is closed", () => {
    const first = insertShift();
    env.db.update(s.shifts).set({ closedAt: new Date() }).where(eq(s.shifts.id, first.id)).run();
    expect(() => insertShift()).not.toThrow();
  });

  it("permits an open shift on a different till", () => {
    insertShift();
    const other = uuidv7();
    env.db
      .insert(s.terminals)
      .values({ id: other, tenantId: env.ctx.tenantId, locationId: env.ctx.locationId, name: "Caja 2", createdAt: new Date() })
      .run();
    expect(() => insertShift({ terminalId: other })).not.toThrow();
  });

  it("derives its status from closed_at and nothing else", () => {
    const row = insertShift();
    expect(shiftStatus(openShift(env.db, ctxOf())!)).toBe("open");
    env.db.update(s.shifts).set({ closedAt: new Date() }).where(eq(s.shifts.id, row.id)).run();
    expect(openShift(env.db, ctxOf())).toBeNull();
  });
});

describe("requireOpenShift", () => {
  it("raises its own code, because the Sale screen answers it with a dialog", () => {
    try {
      requireOpenShift(env.db, ctxOf());
      throw new Error("should have refused");
    } catch (err) {
      expect((err as { ipc?: { code: string } }).ipc?.code).toBe("SHIFT_REQUIRED");
    }
  });

  it("returns the shift when there is one", () => {
    const row = insertShift();
    expect(requireOpenShift(env.db, ctxOf()).id).toBe(row.id);
  });
});

/* ------------------------------------------------------- stamping */

describe("what carries a shift", () => {
  it("stamps a used purchase's document and its payout", async () => {
    const shift = insertShift();
    const result = await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));

    const doc = env.db.select().from(s.documents).where(eq(s.documents.docNumber, result.docNumber)).all()[0]!;
    expect(doc.shiftId).toBe(shift.id);
    const payout = env.db
      .select()
      .from(s.cashMovements)
      .where(eq(s.cashMovements.reason, "used_purchase_payout"))
      .all()[0]!;
    expect(payout.shiftId).toBe(shift.id);
  });

  it("stamps a repair intake and its deposit", async () => {
    const shift = insertShift();
    const ticket = await takeInDevice({ depositCents: 2000 });

    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticket.ticketId)).all()[0]!;
    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, row.documentId)).all()[0]!;
    expect(doc.shiftId).toBe(shift.id);
    const deposit = env.db.select().from(s.cashMovements).where(eq(s.cashMovements.ticketId, ticket.ticketId)).all()[0]!;
    expect(deposit.shiftId).toBe(shift.id);
  });

  it("leaves shift_id NULL when the till is working without one", async () => {
    // exactly what every pre-v0.13.0 row looks like: not an error, a fact
    expect(currentShiftId(env.db, ctxOf())).toBeNull();
    const result = await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    const doc = env.db.select().from(s.documents).where(eq(s.documents.docNumber, result.docNumber)).all()[0]!;
    expect(doc.shiftId).toBeNull();
  });
});

/* -------------------------------------------------- deposit method */

describe("how a deposit was taken", () => {
  it("posts a cash movement for a cash deposit, and only one", async () => {
    insertShift();
    const ticket = await takeInDevice({ depositCents: 2000, depositMethod: "cash" });
    const rows = env.db.select().from(s.cashMovements).where(eq(s.cashMovements.ticketId, ticket.ticketId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountCents).toBe(2000);
  });

  it("posts NONE for a card, Bizum or transfer deposit", async () => {
    insertShift();
    for (const method of ["card", "bizum", "transfer"] as const) {
      const ticket = await takeInDevice({ depositCents: 2000, depositMethod: method });
      const rows = env.db.select().from(s.cashMovements).where(eq(s.cashMovements.ticketId, ticket.ticketId)).all();
      // real money and a real obligation, but it never reached the drawer
      expect(rows, method).toHaveLength(0);
      const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticket.ticketId)).all()[0]!;
      expect(row.depositMethod).toBe(method);
    }
  });

  it("still reports a card deposit on the shift, from the ticket", async () => {
    const shift = insertShift();
    await takeInDevice({ depositCents: 3000, depositMethod: "card" });
    const facts = loadShiftFacts(env.db, env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!);
    expect(facts.deposits).toEqual([{ kind: "taken", method: "card", amountCents: 3000 }]);
    // and it changes nothing about what should be in the drawer
    expect(shiftTotals(env.db, env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!).expectedCashCents).toBe(20000);
  });

  it("refunds the way it was taken unless told otherwise, and only cash moves notes", async () => {
    const shift = insertShift();
    const ticket = await takeInDevice({ depositCents: 3000, depositMethod: "transfer" });
    markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "unrepairable",
      resolutions: [],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });

    const row = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticket.ticketId)).all()[0]!;
    expect(row.depositRefundedCents).toBe(3000);
    expect(row.depositRefundMethod).toBe("transfer"); // the way it came in
    expect(row.depositRefundShiftId).toBe(shift.id);

    // no notes moved either way, so the drawer is untouched
    const refunds = env.db
      .select()
      .from(s.cashMovements)
      .where(and(eq(s.cashMovements.ticketId, ticket.ticketId), eq(s.cashMovements.reason, "repair_deposit_refund")))
      .all();
    expect(refunds).toHaveLength(0);
    const current = env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!;
    expect(shiftTotals(env.db, current).expectedCashCents).toBe(20000);
  });

  it("moves the drawer when a cash deposit is refunded in cash", async () => {
    const shift = insertShift();
    const ticket = await takeInDevice({ depositCents: 3000, depositMethod: "cash" });
    markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "unrepairable",
      resolutions: [],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });
    const current = env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!;
    // in 30,00 and out 30,00 within the same shift: net zero
    expect(shiftTotals(env.db, current).expectedCashCents).toBe(20000);
  });
});

/* ------------------------------------------------------- the totals */

describe("the shift's own figures", () => {
  it("reads a used purchase out of the drawer and onto the by-method block", async () => {
    const shift = insertShift();
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!, { buyPriceCents: 8000 }));
    const current = env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!;
    const totals = shiftTotals(env.db, current);

    expect(totals.expectedCashCents).toBe(20000 - 8000);
    expect(totals.payoutsByMethod).toEqual([{ method: "cash", count: 1, amountCents: 8000 }]);
    const cash = totals.byMethod.find((row) => row.method === "cash")!;
    expect(totals.openingFloatCents + cash.netCents).toBe(totals.expectedCashCents);
  });

  it("keeps a transfer payout off the drawer but on the report", async () => {
    const shift = insertShift();
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[1]!, { payout: "transfer", payoutReference: "ES91" }));
    const current = env.db.select().from(s.shifts).where(eq(s.shifts.id, shift.id)).all()[0]!;
    const totals = shiftTotals(env.db, current);

    expect(totals.expectedCashCents).toBe(20000);
    expect(totals.payoutsByMethod).toEqual([{ method: "transfer", count: 1, amountCents: 8000 }]);
  });

  it("sees nothing from another shift's rows", async () => {
    const first = insertShift();
    await logPurchase(env.db, ctxOf(), purchase(IMEIS[0]!));
    env.db.update(s.shifts).set({ closedAt: new Date() }).where(eq(s.shifts.id, first.id)).run();

    const second = insertShift({ openingFloatCents: 10000 });
    const current = env.db.select().from(s.shifts).where(eq(s.shifts.id, second.id)).all()[0]!;
    expect(shiftTotals(env.db, current).expectedCashCents).toBe(10000);
  });
});
