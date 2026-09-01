/**
 * The list, the board, and the two reads the ficha needs.
 *
 * The rule worth pinning here is the counts one: they are computed over
 * everything BEFORE the filters run, so a strip whose numbers shrank as you
 * used it could never happen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { AppError, parseIpcError, uuidv7, type RepairCreateRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx } from "../repos/shift";
import {
  addLine,
  assignTicket,
  board,
  createTicket,
  editTicket,
  getDetail,
  listTickets,
  peekTicket,
  recordApproval,
  revealPasscode,
  upsertCustomer,
} from "../repos/repair";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const DAY = 24 * 60 * 60 * 1000;

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-repair-list-"));
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
let tech: { id: string };
let customerId: string;

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

function intake(over: Partial<RepairCreateRequest> = {}): RepairCreateRequest {
  return {
    customerId,
    deviceDescription: "Apple iPhone 11 64GB",
    imei: null,
    reportedFault: "Pantalla rota",
    conditionAtIntake: null,
    damage: { screen: false, back: false, dents: false, water: false },
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
  tech = createUser(env.db, env.ctx, { name: "Nadia", role: "technician", pin: "4471" }).user;
  registerIpcHandlers(env.db);
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
  customerId = upsertCustomer(env.db, ctxOf(), { name: "Joan Puig", phone: "+34 671 220 918" }).id;
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

describe("the list", () => {
  it("counts every status over EVERYTHING, whatever the filter", async () => {
    const a = await createTicket(env.db, ctxOf(), intake());
    await createTicket(env.db, ctxOf(), intake({ deviceDescription: "Xiaomi Redmi Note 12" }));
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: a.ticketId, description: "Mano de obra", chargeCents: 3000 });

    const filtered = listTickets(env.db, ctxOf(), { status: "quoted" });
    expect(filtered.rows).toHaveLength(1);
    // the strip must not shrink as you use it, or it becomes a maze
    expect(filtered.counts.received).toBe(1);
    expect(filtered.counts.quoted).toBe(1);
    expect(filtered.openCount).toBe(2);
  });

  it("searches by number, customer, phone, IMEI and device", async () => {
    await createTicket(env.db, ctxOf(), intake({ imei: "353474049489560" }));
    const hits = (term: string) => listTickets(env.db, ctxOf(), { search: term }).rows.length;
    expect(hits("R-000001")).toBe(1);
    expect(hits("joan")).toBe(1);
    expect(hits("671 220")).toBe(1);
    expect(hits("353474049489560")).toBe(1);
    expect(hits("iphone")).toBe(1);
    expect(hits("nokia")).toBe(0);
  });

  it("filters by technician and by nobody at all", async () => {
    const a = await createTicket(env.db, ctxOf(), intake());
    await createTicket(env.db, ctxOf(), intake());
    assignTicket(env.db, ctxOf(), a.ticketId, tech.id);

    expect(listTickets(env.db, ctxOf(), { technicianId: tech.id }).rows).toHaveLength(1);
    // "nobody has picked this up" is a real filter, not an absence
    expect(listTickets(env.db, ctxOf(), { unassignedOnly: true }).rows).toHaveLength(1);
  });

  it("flags a ticket promised in the past, and stops once it is ready", async () => {
    const yesterday = Date.now() - DAY;
    const ticket = await createTicket(env.db, ctxOf(), intake({ promisedDate: yesterday }));
    expect(listTickets(env.db, ctxOf()).rows[0]!.overdue).toBe(true);
    expect(listTickets(env.db, ctxOf(), { overdueOnly: true }).rows).toHaveLength(1);

    env.db.update(s.repairTickets).set({ readyAt: new Date(), status: "ready" }).where(eq(s.repairTickets.id, ticket.ticketId)).run();
    // a device sitting on the ready shelf is not late; the customer is
    expect(listTickets(env.db, ctxOf()).rows[0]!.overdue).toBe(false);
  });

  it("counts the days a device has been in the shop", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    env.db
      .update(s.repairTickets)
      .set({ createdAt: new Date(Date.now() - 4 * DAY) })
      .where(eq(s.repairTickets.id, ticket.ticketId))
      .run();
    expect(listTickets(env.db, ctxOf()).rows[0]!.daysOpen).toBe(4);
  });
});

describe("the board", () => {
  it("gives every status a column, in order, even when empty", async () => {
    await createTicket(env.db, ctxOf(), intake());
    const result = board(env.db, ctxOf());
    expect(result.columns.map((c) => c.status)).toEqual([
      "received",
      "quoted",
      "waiting_part",
      "in_repair",
      "ready",
      "collected",
      "not_repaired",
    ]);
    expect(result.columns[0]!.cards).toHaveLength(1);
    expect(result.columns[1]!.cards).toHaveLength(0);
  });

  it("measures days in the CURRENT status, not since intake", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    // the device arrived a week ago; the status changed today
    env.db
      .update(s.repairTickets)
      .set({ createdAt: new Date(Date.now() - 7 * DAY) })
      .where(eq(s.repairTickets.id, ticket.ticketId))
      .run();
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 1000 });

    const card = board(env.db, ctxOf()).columns.find((c) => c.status === "quoted")!.cards[0]!;
    expect(card.daysInStatus).toBe(0);
    expect(listTickets(env.db, ctxOf()).rows[0]!.daysOpen).toBe(7);
  });

  it("filters to one technician's bench", async () => {
    const a = await createTicket(env.db, ctxOf(), intake());
    await createTicket(env.db, ctxOf(), intake());
    assignTicket(env.db, ctxOf(), a.ticketId, tech.id);
    expect(board(env.db, ctxOf(), { technicianId: tech.id }).openCount).toBe(1);
    expect(board(env.db, ctxOf(), { unassignedOnly: true }).openCount).toBe(1);
  });
});

describe("the passcode on the ficha", () => {
  it("reaches the screen, because the technician has to open the phone", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake({ devicePasscode: "0451" }));
    expect(getDetail(env.db, ctxOf(), ticket.ticketId).devicePasscode).toBe("0451");
  });

  it("records WHO looked and never the value", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake({ devicePasscode: "0451" }));
    revealPasscode(env.db, ctxOf(), ticket.ticketId);

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .find((e) => e.action === "reveal_passcode")!;
    expect(entry.userId).toBe(owner.id);
    expect(JSON.stringify(entry)).not.toContain("0451");
  });

  it("is stripped from BOTH halves of an edit entry", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake({ devicePasscode: "0451" }));
    editTicket(env.db, ctxOf(), { ticketId: ticket.ticketId, devicePasscode: "9999" });

    // an update carrying the OLD value leaks it just as surely as the new one
    const entries = env.db.select().from(s.oplog).all();
    expect(JSON.stringify(entries)).not.toContain("0451");
    expect(JSON.stringify(entries)).not.toContain("9999");
    expect(env.db.select().from(s.repairTickets).all()[0]!.devicePasscode).toBe("9999");
  });

  it("never appears in the list or the peek", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake({ devicePasscode: "0451" }));
    expect(JSON.stringify(listTickets(env.db, ctxOf()))).not.toContain("0451");
    expect(JSON.stringify(peekTicket(env.db, ctxOf(), ticket.ticketId))).not.toContain("0451");
    expect(JSON.stringify(board(env.db, ctxOf()))).not.toContain("0451");
  });
});

describe("editing what the counter took down", () => {
  it("corrects the fields, and refuses an IMEI that is not one", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    const fixed = editTicket(env.db, ctxOf(), {
      ticketId: ticket.ticketId,
      imei: "353474049489560",
      reportedFault: "No carga, y el altavoz falla",
    });
    expect(fixed.device.imei).toBe("353474049489560");
    expect(fixed.device.reportedFault).toBe("No carga, y el altavoz falla");
    expect(await codeOf(() => editTicket(env.db, ctxOf(), { ticketId: ticket.ticketId, imei: "123" }))).toBe(
      "VALIDATION",
    );
  });

  it("cannot touch a closed ticket", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    env.db
      .update(s.repairTickets)
      .set({ notRepairedAt: new Date(), notRepairedReason: "unrepairable", status: "not_repaired" })
      .where(eq(s.repairTickets.id, ticket.ticketId))
      .run();
    expect(
      await codeOf(() => editTicket(env.db, ctxOf(), { ticketId: ticket.ticketId, reportedFault: "otra" })),
    ).toBe("VALIDATION");
  });
});

describe("assignment", () => {
  it("hands a ticket over, and back to nobody", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    expect(assignTicket(env.db, ctxOf(), ticket.ticketId, tech.id).assignedUserName).toBe("Nadia");
    // Sin asignar is a state, not an absence
    expect(assignTicket(env.db, ctxOf(), ticket.ticketId, null).assignedUserName).toBeNull();
  });

  it("refuses a user who does not exist", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    expect(await codeOf(() => assignTicket(env.db, ctxOf(), ticket.ticketId, uuidv7()))).toBe("VALIDATION");
  });
});

describe("the peek behind a repair_part_out movement", () => {
  it("summarises the ticket the way the screen does", async () => {
    const ticket = await createTicket(env.db, ctxOf(), intake());
    addLine(env.db, ctxOf(), { kind: "labor", ticketId: ticket.ticketId, description: "M.O.", chargeCents: 3000 });
    recordApproval(env.db, ctxOf(), ticket.ticketId, "in_person");

    const peek = peekTicket(env.db, ctxOf(), ticket.ticketId);
    expect(peek.docNumber).toBe("R-000001");
    expect(peek.status).toBe("in_repair");
    expect(peek.customerName).toBe("Joan Puig");
    expect(peek.totalCents).toBe(3000);
    expect(peek.lines).toHaveLength(1);
  });
});

describe("the technician role", () => {
  it("is a real role the till can create a user with", () => {
    const row = env.db.select().from(s.users).where(eq(s.users.id, tech.id)).all()[0]!;
    expect(row.role).toBe("technician");
  });
});
