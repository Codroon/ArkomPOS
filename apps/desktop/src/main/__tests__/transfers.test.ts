/**
 * The WU counter — ADR-0018.
 *
 * What is pinned here is the money. The principal is not the shop's, so it must
 * never appear in a sales figure; the notes are real, so the drawer must know
 * about them to the cent; and a cancel must undo exactly what it did, once.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { parseIpcError, renderZReport, uuidv7, type ShiftTotals, type TransferRow } from "@arkom/core";
import { opsToText } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { closeShiftTx, openShiftTx, shiftById, shiftTotals } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const FLOAT = 20000;

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-wu-"));
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

const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;
const code = async (channel: string, payload?: unknown): Promise<string> => {
  try {
    await handlers.get(channel)!({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/** Expected cash right now — the figure a close would freeze. */
const expected = (): number => {
  const shift = env.db.select().from(s.shifts).all().find((x) => x.closedAt === null)!;
  return shiftTotals(env.db, shift).expectedCashCents;
};
const totals = (): ShiftTotals => {
  const shift = env.db.select().from(s.shifts).all().find((x) => x.closedAt === null)!;
  return shiftTotals(env.db, shift);
};
const movementSum = () =>
  env.db
    .select()
    .from(s.cashMovements)
    .all()
    .reduce((a, m) => a + m.amountCents, 0);

let mtcnSeed = 1000000000;
const nextMtcn = () => String(++mtcnSeed);

const send = (over: Record<string, unknown> = {}) =>
  call<{ row: TransferRow }>("transfer:send", {
    mtcn: nextMtcn(),
    senderName: "Imran Khan",
    receiverName: "Fatima Bibi",
    countryCode: "PK",
    principalCents: 30000,
    feeCents: 500,
    method: "cash",
    ...over,
  });

const payout = (over: Record<string, unknown> = {}) =>
  call<{ kind: string; row?: TransferRow; expectedCashCents?: number; amountCents?: number }>("transfer:payout", {
    mtcn: nextMtcn(),
    senderName: "Ana Silva",
    receiverName: "Joan Puig",
    countryCode: "BR",
    principalCents: 5000,
    ...over,
  });

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
  openShiftTx(env.db, ctxOf(), { floatCents: FLOAT, breakdown: null });
});

/* ------------------------------------------------------- 1 · the drawer */

describe("what a transfer does to the notes", () => {
  it("takes principal AND fee on a cash send", async () => {
    await send({ principalCents: 30000, feeCents: 500 });
    expect(expected()).toBe(FLOAT + 30500);
    expect(movementSum()).toBe(30500);
  });

  it("takes the principal alone when the fee is zero, which is normal", async () => {
    /* WU waives the fee on plenty of corridors, including large sends. A till
       that treated zero as "not filled in" would refuse ordinary business. */
    await send({ principalCents: 120000, feeCents: 0 });
    expect(expected()).toBe(FLOAT + 120000);
  });

  it("writes no movement at all for a card send", async () => {
    await send({ principalCents: 30000, feeCents: 500, method: "card" });
    expect(expected()).toBe(FLOAT);
    expect(env.db.select().from(s.cashMovements).all()).toEqual([]);
    // recorded all the same: the shop did the work and the Z reports it
    expect(env.db.select().from(s.transfers).all()).toHaveLength(1);
  });

  it("pays a payout out of the drawer", async () => {
    await payout({ principalCents: 5000 });
    expect(expected()).toBe(FLOAT - 5000);
    expect(movementSum()).toBe(-5000);
  });

  it("reverses the full amount on a cancel, fee included", async () => {
    const { row } = await send({ principalCents: 30000, feeCents: 500 });
    expect(expected()).toBe(FLOAT + 30500);

    expect(await code("transfer:cancel", { id: row.id, reason: "El cliente se arrepintió" })).toBe("OK");

    /* the whole 305,00 € goes back, not the principal with the fee kept: WU
       refunds everything, and a shop that kept the fee would be short */
    expect(expected()).toBe(FLOAT);
    expect(movementSum()).toBe(0);
  });

  it("reverses a payout by putting the notes back", async () => {
    const res = await payout({ principalCents: 5000 });
    expect(await code("transfer:cancel", { id: res.row!.id, reason: "Pago anulado" })).toBe("OK");
    expect(expected()).toBe(FLOAT);
  });

  it("moves nothing when a CARD send is cancelled", async () => {
    const { row } = await send({ method: "card" });
    await call("transfer:cancel", { id: row.id, reason: "Anulado" });
    expect(env.db.select().from(s.cashMovements).all()).toEqual([]);
  });

  it("refuses a second cancel, which would pay the refund twice", async () => {
    const { row } = await send();
    expect(await code("transfer:cancel", { id: row.id, reason: "Primera" })).toBe("OK");
    expect(await code("transfer:cancel", { id: row.id, reason: "Segunda" })).toBe("VALIDATION");
    expect(expected()).toBe(FLOAT);
    expect(env.db.select().from(s.cashMovements).all()).toHaveLength(2);
  });

  it("never puts a principal into a sales figure", async () => {
    await send({ principalCents: 100000, feeCents: 900 });
    await payout({ principalCents: 5000 });
    const t = totals();
    /* the whole point: money passing through is not money earned. No document,
       no VAT, no line in gross (ADR-0018). */
    expect(t.grossSalesCents).toBe(0);
    expect(t.netSalesCents).toBe(0);
    expect(t.taxCents).toBe(0);
    expect(t.series).toEqual([]);
  });
});

/* --------------------------------------------------------- 2 · the MTCN */

describe("the MTCN", () => {
  it("refuses a duplicate and names the record that already exists", async () => {
    const { row } = await send({ mtcn: "1234512345" });
    let existingId: string | null = null;
    try {
      await handlers.get("transfer:send")!({}, {
        mtcn: "1234512345",
        senderName: "Otro",
        receiverName: "Otra",
        countryCode: "MA",
        principalCents: 1000,
        feeCents: 0,
        method: "cash",
      });
    } catch (err) {
      const ipc = parseIpcError(err);
      expect(ipc?.code).toBe("DUPLICATE_MTCN");
      existingId = ipc?.message ?? null;
    }
    /* the answer is the record, not a lecture: a busy counter double-entering
       needs to SEE what is already logged (ADR-0018) */
    expect(existingId).toBe(row.id);
    expect(env.db.select().from(s.transfers).all()).toHaveLength(1);
  });

  it("is the same MTCN however it was typed", async () => {
    await send({ mtcn: "9876543210" });
    expect(await code("transfer:send", {
      mtcn: "987-654 3210",
      senderName: "A",
      receiverName: "B",
      countryCode: "MA",
      principalCents: 1000,
      feeCents: 0,
      method: "cash",
    })).toBe("DUPLICATE_MTCN");
  });

  it("refuses anything that is not ten digits", async () => {
    for (const bad of ["123", "12345678901", "ABCDEFGHIJ", ""]) {
      expect(await code("transfer:send", {
        mtcn: bad,
        senderName: "A",
        receiverName: "B",
        countryCode: "MA",
        principalCents: 1000,
        feeCents: 0,
        method: "cash",
      })).toBe("VALIDATION");
    }
  });

  it("shares one namespace across sends and payouts", async () => {
    await send({ mtcn: "5555500000" });
    expect(await code("transfer:payout", {
      mtcn: "5555500000",
      senderName: "A",
      receiverName: "B",
      countryCode: "MA",
      principalCents: 1000,
    })).toBe("DUPLICATE_MTCN");
  });
});

/* --------------------------------------------------------- 3 · the shift */

describe("the open shift", () => {
  it("refuses every operation when the drawer is shut", async () => {
    const shift = env.db.select().from(s.shifts).all()[0]!;
    closeShiftTx(env.db, ctxOf(), { countedCents: expected(), breakdown: null, reason: null });

    expect(await code("transfer:send", {
      mtcn: nextMtcn(),
      senderName: "A",
      receiverName: "B",
      countryCode: "MA",
      principalCents: 1000,
      feeCents: 0,
      method: "cash",
    })).toBe("SHIFT_REQUIRED");
    expect(await code("transfer:payout", {
      mtcn: nextMtcn(),
      senderName: "A",
      receiverName: "B",
      countryCode: "MA",
      principalCents: 1000,
    })).toBe("SHIFT_REQUIRED");
    expect(shift.id).toBeTruthy();
  });

  it("stamps the shift on the row and on its movement", async () => {
    const open = env.db.select().from(s.shifts).all()[0]!;
    const { row } = await send();
    expect(row.shiftId).toBe(open.id);
    expect(env.db.select().from(s.cashMovements).all()[0]!.shiftId).toBe(open.id);
  });

  it("lands a cancel's reversal in TODAY's shift, not the original's", async () => {
    const first = env.db.select().from(s.shifts).all()[0]!;
    const { row } = await send({ principalCents: 30000, feeCents: 500 });

    closeShiftTx(env.db, ctxOf(), { countedCents: FLOAT + 30500, breakdown: null, reason: null });
    openShiftTx(env.db, ctxOf(), { floatCents: FLOAT, breakdown: null });
    const second = env.db.select().from(s.shifts).all().find((x) => x.closedAt === null)!;

    await call("transfer:cancel", { id: row.id, reason: "Anulado al día siguiente" });

    /* yesterday's Z is frozen and it was right when it was taken: the money DID
       come in yesterday. Today gives it back (ADR-0015 §8). */
    const stored = env.db.select().from(s.transfers).where(eq(s.transfers.id, row.id)).all()[0]!;
    expect(stored.shiftId).toBe(first.id);
    expect(stored.cancelShiftId).toBe(second.id);

    const reversal = env.db.select().from(s.cashMovements).all().find((m) => m.reason === "transfer_cancel")!;
    expect(reversal.shiftId).toBe(second.id);
    expect(reversal.amountCents).toBe(-30500);
    expect(expected()).toBe(FLOAT - 30500);
  });

  it("warns rather than refuses when a payout is larger than the drawer", async () => {
    const res = await payout({ principalCents: FLOAT + 50000 });
    expect(res.kind).toBe("overDrawerWarning");
    expect(res.expectedCashCents).toBe(FLOAT);
    expect(res.amountCents).toBe(FLOAT + 50000);
    // nothing was written: the shop has not said yes yet
    expect(env.db.select().from(s.transfers).all()).toEqual([]);

    const confirmed = await payout({ mtcn: "7777700000", principalCents: FLOAT + 50000, confirmedOverDrawer: true });
    expect(confirmed.kind).toBe("logged");
    /* and it is recorded as an override, because that is the entry somebody
       wants when the count comes up odd */
    const flagged = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.action === "over_drawer");
    expect(flagged).toHaveLength(1);
  });
});

/* ------------------------------------------------------ 4 · a mixed shift */

describe("one shift with everything in it", () => {
  it("reports transfers apart from sales, and the cash line still equals the drawer", async () => {
    await send({ principalCents: 30000, feeCents: 500, method: "cash" }); //  +305,00
    await send({ principalCents: 20000, feeCents: 0, method: "cash" }); //    +200,00
    await send({ principalCents: 50000, feeCents: 1000, method: "card" }); //    0,00
    await payout({ principalCents: 8000 }); //                                 −80,00
    const { row: doomed } = await send({ principalCents: 10000, feeCents: 250, method: "cash" }); // +102,50
    await call("transfer:cancel", { id: doomed.id, reason: "Anulado" }); //     −102,50

    const t = totals();
    const tr = t.transfers!;

    // hand-computed, not read back from the code that produced it
    expect(tr.sendCount).toBe(4);
    expect(tr.sendPrincipalCents).toBe(30000 + 20000 + 50000 + 10000);
    expect(tr.sendFeesCents).toBe(500 + 0 + 1000 + 250);
    expect(tr.sendCashPrincipalCents).toBe(30000 + 20000 + 10000);
    expect(tr.sendCashFeesCents).toBe(500 + 0 + 250);
    expect(tr.sendCardPrincipalCents).toBe(50000);
    expect(tr.sendCardFeesCents).toBe(1000);
    expect(tr.payoutCount).toBe(1);
    expect(tr.payoutPrincipalCents).toBe(8000);
    expect(tr.cancelCount).toBe(1);
    expect(tr.cancelDrawerCents).toBe(-10250);

    // 305,00 + 200,00 + 102,50 − 80,00 − 102,50 = 425,00
    expect(tr.drawerCents).toBe(42500);
    expect(t.expectedCashCents).toBe(FLOAT + 42500);

    // sales are untouched by any of it
    expect(t.grossSalesCents).toBe(0);
    expect(t.taxCents).toBe(0);

    const cash = t.byMethod.find((m) => m.method === "cash")!;
    /* THE reconciliation property: the by-method cash line must equal what the
       drawer says it did, or the two blocks on the Z disagree (ADR-0015) */
    expect(cash.netCents).toBe(t.expectedCashCents - t.openingFloatCents);

    const card = t.byMethod.find((m) => m.method === "card")!;
    // the card send is on the statement even though the till never saw it
    expect(card.inCents).toBe(51000);
  });

  it("prints the block on the Z, and says the principal is not a sale", () => {
    const shift = env.db.select().from(s.shifts).all()[0]!;
    return (async () => {
      await send({ principalCents: 30000, feeCents: 500 });
      await payout({ principalCents: 8000 });
      const text = opsToText(
        renderZReport(
          {
            zDocNumber: "Z1-000001",
            terminalName: "Caja 1",
            openedAtMs: Date.now(),
            openedByName: "Ahmer",
            closedAtMs: Date.now(),
            closedByName: "Ahmer",
            printedAtMs: Date.now(),
            isCopy: false,
            totals: shiftTotals(env.db, shiftById(env.db, shift.id)!),
            countedCashCents: null,
            varianceCents: null,
            varianceReason: null,
            approvedByName: null,
          },
          { legalName: "Arkom", nif: "B1", address: "C/ Mayor", footerLine: "" },
        ),
      );
      expect(text).toContain("GIROS (WESTERN UNION)");
      expect(text).toContain("300,00 €");
      expect(text).toContain("80,00 €");
      expect(text).toContain("El principal no es una venta.");
    })();
  });
});

/* ------------------------------------------- 5 · a snapshot from before */

describe("a Z frozen before v0.15.0", () => {
  it("renders byte-identical, because it carries no transfers key", () => {
    const base: ShiftTotals = {
      openingFloatCents: FLOAT,
      salesCashCents: 5000,
      movementsCashCents: 0,
      expectedCashCents: FLOAT + 5000,
      netSalesCents: 4132,
      taxCents: 868,
      usedSalesCents: 0,
      grossSalesCents: 5000,
      tendersByMethod: [{ method: "cash", amountCents: 5000 }],
      tendersTotalCents: 5000,
      tenderImbalanceCents: 0,
      movementsByReason: [],
      depositsByMethod: [],
      refundsByMethod: [],
      payoutsByMethod: [],
      byMethod: [{ method: "cash", inCents: 5000, outCents: 0, netCents: 5000 }],
      series: [],
      usedPurchaseCount: 0,
      repairsCollectedCount: 0,
      parkedCount: 0,
    };
    const doc = {
      zDocNumber: "Z1-000001",
      terminalName: "Caja 1",
      openedAtMs: Date.UTC(2026, 0, 2, 8, 0),
      openedByName: "Ahmer",
      closedAtMs: Date.UTC(2026, 0, 2, 20, 0),
      closedByName: "Ahmer",
      printedAtMs: Date.UTC(2026, 0, 2, 20, 1),
      isCopy: false,
      totals: base,
      countedCashCents: FLOAT + 5000,
      varianceCents: 0,
      varianceReason: null,
      approvedByName: null,
    };
    const shop = { legalName: "Arkom", nif: "B1", address: "C/ Mayor", footerLine: "" };

    const before = opsToText(renderZReport(doc, shop));
    /* a v1 snapshot has no `transfers` key at all, and the renderer must print
       what it printed then — a reprint is a file read, not a recomputation
       (ADR-0015 §7) */
    expect(before).not.toContain("GIROS");
    expect(before).not.toContain("WESTERN");

    // and an explicit empty block is still nothing, not a column of zeros
    const withEmpty = opsToText(
      renderZReport({ ...doc, totals: { ...base, transfers: undefined } }, shop),
    );
    expect(withEmpty).toBe(before);
  });
});
