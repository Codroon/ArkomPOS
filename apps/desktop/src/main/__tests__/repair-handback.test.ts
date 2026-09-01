/**
 * Handing the device back — the fiscal half of a repair.
 *
 * Three invariants carry this file, and each is one the shop's books depend on:
 *   1. the collection settles at EXACTLY the ticket's charged total,
 *   2. no part moves at hand-back, because it already moved when it was fitted,
 *   3. **every deposit resolves exactly once** — applied, refunded, or absorbed
 *      — and a ticket's cash_movements net to zero once it does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { AppError, parseIpcError, uuidv7, type RepairCreateRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx } from "../repos/shift";
import {
  addLine,
  collect,
  createTicket,
  getDetail,
  markNotRepaired,
  markReady,
  notifyCustomer,
  recordApproval,
  upsertCustomer,
} from "../repos/repair";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-repair-handback-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  // the till's own T1- series: a collection is an ordinary sale document
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
let customerId: string;
let screenId: string;

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

function makeProduct(name: string, opts: { costCents: number; priceCents: number; onHand: number }) {
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
      itemType: "stocked",
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

function intake(over: Partial<RepairCreateRequest> = {}): RepairCreateRequest {
  return {
    customerId,
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

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
  customerId = upsertCustomer(env.db, ctxOf(), { name: "Joan Puig", phone: "+34 671 220 918" }).id;
  screenId = makeProduct("Pantalla iPhone 11", { costCents: 4200, priceCents: 8900, onHand: 5 });
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

/** A ticket quoted, approved and ready — the state hand-back starts from. */
async function readyTicket(over: Partial<RepairCreateRequest> = {}, chargeCents = 7900) {
  const ticket = await createTicket(env.db, ctxOf(), intake(over));
  addLine(env.db, ctxOf(), {
    kind: "labor",
    ticketId: ticket.ticketId,
    description: "Cambio de pantalla",
    chargeCents,
  });
  recordApproval(env.db, ctxOf(), ticket.ticketId, "in_person");
  markReady(env.db, ctxOf(), ticket.ticketId);
  return ticket.ticketId;
}

const cashOf = (ticketId: string) =>
  env.db.select().from(s.cashMovements).where(eq(s.cashMovements.ticketId, ticketId)).all();

const cashNet = (ticketId: string) => cashOf(ticketId).reduce((total, r) => total + r.amountCents, 0);

/* ---------------------------------------------------------- mark ready */

describe("marking a device ready", () => {
  it("refuses while a part is still on order", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    addLine(env.db, ctxOf(), {
      kind: "part_on_order",
      ticketId: ticket.ticketId,
      description: "Pantalla",
      qty: 1,
      chargeCents: 7900,
    });
    recordApproval(env.db, ctxOf(), ticket.ticketId, "in_person");
    // marking a phone ready with a part in the post is how a customer drives
    // across town for nothing
    expect(await codeOf(() => markReady(env.db, ctxOf(), ticket.ticketId))).toBe("VALIDATION");
  });

  it("refuses before the customer has approved anything", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 3000 });
    expect(await codeOf(() => markReady(env.db, ctxOf(), ticket.ticketId))).toBe("VALIDATION");
  });

  it("sets ready_at and derives Listo from it", async () => {
    const ticketId = await readyTicket();
    const detail = getDetail(env.db, ctxOf(), ticketId);
    expect(detail.status).toBe("ready");
    expect(detail.readyAt).not.toBeNull();
  });
});

describe("telling the customer", () => {
  it("records who called and when, and sends nothing", async () => {
    const ticketId = await readyTicket();
    const detail = notifyCustomer(env.db, ctxOf(), { ticketId, method: "phone", note: "No contesta" });
    expect(detail.notifications).toHaveLength(1);
    expect(detail.notifications[0]).toMatchObject({ method: "phone", note: "No contesta", userName: "Ahmer" });
  });

  it("is repeatable, because calling twice is what actually happens", async () => {
    const ticketId = await readyTicket();
    notifyCustomer(env.db, ctxOf(), { ticketId, method: "phone", note: null });
    const detail = notifyCustomer(env.db, ctxOf(), { ticketId, method: "in_person", note: null });
    expect(detail.notifications).toHaveLength(2);
  });
});

/* ------------------------------------------------------------- collect */

describe("collecting", () => {
  it("creates the fiscal document in the till's own T1- series", async () => {
    const ticketId = await readyTicket();
    const result = collect(env.db, ctxOf(), {
      ticketId,
      tenders: [{ method: "cash", amountCents: 7900 }],
    });

    expect(result.docNumber).toBe("T1-000001");
    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, result.docId)).all()[0]!;
    expect(doc.docType).toBe("ticket");
    expect(doc.status).toBe("completed");
    expect(doc.totalCents).toBe(7900);
    // the revenue appears HERE and nowhere earlier: the R- stays at zero
    const repairDoc = env.db.select().from(s.documents).where(eq(s.documents.docType, "repair")).all()[0]!;
    expect(repairDoc.totalCents).toBe(0);
  });

  it("snapshots IVA21 onto every line", async () => {
    const ticketId = await readyTicket();
    const result = collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 7900 }] });
    const lines = env.db.select().from(s.documentLines).where(eq(s.documentLines.documentId, result.docId)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.taxRegime).toBe("IVA21");
    expect(lines[0]!.taxRateBp).toBe(2100);
    // 79,00 € gross → base + tax must add back to exactly the gross
    expect(lines[0]!.baseCents + lines[0]!.taxCents).toBe(7900);
  });

  it("settles at exactly the ticket's charged total, whatever is offered", async () => {
    const ticketId = await readyTicket();
    // an over-payment in cash is change, never a different total
    const result = collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 10000 }] });
    expect(result.totalCents).toBe(7900);
    expect(result.changeCents).toBe(2100);
  });

  it("refuses payment that does not cover the total", async () => {
    const ticketId = await readyTicket();
    expect(
      await codeOf(() => collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 5000 }] })),
    ).toBe("VALIDATION");
    expect(getDetail(env.db, ctxOf(), ticketId).status).toBe("ready");
  });

  it("refuses a ticket that is not ready", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    expect(
      await codeOf(() => collect(env.db, ctxOf(), { ticketId: ticket.ticketId, tenders: [] })),
    ).toBe("VALIDATION");
  });

  it("moves NO stock, because the part already left when it was fitted", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    addLine(env.db, ctxOf(), { kind: "inventory_part", ticketId: ticket.ticketId, productId: screenId, qty: 1 });
    recordApproval(env.db, ctxOf(), ticket.ticketId, "in_person");
    markReady(env.db, ctxOf(), ticket.ticketId);

    const before = env.db.select().from(s.stockMovements).all().length;
    collect(env.db, ctxOf(), { ticketId: ticket.ticketId, tenders: [{ method: "cash", amountCents: 8900 }] });
    // a second deduction here would take every part out of stock twice
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(before);
    expect(
      env.db
        .select()
        .from(s.productStock)
        .where(and(eq(s.productStock.productId, screenId), eq(s.productStock.locationId, env.ctx.locationId)))
        .all()[0]!.onHand,
    ).toBe(4);
  });

  it("links the two documents to each other", async () => {
    const ticketId = await readyTicket();
    const result = collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 7900 }] });
    const detail = getDetail(env.db, ctxOf(), ticketId);
    expect(detail.status).toBe("collected");
    expect(detail.collectionDocumentId).toBe(result.docId);
    expect(detail.collectionDocNumber).toBe("T1-000001");
  });
});

/* ------------------------------------------------------------ deposits */

describe("the deposit at collection", () => {
  it("is applied as a TENDER, never as a discount line", async () => {
    const ticketId = await readyTicket({ depositCents: 2000 });
    const result = collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 5900 }] });

    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, result.docId)).all()[0]!;
    // the goods keep their value; the deposit pays for them the way cash does
    expect(doc.totalCents).toBe(7900);
    const tenders = env.db.select().from(s.documentTenders).where(eq(s.documentTenders.documentId, result.docId)).all();
    expect(tenders.map((t) => [t.method, t.amountCents]).sort()).toEqual([
      ["cash", 5900],
      ["deposit", 2000],
    ]);
    expect(result.depositAppliedCents).toBe(2000);
  });

  it("covers the whole bill on its own, with no further tender", async () => {
    const ticketId = await readyTicket({ depositCents: 10000 }, 7900);
    const result = collect(env.db, ctxOf(), { ticketId, tenders: [] });
    // a deposit bigger than the bill applies only what is owed; the rest is a
    // debt the shop settles, not an overpayment the cashier must explain
    expect(result.depositAppliedCents).toBe(7900);
    expect(result.changeCents).toBe(0);
  });

  it("nets the ticket's cash rows to zero once it is resolved", async () => {
    const ticketId = await readyTicket({ depositCents: 2000 });
    expect(cashNet(ticketId)).toBe(2000);

    collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 5900 }] });
    // the money never left the drawer — it stopped being HELD and became
    // takings the T1 accounts for. Netting to zero is what stops Caja
    // counting the same 20 € twice.
    expect(cashNet(ticketId)).toBe(0);
    expect(cashOf(ticketId).map((r) => r.reason).sort()).toEqual(["repair_deposit", "repair_deposit_applied"]);
  });

  it("resolves exactly once — no second row appears for the same deposit", async () => {
    const ticketId = await readyTicket({ depositCents: 2000 });
    collect(env.db, ctxOf(), { ticketId, tenders: [{ method: "cash", amountCents: 5900 }] });
    const resolutions = cashOf(ticketId).filter((r) => r.reason !== "repair_deposit");
    expect(resolutions).toHaveLength(1);
    // and the ticket is closed, so nothing can resolve it again
    expect(await codeOf(() => collect(env.db, ctxOf(), { ticketId, tenders: [] }))).toBe("VALIDATION");
  });
});

/* -------------------------------------------------------- not repaired */

describe("closing a ticket unrepaired", () => {
  it("refuses while a consumed part is unresolved", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    addLine(env.db, ctxOf(), { kind: "inventory_part", ticketId: ticket.ticketId, productId: screenId, qty: 1 });

    expect(
      await codeOf(() =>
        markNotRepaired(env.db, ctxOf(), {
          ticketId: ticket.ticketId,
          reason: "unrepairable",
          resolutions: [],
          depositAction: "refund",
          chargeDiagnosisFee: false,
        }),
      ),
    ).toBe("VALIDATION");
    expect(getDetail(env.db, ctxOf(), ticket.ticketId).status).not.toBe("not_repaired");
  });

  it("puts a returned part back as a second movement", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    const detail = addLine(env.db, ctxOf(), {
      kind: "inventory_part",
      ticketId: ticket.ticketId,
      productId: screenId,
      qty: 1,
    });
    markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "customer_declined",
      resolutions: [{ lineId: detail.lines[0]!.id, action: "return" }],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });

    const movements = env.db.select().from(s.stockMovements).where(eq(s.stockMovements.productId, screenId)).all();
    expect(movements.map((m) => m.qty)).toEqual([-1, 1]);
    expect(movements[1]!.reason).toBe("reparación cerrada sin reparar");
  });

  it("keeps a charged part on the shelf's books and on the ticket", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    const detail = addLine(env.db, ctxOf(), {
      kind: "inventory_part",
      ticketId: ticket.ticketId,
      productId: screenId,
      qty: 1,
    });
    const result = markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "unrepairable",
      resolutions: [{ lineId: detail.lines[0]!.id, action: "charge" }],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });

    // it went into the device and is not coming back out
    expect(env.db.select().from(s.stockMovements).where(eq(s.stockMovements.productId, screenId)).all()).toHaveLength(1);
    expect(result.detail.lines).toHaveLength(1);
    expect(result.dueCents).toBe(8900);
  });

  it("refuses a diagnosis fee that was never announced", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    // the snapshot is zero, so there is nothing the customer was told about
    expect(
      await codeOf(() =>
        markNotRepaired(env.db, ctxOf(), {
          ticketId: ticket.ticketId,
          reason: "unrepairable",
          resolutions: [],
          depositAction: "refund",
          chargeDiagnosisFee: true,
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("charges a fee that WAS announced, from the ticket's own snapshot", async () => {
    env.db
      .insert(s.settings)
      .values({ tenantId: env.ctx.tenantId, key: "repairDiagnosisFeeCents", value: "1500", updatedAt: new Date() })
      .run();
    const ticket = await createTicket(env.db, ctxOf(), intake());
    const result = markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "unrepairable",
      resolutions: [],
      depositAction: "refund",
      chargeDiagnosisFee: true,
    });
    expect(result.diagnosisFeeCents).toBe(1500);
  });

  it("refunds the deposit, and the cash rows net to zero", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake({ depositCents: 2000 }));
    const result = markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "customer_declined",
      resolutions: [],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });
    expect(result.depositRefundedCents).toBe(2000);
    expect(result.depositAppliedCents).toBe(0);
    // the money physically left the drawer this time
    expect(cashNet(ticket.ticketId)).toBe(0);
    expect(cashOf(ticket.ticketId).map((r) => r.reason).sort()).toEqual(["repair_deposit", "repair_deposit_refund"]);
  });

  it("splits a deposit larger than what is owed, resolving all of it", async () => {
    env.db
      .insert(s.settings)
      .values({ tenantId: env.ctx.tenantId, key: "repairDiagnosisFeeCents", value: "1500", updatedAt: new Date() })
      .run();
    const ticket = await createTicket(env.db, ctxOf(), intake({ depositCents: 2000 }));
    const result = markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "unrepairable",
      resolutions: [],
      depositAction: "apply_fee",
      chargeDiagnosisFee: true,
    });

    // 15,00 € covers the fee, 5,00 € goes back — and every cent is accounted for
    expect(result.depositAppliedCents).toBe(1500);
    expect(result.depositRefundedCents).toBe(500);
    expect(result.dueCents).toBe(0);
    expect(cashNet(ticket.ticketId)).toBe(0);
  });

  it("leaves the ticket terminal, with a reason", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    const result = markNotRepaired(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      reason: "abandoned",
      resolutions: [],
      depositAction: "refund",
      chargeDiagnosisFee: false,
    });
    expect(result.detail.status).toBe("not_repaired");
    expect(result.detail.notRepairedReason).toBe("abandoned");
    // nothing more can happen to it
    expect(
      await codeOf(() => addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "x", chargeCents: 100 })),
    ).toBe("VALIDATION");
  });
});

/* --------------------------------------------------------- permissions */

describe("who may close a ticket unrepaired", () => {
  const call = async (channel: string, payload?: unknown, approval?: unknown): Promise<unknown> =>
    handlers.get(channel)!({}, payload, approval);

  it("asks for an owner's PIN when a cashier tries", async () => {
    const cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    const ticket = await createTicket(env.db, ctxOf(), intake());
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });

    // it moves money — a deposit refunded, a fee charged, parts written off
    expect(
      await codeOf(() =>
        call("repair:markNotRepaired", {
          ticketId: ticket.ticketId,
          reason: "unrepairable",
          resolutions: [],
          depositAction: "refund",
          chargeDiagnosisFee: false,
        }),
      ),
    ).toBe("APPROVAL_REQUIRED");
    expect(getDetail(env.db, ctxOf(), ticket.ticketId).status).toBe("received");
  });

  it("goes through with one", async () => {
    const cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    const ticket = await createTicket(env.db, ctxOf(), intake());
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });

    expect(
      await codeOf(() =>
        call(
          "repair:markNotRepaired",
          {
            ticketId: ticket.ticketId,
            reason: "unrepairable",
            resolutions: [],
            depositAction: "refund",
            chargeDiagnosisFee: false,
          },
          { userId: owner.id, pin: "8317" },
        ),
      ),
    ).toBe("OK");
  });
});
