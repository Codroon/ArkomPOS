/**
 * The quote, the approval, and the parts — against a real database.
 *
 * The assertions that matter here are the ledger ones. A repair is the second
 * thing in this till that takes stock off a shelf, and the rule ADR-0004 sets is
 * unforgiving: quantities are never updated and nothing is ever deleted, so a
 * part that goes out and comes back is TWO movements whose sum is zero — not one
 * movement that was undone.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { AppError, parseIpcError, uuidv7, type RepairCreateRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers, registeredChannels } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx } from "../repos/shift";
import {
  addLine,
  createTicket,
  getDetail,
  partsToOrder,
  receivePart,
  recordApproval,
  removeLine,
  setLineCharge,
  upsertCustomer,
} from "../repos/repair";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-repair-quote-"));
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
let ticketId: string;
let screenId: string;
let phoneId: string;

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

/** A quantity article with stock on the shelf. */
function makeProduct(name: string, opts: { costCents: number; priceCents: number; onHand: number; serialized?: boolean }) {
  const now = new Date();
  const id = uuidv7();
  env.db
    .insert(s.products)
    .values({
      id,
      tenantId: env.ctx.tenantId,
      name,
      barcode: null,
      groupId: null,
      itemType: opts.serialized ? "serialized" : "stocked",
      costCents: opts.costCents,
      priceCents: opts.priceCents,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  env.db
    .insert(s.productStock)
    .values({ productId: id, locationId: env.ctx.locationId, onHand: opts.onHand, updatedAt: now })
    .run();
  return id;
}

const onHandOf = (productId: string) =>
  env.db
    .select({ onHand: s.productStock.onHand })
    .from(s.productStock)
    .where(and(eq(s.productStock.productId, productId), eq(s.productStock.locationId, env.ctx.locationId)))
    .all()[0]?.onHand ?? 0;

const movementsOf = (productId: string) =>
  env.db.select().from(s.stockMovements).where(eq(s.stockMovements.productId, productId)).all();

function intake(over: Partial<RepairCreateRequest> = {}): RepairCreateRequest {
  return {
    customerId: "",
    deviceDescription: "Apple iPhone 11 64GB",
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
    depositMethod: "cash",
    authorizedCapCents: null,
    assignedUserId: null,
    ...over,
  };
}

beforeEach(async () => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });

  const customer = upsertCustomer(env.db, ctxOf(), { name: "Joan Puig", phone: "+34 671 220 918" });
  ticketId = (await createTicket(env.db, ctxOf(), intake({ customerId: customer.id }))).ticketId;

  screenId = makeProduct("Pantalla iPhone 11", { costCents: 4200, priceCents: 8900, onHand: 5 });
  phoneId = makeProduct("iPhone 11 64GB", { costCents: 20000, priceCents: 30000, onHand: 1, serialized: true });
});

const codeOf = async (fn: () => unknown): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.ipc.code;
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

const labor = (chargeCents: number) =>
  addLine(env.db, ctxOf(), { kind: "labor", ticketId, description: "Mano de obra", chargeCents });

const fitScreen = (qty = 1) =>
  addLine(env.db, ctxOf(), { kind: "inventory_part", ticketId, productId: screenId, qty });

const orderPart = (over: Record<string, unknown> = {}) =>
  addLine(env.db, ctxOf(), {
    kind: "part_on_order",
    ticketId,
    description: "Batería iPhone 11",
    qty: 1,
    supplierText: "Movilex",
    expectedCostCents: 1800,
    chargeCents: 4500,
    ...over,
  } as never);

/* ------------------------------------------------------------ the quote */

describe("building a quote", () => {
  it("moves the ticket to Presupuestado on its first line", () => {
    expect(getDetail(env.db, ctxOf(), ticketId).status).toBe("received");
    expect(labor(3000).status).toBe("quoted");
  });

  it("charges labor what was typed and costs the shop nothing", () => {
    const detail = labor(3000);
    const line = detail.lines[0]!;
    expect(line.chargeCents).toBe(3000);
    // an hour of a technician's time is not stock; pretending it has a cost
    // would corrupt every margin on the ticket
    expect(line.unitCostCents).toBeNull();
    expect(detail.margin).toMatchObject({ costCents: 0, chargeCents: 3000, marginCents: 3000 });
  });

  it("prices an inventory part from the catalogue and snapshots its cost", () => {
    const line = fitScreen().lines[0]!;
    expect(line.description).toBe("Pantalla iPhone 11");
    expect(line.chargeCents).toBe(8900);
    expect(line.unitCostCents).toBe(4200);
  });

  it("multiplies the shelf price by the quantity", () => {
    expect(fitScreen(2).lines[0]!.chargeCents).toBe(17800);
  });

  it("reports the ticket's margin over every line", () => {
    fitScreen();
    const detail = labor(3000);
    expect(detail.quoteTotalCents).toBe(11900);
    expect(detail.margin).toMatchObject({ costCents: 4200, chargeCents: 11900, marginCents: 7700 });
    expect(detail.margin.marginPct).toBe(65);
  });

  it("refuses a serialized article as a part", async () => {
    // a phone with an IMEI is something a shop sells, not something it fits
    expect(
      await codeOf(() => addLine(env.db, ctxOf(), { kind: "inventory_part", ticketId, productId: phoneId, qty: 1 })),
    ).toBe("VALIDATION");
    expect(env.db.select().from(s.repairLines).all()).toHaveLength(0);
  });

  it("refuses a part with no stock rather than going negative", async () => {
    expect(await codeOf(() => fitScreen(9))).toBe("NEGATIVE_STOCK");
    expect(onHandOf(screenId)).toBe(5);
    expect(env.db.select().from(s.repairLines).all()).toHaveLength(0);
  });
});

/* ----------------------------------------------------------- the ledger */

describe("a part leaving the shelf", () => {
  it("posts exactly one movement, immediately", () => {
    fitScreen(2);
    const movements = movementsOf(screenId);
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe("repair_part_out");
    expect(movements[0]!.qty).toBe(-2);
    // on the bench today, not at hand-back: the on-hand figure someone reorders
    // from has to be right for every day the phone sits in the workshop
    expect(onHandOf(screenId)).toBe(3);
  });

  it("carries the repair document, so Inventario can link back to the ticket", () => {
    fitScreen();
    const ticket = env.db.select().from(s.repairTickets).where(eq(s.repairTickets.id, ticketId)).all()[0]!;
    expect(movementsOf(screenId)[0]!.documentId).toBe(ticket.documentId);
  });

  it("comes back as a second movement, never as a deleted first one", () => {
    const detail = fitScreen(2);
    removeLine(env.db, ctxOf(), ticketId, detail.lines[0]!.id);

    const movements = movementsOf(screenId);
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.qty)).toEqual([-2, 2]);
    // the return says why, which is the whole point of keeping both rows
    expect(movements[1]!.reason).toBe("línea de reparación retirada");
    expect(onHandOf(screenId)).toBe(5);
  });

  it("leaves the stock alone when a labor line is removed", () => {
    const detail = labor(3000);
    removeLine(env.db, ctxOf(), ticketId, detail.lines[0]!.id);
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(0);
  });
});

/* ---------------------------------------------------------- the approval */

describe("recording the customer's approval", () => {
  it("captures the quote total as it stands at that moment", () => {
    labor(3000);
    const detail = recordApproval(env.db, ctxOf(), ticketId, "in_person");
    expect(detail.approvals[0]!.approvedTotalCents).toBe(3000);
    expect(detail.approvals[0]!.method).toBe("in_person");
    expect(detail.status).toBe("in_repair");
    expect(detail.authorization).toMatchObject({ authorized: true, source: "approval", coveredCents: 3000 });
  });

  it("refuses to approve an empty quote", async () => {
    // "approved 0 €" must not become a licence to charge later
    expect(await codeOf(() => recordApproval(env.db, ctxOf(), ticketId, "by_phone"))).toBe("VALIDATION");
  });

  it("falls back to Presupuestado when the quote grows past what was approved", () => {
    labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    const detail = fitScreen();
    expect(detail.status).toBe("quoted");
    expect(detail.authorization.authorized).toBe(false);
  });

  it("keeps both approvals on the record", () => {
    labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    fitScreen();
    const detail = recordApproval(env.db, ctxOf(), ticketId, "by_phone");
    // "they approved 30 € on Monday and 119 € on Wednesday" is the sentence
    // that settles a dispute, so neither row is overwritten
    expect(detail.approvals.map((a) => a.approvedTotalCents)).toEqual([11900, 3000]);
    expect(detail.status).toBe("in_repair");
  });

  it("authorizes from an intake cap without any approval at all", async () => {
    const customer = upsertCustomer(env.db, ctxOf(), { name: "Ana Ruiz", phone: "+34 655 401 200" });
    const capped = await createTicket(
      env.db,
      ctxOf(),
      intake({ customerId: customer.id, authorizedCapCents: 5000 }),
    );
    const detail = addLine(env.db, ctxOf(), {
      kind: "labor",
      ticketId: capped.ticketId,
      description: "Mano de obra",
      chargeCents: 4000,
    });
    expect(detail.status).toBe("in_repair");
    expect(detail.authorization).toMatchObject({ source: "cap", coveredCents: 5000 });
  });
});

/* ------------------------------------------------- charges after approval */

describe("moving a charge after the customer agreed", () => {
  it("lets it go up with no ceremony", () => {
    const detail = labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    const raised = setLineCharge(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      chargeCents: 5000,
    });
    // safe, because the ticket drops back to Presupuestado and nothing can be
    // collected until they agree to the new number
    expect(raised.lines[0]!.chargeCents).toBe(5000);
    expect(raised.status).toBe("quoted");
  });

  it("refuses to lower it without a reason", async () => {
    const detail = labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    expect(
      await codeOf(() =>
        setLineCharge(env.db, ctxOf(), { ticketId, lineId: detail.lines[0]!.id, chargeCents: 2000 }),
      ),
    ).toBe("VALIDATION");
    expect(getDetail(env.db, ctxOf(), ticketId).lines[0]!.chargeCents).toBe(3000);
  });

  it("allows it with one, and writes the reason onto the oplog entry", () => {
    const detail = labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    const lowered = setLineCharge(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      chargeCents: 2000,
      reason: "El cliente trajo su propia pantalla",
    });
    expect(lowered.lines[0]!.chargeCents).toBe(2000);

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "repair_line" && e.action === "update")
      .at(-1)!;
    expect((entry.after as Record<string, unknown>).reason).toBe("El cliente trajo su propia pantalla");
  });

  it("needs no reason before anyone has approved anything", () => {
    const detail = labor(3000);
    const lowered = setLineCharge(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      chargeCents: 1000,
    });
    // nobody has agreed to a number yet, so there is nothing to go back on
    expect(lowered.lines[0]!.chargeCents).toBe(1000);
  });

  it("is declared a dynamic gate in the registry", () => {
    // the permission is chosen per call rather than fixed at registration
    expect(registeredChannels().get("repair:setLineCharge")).toBe("*");
  });
});

/**
 * The escalation, through the bridge and a real cashier session.
 *
 * The gate is picked from the ticket's own rows before the handler runs, so a
 * renderer that sent a flattering "from" amount cannot choose its own
 * permission — there is no "from" in the payload to lie with.
 */
describe("who may lower an approved charge", () => {
  let cashier: { id: string };
  let lineId: string;

  const call = async (channel: string, payload?: unknown, approval?: unknown): Promise<unknown> =>
    handlers.get(channel)!({}, payload, approval);

  beforeEach(() => {
    cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    lineId = labor(3000).lines[0]!.id;
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
  });

  it("lets a cashier raise one on their own", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await codeOf(() => call("repair:setLineCharge", { ticketId, lineId, chargeCents: 5000 }))).toBe("OK");
  });

  it("asks for an owner's PIN before a cashier may lower one", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(
      await codeOf(() =>
        call("repair:setLineCharge", { ticketId, lineId, chargeCents: 2000, reason: "Gesto comercial" }),
      ),
    ).toBe("APPROVAL_REQUIRED");
    expect(getDetail(env.db, ctxOf(), ticketId).lines[0]!.chargeCents).toBe(3000);
  });

  it("goes through with one, and stamps both people on the entry", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(
      await codeOf(() =>
        call(
          "repair:setLineCharge",
          { ticketId, lineId, chargeCents: 2000, reason: "Gesto comercial" },
          { userId: owner.id, pin: "8317" },
        ),
      ),
    ).toBe("OK");

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "repair_line" && e.action === "update")
      .at(-1)!;
    // "Ana cut this" and "Ana cut this and Ahmer approved it" are different facts
    expect(entry.userId).toBe(cashier.id);
    expect(entry.authorizedByUserId).toBe(owner.id);
  });

  it("still refuses without a reason, even with an owner's PIN", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    // the permission answers WHO may; the reason answers WHY — a PIN does not
    // substitute for the second
    expect(
      await codeOf(() =>
        call("repair:setLineCharge", { ticketId, lineId, chargeCents: 2000 }, { userId: owner.id, pin: "8317" }),
      ),
    ).toBe("VALIDATION");
    expect(getDetail(env.db, ctxOf(), ticketId).lines[0]!.chargeCents).toBe(3000);
  });

  it("never asks the owner doing it themselves", async () => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    expect(
      await codeOf(() =>
        call("repair:setLineCharge", { ticketId, lineId, chargeCents: 2000, reason: "Gesto comercial" }),
      ),
    ).toBe("OK");
  });
});

/* --------------------------------------------------------- parts on order */

describe("a part that has to be ordered", () => {
  it("touches no stock at all", () => {
    const detail = orderPart();
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(0);
    expect(detail.lines[0]!.unitCostCents).toBeNull();
    expect(detail.lines[0]!.expectedCostCents).toBe(1800);
  });

  it("holds the ticket at Esperando pieza once the work is authorized", () => {
    orderPart();
    const detail = recordApproval(env.db, ctxOf(), ticketId, "in_person");
    expect(detail.status).toBe("waiting_part");
  });

  it("returns to En reparación when the last one is received", () => {
    const detail = orderPart();
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    const received = receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });
    // derived from the facts, never toggled
    expect(received.status).toBe("in_repair");
  });

  it("returns to En reparación when the last one is removed instead", () => {
    const detail = orderPart();
    labor(3000);
    recordApproval(env.db, ctxOf(), ticketId, "in_person");
    expect(getDetail(env.db, ctxOf(), ticketId).status).toBe("waiting_part");
    expect(removeLine(env.db, ctxOf(), ticketId, detail.lines[0]!.id).status).toBe("in_repair");
  });

  it("posts one stock-in and one consumption when it arrives", () => {
    const detail = orderPart();
    receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });

    const movements = movementsOf(screenId);
    expect(movements.map((m) => [m.movementType, m.qty])).toEqual([
      ["purchase_in", 1],
      ["repair_part_out", -1],
    ]);
    // net zero on the shelf — it went straight to the bench, and both halves
    // are visible rather than netted into nothing
    expect(onHandOf(screenId)).toBe(5);
  });

  it("records what it really cost, not what was expected", () => {
    const detail = orderPart();
    const received = receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });
    const line = received.lines[0]!;
    expect(line.kind).toBe("inventory_part");
    expect(line.unitCostCents).toBe(2000);
    expect(line.receivedAt).not.toBeNull();
    // the article's cost figure now comes from an invoice
    expect(
      env.db.select().from(s.products).where(eq(s.products.id, screenId)).all()[0]!.costCents,
    ).toBe(2000);
  });

  it("behaves like a fitted part afterwards, reversal and all", () => {
    const detail = orderPart();
    receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });
    removeLine(env.db, ctxOf(), ticketId, detail.lines[0]!.id);
    expect(movementsOf(screenId).map((m) => m.qty)).toEqual([1, -1, 1]);
    expect(onHandOf(screenId)).toBe(6);
  });

  it("refuses to receive the same part twice", async () => {
    const detail = orderPart();
    receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });
    expect(
      await codeOf(() =>
        receivePart(env.db, ctxOf(), {
          ticketId,
          lineId: detail.lines[0]!.id,
          unitCostCents: 2000,
          qty: 1,
          productId: screenId,
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("refuses to receive one with no catalogue article to stock it into", async () => {
    const detail = orderPart();
    expect(
      await codeOf(() =>
        receivePart(env.db, ctxOf(), {
          ticketId,
          lineId: detail.lines[0]!.id,
          unitCostCents: 2000,
          qty: 1,
        }),
      ),
    ).toBe("VALIDATION");
  });
});

/* ------------------------------------------------------- the buying list */

describe("parts to order", () => {
  it("lists every open ordered line across tickets, oldest first", async () => {
    orderPart();
    const other = upsertCustomer(env.db, ctxOf(), { name: "Marta Gil", phone: "+34 600 111 222" });
    const second = await createTicket(env.db, ctxOf(), intake({ customerId: other.id }));
    addLine(env.db, ctxOf(), {
      kind: "part_on_order",
      ticketId: second.ticketId,
      description: "Tapa trasera",
      qty: 1,
      chargeCents: 2500,
    });

    const rows = partsToOrder(env.db, ctxOf());
    expect(rows.map((r) => r.description)).toEqual(["Batería iPhone 11", "Tapa trasera"]);
    expect(rows[0]).toMatchObject({
      customerName: "Joan Puig",
      supplierText: "Movilex",
      expectedCostCents: 1800,
      daysWaiting: 0,
    });
    expect(rows[0]!.docNumber).toBe("R-000001");
  });

  it("drops a line once it arrives", () => {
    const detail = orderPart();
    receivePart(env.db, ctxOf(), {
      ticketId,
      lineId: detail.lines[0]!.id,
      unitCostCents: 2000,
      qty: 1,
      productId: screenId,
    });
    expect(partsToOrder(env.db, ctxOf())).toHaveLength(0);
  });

  it("counts the days a part has been waiting", () => {
    orderPart();
    const line = env.db.select().from(s.repairLines).all()[0]!;
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    env.db.update(s.repairLines).set({ orderedAt: nineDaysAgo }).where(eq(s.repairLines.id, line.id)).run();
    expect(partsToOrder(env.db, ctxOf())[0]!.daysWaiting).toBe(9);
  });
});
