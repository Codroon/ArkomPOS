/**
 * The approval layer against a REAL database.
 *
 * Dual attribution is the reason this slice exists, so it is checked against
 * actual oplog rows rather than a mock: "Ana discounted this phone" and "Ana
 * discounted this phone and Ahmer approved it" are different facts and only the
 * second settles an argument.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { parseIpcError, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-approval-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Test", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  const groupId = uuidv7();
  db.insert(s.productGroups)
    .values({ id: groupId, tenantId: ids.tenantId, name: "Protectores", sortOrder: 0, createdAt: now })
    .run();
  return { db, ctx: { ...ids, userId: null }, groupId };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };
let cashier: { id: string };

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
  registerIpcHandlers(env.db);
});

/** The handler returns unknown; every caller here awaits it. */
const call = async (channel: string, payload?: unknown, approval?: unknown): Promise<unknown> =>
  handlers.get(channel)!({}, payload, approval);

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/** A product a cashier may create only with an owner's PIN. */
const product = (over: Record<string, unknown> = {}) => ({ ...NEW_PRODUCT, groupId: env.groupId, ...over });

const NEW_PRODUCT = {
  name: "Funda de prueba",
  barcode: "8437123000900",
  costCents: 200,
  priceCents: 990,
  taxRegime: "IVA21" as const,
  itemType: "stocked" as const,
  reorderPoint: 0,
  lowStockThreshold: 0,
  active: true,
};

describe("approval", () => {
  it("asks for it when a cashier lacks the permission", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await codeOf(() => call("catalog:save", product()))).toBe("APPROVAL_REQUIRED");
  });

  it("never asks when the user already holds it", async () => {
    // an owner doing this themselves must not see a keypad (spec E7)
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    expect(await codeOf(() => call("catalog:save", product()))).toBe("OK");
  });

  it("executes and stamps BOTH ids when an owner authorises", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    await call("catalog:save", product(), { userId: owner.id, pin: "8317" });

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((o) => o.entity === "product" && o.action === "create")
      .pop()!;

    expect(entry.userId).toBe(cashier.id); // who did it
    expect(entry.authorizedByUserId).toBe(owner.id); // who allowed it
  });

  it("refuses a wrong approver PIN and leaves the action undone", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await codeOf(() => call("catalog:save", product(), { userId: owner.id, pin: "9999" }))).toBe(
      "INVALID_PIN",
    );
    expect(env.db.select().from(s.products).all()).toHaveLength(0);
  });

  it("refuses an approver who could not do it themselves", async () => {
    // a cashier cannot authorise for another cashier
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await codeOf(() => call("catalog:save", product(), { userId: cashier.id, pin: "5162" }))).toBe(
      "PERMISSION_DENIED",
    );
  });

  it("logs the denial when the approver's PIN is wrong", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    await codeOf(() => call("catalog:save", product(), { userId: owner.id, pin: "9999" }));

    const denied = env.db.select().from(s.oplog).all().filter((o) => o.action === "approval_denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]!.entityId).toBe(owner.id);
  });

  it("logs the grant, and records who asked", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    await call("catalog:save", product(), { userId: owner.id, pin: "8317" });

    const granted = env.db.select().from(s.oplog).all().filter((o) => o.action === "approval_granted");
    expect(granted).toHaveLength(1);
    expect((granted[0]!.after as Record<string, unknown>).requestedByUserId).toBe(cashier.id);
  });

  it("is single-use: the next attempt asks again", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    await call("catalog:save", product(), { userId: owner.id, pin: "8317" });
    // nothing was remembered — a five-minute window is what gets exploited
    expect(
      await codeOf(() => call("catalog:save", product({ name: "Otra funda", barcode: "8437123000901" }))),
    ).toBe("APPROVAL_REQUIRED");
  });
});

describe("the actor always reaches the oplog", () => {
  it("stamps the session's user on an ordinary write", async () => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    await call("catalog:save", product());

    const created = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((o) => o.entity === "product" && o.action === "create")
      .pop()!;
    expect(created.userId).toBe(owner.id);
    expect(created.authorizedByUserId).toBeNull(); // nobody had to approve it
  });

  it("ignores a userId in the payload", async () => {
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: { "catalog.create": true } });
    // the renderer sends a spoofed actor alongside a legitimate request
    await call("catalog:save", product({ userId: owner.id }));

    const created = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((o) => o.entity === "product" && o.action === "create")
      .pop()!;
    expect(created.userId).toBe(cashier.id); // the session, not the payload
  });
});

describe("last-owner protection", () => {
  it("refuses to deactivate the only active owner", async () => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    expect(await codeOf(() => call("users:update", { id: owner.id, active: false }))).toBe("LAST_OWNER");
  });

  it("refuses to demote the only active owner", async () => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    expect(await codeOf(() => call("users:update", { id: owner.id, role: "cashier" }))).toBe("LAST_OWNER");
  });

  it("allows it once a second owner exists", async () => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    await call("users:create", { name: "Segundo", role: "owner", pin: "7294", overrides: {} });
    expect(await codeOf(() => call("users:update", { id: owner.id, active: false }))).toBe("OK");
  });
});

describe("weak PINs are refused at the door", () => {
  it.each(["1234", "1111", "0000", "123456"])("rejects %s", async (pin) => {
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    expect(await codeOf(() => call("users:create", { name: `U${pin}`, role: "cashier", pin, overrides: {} }))).toBe(
      "WEAK_PIN",
    );
  });
});
