/**
 * The Z is a document you read, and only then a paper you may pull.
 *
 * Until v0.14.1 closing a shift printed a Z whether anybody wanted one or not,
 * and pressing X spent a strip of thermal paper to answer a question the screen
 * could have answered. Both now open the report on screen; Print and Save PDF
 * are actions on it.
 *
 * The property worth pinning is that the two halves stay separate: closing
 * produces every figure the screen needs and touches no printer, and printing
 * reaches the SAME ops whichever way the paper comes out. The report itself is
 * unchanged — that is the point of doing it this way rather than writing a
 * second renderer for the screen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { renderZReport, uuidv7, type ShiftReportDoc, type ShiftTotals } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx } from "../repos/shift";
import { encodeEscPos } from "../print/escpos";
import { buildHtml } from "../print/pdf";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-zdoc-"));
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

/** Every oplog entry the print path writes, whatever its outcome. */
const printEntries = () =>
  env.db
    .select()
    .from(s.oplog)
    .all()
    .filter((e) => e.action === "print");

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
});

/* ----------------------------------------------------- close ≠ print */

describe("closing a shift", () => {
  it("produces the screen's data and prints nothing", async () => {
    const res = await call<{ shiftId: string; zDocNumber: string }>("cash:close", {
      countedCents: 20000,
      breakdown: null,
      reason: null,
    });
    expect(res.zDocNumber).toMatch(/^Z1-\d{6}$/);
    /* the behaviour change: the paper is now an action the closer chooses
       (ADR-0015 amendment §13) */
    expect(printEntries()).toEqual([]);
  });

  it("hands back a shift that reads as a finished document", async () => {
    const { shiftId } = await call<{ shiftId: string }>("cash:close", {
      countedCents: 19700,
      breakdown: null,
      reason: "Cambio mal dado",
    });
    const got = await call<{ shift: Record<string, unknown>; totals: ShiftTotals | null }>("cash:get", { shiftId });

    // everything ShiftDocument renders, present without a second round trip
    expect(got.shift.zDocNumber).toMatch(/^Z1-/);
    expect(got.shift.closedAtMs).toBeTypeOf("number");
    expect(got.shift.closedByName).toBe("Ahmer");
    expect(got.shift.countedCashCents).toBe(19700);
    expect(got.shift.varianceCents).toBe(-300);
    expect(got.shift.varianceReason).toBe("Cambio mal dado");
    expect(got.totals?.expectedCashCents).toBe(20000);
  });

  it("lets the X be read without spending paper either", async () => {
    const x = await call<{ totals: ShiftTotals }>("cash:preview", {});
    expect(x.totals.expectedCashCents).toBe(20000);
    expect(printEntries()).toEqual([]);
    /* it still records that somebody looked — that fact matters when the count
       comes up short later (ADR-0015 §12) */
    const looked = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "shift" && e.action === "preview");
    expect(looked).toHaveLength(1);
  });
});

/* --------------------------------------------------- render on demand */

describe("the paper, when it is asked for", () => {
  /* The renderer is the shared truth: the thermal encoder and the PDF page are
     two consumers of ONE list of ops, which is why the screen, the receipt and
     the page cannot disagree about a figure. */
  const doc = (over: Partial<ShiftReportDoc> = {}): ShiftReportDoc => ({
    zDocNumber: "Z1-000004",
    terminalName: "Caja 1",
    openedAtMs: Date.UTC(2026, 8, 2, 7, 0),
    openedByName: "Ahmer",
    closedAtMs: Date.UTC(2026, 8, 2, 20, 30),
    closedByName: "Ahmer",
    printedAtMs: Date.UTC(2026, 8, 2, 20, 31),
    isCopy: false,
    totals: {
      openingFloatCents: 20000,
      grossSalesCents: 0,
      netSalesCents: 0,
      taxCents: 0,
      usedSalesCents: 0,
      tendersByMethod: [],
      tendersTotalCents: 0,
      tenderImbalanceCents: 0,
      movementsByReason: [],
      byMethod: [],
      series: [],
      cashMovementCents: 0,
      expectedCashCents: 20000,
      usedPurchaseCount: 0,
      repairsCollectedCount: 0,
      parkedCount: 0,
    } as unknown as ShiftTotals,
    countedCashCents: 20000,
    varianceCents: 0,
    varianceReason: null,
    approvedByName: null,
    ...over,
  });

  const SHOP = { legalName: "Arkom Electronics S.L.", nif: "B12345678", address: "C/ Mayor 14", footerLine: "" };

  it("encodes for the thermal printer at either paper width", () => {
    for (const width of [58, 80] as const) {
      const bytes = encodeEscPos(renderZReport(doc(), SHOP, width), "escpos", width);
      expect(bytes.length).toBeGreaterThan(100);
      expect(bytes.includes(Buffer.from("Z1-000004"))).toBe(true);
    }
  });

  it("renders the same document as a page for the PDF fallback", async () => {
    const html = await buildHtml(renderZReport(doc(), SHOP, 80), 80);
    expect(html).toContain("Z1-000004");
    expect(html).toContain("INFORME Z");
  });

  it("stamps COPIA on both paths when the caller asks for a reprint", async () => {
    const ops = renderZReport(doc({ isCopy: true }), SHOP, 80);
    expect(encodeEscPos(ops, "escpos", 80).includes(Buffer.from("C O P I A"))).toBe(true);
    expect(await buildHtml(ops, 80)).toContain("C O P I A");
  });

  it("prints an X with no number on it at all", () => {
    const x = renderZReport(
      doc({ zDocNumber: null, closedAtMs: null, closedByName: null, countedCashCents: null, varianceCents: null }),
      SHOP,
      80,
    );
    const bytes = encodeEscPos(x, "escpos", 80);
    expect(bytes.includes(Buffer.from("Z1-"))).toBe(false);
  });
});
