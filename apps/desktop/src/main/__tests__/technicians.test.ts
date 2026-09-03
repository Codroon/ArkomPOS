/**
 * Technicians are assignable names, not app users — ADR-0012/0014 amendments.
 *
 * The shop has one login and three people at the bench. What this file pins is
 * the boundary that makes that safe: a row with no PIN can never authenticate,
 * and it is refused in MAIN rather than merely absent from the login screen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { parseIpcError, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser, listLoginUsers, listTechnicians } from "../auth/users";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-tech-"));
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
let cashier: { id: string };
let tech: { id: string };
const ctxOf = () => ({ ...env.ctx, userId: owner.id });

async function call(channel: string, payload?: unknown): Promise<string> {
  try {
    await handlers.get(channel)!({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
}
const get = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;

/** The sentence the SHOP reads, not the code behind it. */
async function message(channel: string, payload?: unknown): Promise<string> {
  try {
    await handlers.get(channel)!({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.message ?? String(err);
  }
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
  tech = createUser(env.db, env.ctx, { name: "Nuria", role: "technician", pin: null }).user;
  registerIpcHandlers(env.db);
  /* a printer, because every act that hands a person a document needs one
     since v0.18.1 — including buying a used phone */
  env.db
    .insert(s.settings)
    .values({ tenantId: env.ctx.tenantId, key: "printerName", value: "Impresora de pruebas", updatedAt: new Date() })
    .run();
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
});

/* ------------------------------------------------------- creating */

describe("creating a technician", () => {
  /* THROUGH THE CHANNEL, not the repo function.
     v0.14.1 shipped with `pin: PinSchema` still on the request while the repo
     happily took null, so the Usuarios dialog was refused by Zod before it
     reached any of the logic below — and every test here passed, because they
     all called createUser() directly. A boundary you never cross in a test is a
     boundary you have not tested. */
  it("is accepted over IPC with no PIN in the payload", async () => {
    expect(await call("users:create", { name: "Marta", role: "technician", pin: null })).toBe("OK");
    expect(await call("users:create", { name: "Luis", role: "technician" })).toBe("OK");

    const rows = env.db.select().from(s.users).all().filter((u) => u.role === "technician");
    expect(rows.map((u) => u.name).sort()).toEqual(["Luis", "Marta", "Nuria"]);
    expect(rows.every((u) => u.pinHash === null)).toBe(true);
  });

  it("refuses a PIN-less cashier or owner at the contract, not just in the repo", async () => {
    expect(await call("users:create", { name: "Nadie", role: "cashier", pin: null })).toBe("VALIDATION");
    expect(await call("users:create", { name: "Nadie", role: "owner" })).toBe("VALIDATION");
  });

  it("still refuses a malformed PIN for somebody who does sign in", async () => {
    expect(await call("users:create", { name: "Nadie", role: "cashier", pin: "12" })).toBe("VALIDATION");
  });

  it("never puts Zod's own words in front of the shop", async () => {
    /* what shipped: "Invalid input: expected string, received null" on the Add
       a technician dialog. A wrong TYPE is our bug, so it goes to the console
       and the counter reads one plain sentence. */
    const structural = await message("users:create", { name: "Nadie", role: "cashier", pin: 1234 });
    expect(structural).toBe("Datos no válidos.");
    expect(structural).not.toMatch(/expected|received|Invalid input/i);

    // a rule somebody wrote on purpose still speaks for itself
    expect(await message("users:create", { name: "Nadie", role: "cashier", pin: "12" })).toMatch(/PIN/);
    expect(await message("users:create", { name: "Nadie", role: "cashier", pin: null })).toMatch(/PIN/);
  });

  it("stores no PIN at all", () => {
    const row = env.db.select().from(s.users).where(eq(s.users.id, tech.id)).all()[0]!;
    expect(row.role).toBe("technician");
    expect(row.pinHash).toBeNull();
  });

  it("refuses a PIN-less anything else", () => {
    expect(() => createUser(env.db, env.ctx, { name: "Nadie", role: "cashier", pin: null })).toThrow();
    expect(() => createUser(env.db, env.ctx, { name: "Nadie", role: "owner", pin: null })).toThrow();
  });

  it("still refuses a duplicate name", () => {
    expect(() => createUser(env.db, env.ctx, { name: "Nuria", role: "technician", pin: null })).toThrow();
  });

  it("becomes an ordinary login user the moment a PIN is set", async () => {
    expect(listLoginUsers(env.db, ctxOf()).map((u) => u.id)).not.toContain(tech.id);
    /* the shop-#2 path, and it falls out of the same rule: the login list is
       "has a PIN", so setting one is the whole change (ADR-0012 amendment) */
    expect(await call("users:resetPin", { id: tech.id, newPin: "7391" })).toBe("OK");
    expect(listLoginUsers(env.db, ctxOf()).map((u) => u.id)).toContain(tech.id);
  });
});

/* ---------------------------------------------------------- login */

describe("who can sign in", () => {
  it("lists only users holding a PIN", async () => {
    const rows = await get<Array<{ id: string; name: string }>>("auth:users", {});
    expect(rows.map((u) => u.name).sort()).toEqual(["Ahmer", "Ana"]);
    expect(rows.map((u) => u.id)).not.toContain(tech.id);
  });

  it("refuses a technician even when the caller names them directly", async () => {
    /* the list not offering the tile is a courtesy; THIS is the control. A
       renderer that asked anyway gets the same refusal an unknown user gets */
    expect(await call("auth:login", { userId: tech.id, pin: "0000" })).toBe("INVALID_PIN");
    expect(await call("auth:login", { userId: tech.id, pin: "" })).toBe("VALIDATION");
  });
});

/* -------------------------------------------------------- pickers */

describe("the technician picker's source", () => {
  it("lists technicians and nobody else", async () => {
    const rows = await get<Array<{ id: string; name: string }>>("users:technicians", {});
    expect(rows).toEqual([{ id: tech.id, name: "Nuria" }]);
  });

  it("excludes cashiers and owners however capable they are", () => {
    const ids = listTechnicians(env.db, ctxOf()).map((u) => u.id);
    expect(ids).not.toContain(owner.id);
    expect(ids).not.toContain(cashier.id);
  });

  it("excludes a deactivated technician", async () => {
    await call("users:update", { id: tech.id, active: false });
    expect(listTechnicians(env.db, ctxOf())).toEqual([]);
  });

  it("is readable by anybody who can see a repair, not just an owner", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await call("users:technicians", {})).toBe("OK");
    // and users:list stays owner-only, because it carries more than names
    expect(await call("users:list", {})).toBe("PERMISSION_DENIED");
  });
});

/* ------------------------------------------------------ attribution */

describe("who acted", () => {
  it("records the logged-in user, never the technician assigned", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    const customer = await get<{ id: string }>("customer:upsert", { name: "Joan", phone: "671220918" });
    const ticket = await get<{ ticketId: string }>("repair:create", {
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
      depositMethod: "cash",
      authorizedCapCents: null,
      assignedUserId: tech.id,
    });

    expect(await call("repair:assign", { ticketId: ticket.ticketId, userId: tech.id })).toBe("OK");

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "repair_ticket")
      .at(-1)!;
    /* A technician never ACTS — they are assigned. Every recorded action keeps
       the person who was signed in (ADR-0014 amendment). */
    expect(entry.userId).toBe(cashier.id);
    expect(entry.userId).not.toBe(tech.id);

    const row = env.db.select().from(s.repairTickets).all()[0]!;
    expect(row.assignedUserId).toBe(tech.id);
  });
});
