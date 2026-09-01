/**
 * Money needs an open drawer — ADR-0015 §9.
 *
 * These go through the registered handlers exactly as the renderer does, because
 * the gate is only worth anything if it sits on the real path. The refusal is
 * its own code so the Sale screen can answer it with a dialog instead of an
 * error: blocking a sale to teach somebody about process is how a till gets
 * bypassed with a paper notebook.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { IPC_CHANNELS, imeiWithCheckDigit, parseIpcError, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { SHIFT_REQUIRED_CHANNELS, registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const IMEI = imeiWithCheckDigit("35209411880318");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-shiftgate-"));
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
let productId: string;
let supplierId: string;

/** Call a channel the way the preload does; return the typed code. */
async function call(channel: string, payload?: unknown): Promise<string> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`not registered: ${channel}`);
  try {
    await fn({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
}

const purchasePayload = {
  device: {
    brand: "Apple",
    model: "iPhone SE 2020",
    storage: "64GB",
    color: "Blanco",
    grade: "B",
    batteryPct: 86,
    imei: IMEI,
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
};

function intakePayload(depositCents: number) {
  return {
    customerId: "",
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
    depositCents,
    depositMethod: "cash",
    authorizedCapCents: null,
    assignedUserId: null,
  };
}

beforeEach(async () => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });

  const groupId = uuidv7();
  productId = uuidv7();
  const now = new Date();
  env.db.insert(s.productGroups).values({ id: groupId, tenantId: env.ctx.tenantId, name: "Accesorios", sortOrder: 1, createdAt: now }).run();
  env.db
    .insert(s.products)
    .values({
      id: productId,
      tenantId: env.ctx.tenantId,
      groupId,
      name: "Funda",
      itemType: "stocked",
      priceCents: 1000,
      costCents: 400,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      barcode: "8412345009990",
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  env.db
    .insert(s.productStock)
    .values({ productId, locationId: env.ctx.locationId, onHand: 10, updatedAt: now })
    .run();
  supplierId = uuidv7();
  env.db
    .insert(s.suppliers)
    .values({ id: supplierId, tenantId: env.ctx.tenantId, name: "Distribuidora", createdAt: now })
    .run();
});

const openTheTill = () => call("cash:open", { floatCents: 20000, breakdown: null });

/* ------------------------------------------------------- the list */

describe("the declared list", () => {
  it("names every channel that always moves money", () => {
    // a pin: adding a money channel without the gate should fail the build the
    // same way one without a permission does
    expect([...SHIFT_REQUIRED_CHANNELS].sort()).toEqual(
      ["cash:close", "cash:paidIn", "cash:paidOut", "cash:preview", "repair:collect", "sale:complete", "used:log"].sort(),
    );
  });

  it("names only channels that exist", () => {
    const unknown = [...SHIFT_REQUIRED_CHANNELS].filter((c) => !(IPC_CHANNELS as readonly string[]).includes(c));
    // cash:paidIn and friends land with their own slices; when they do, they are
    // already gated. Until then this asserts nothing is misspelled forever
    expect(unknown.every((c) => c.startsWith("cash:"))).toBe(true);
  });
});

/* -------------------------------------------------- what is refused */

describe("with no shift open", () => {
  it("refuses a sale", async () => {
    const draft = await handlers.get("sale:addLine")!({}, { productId, qty: 1 });
    const docId = (draft as { state: { docId: string } }).state.docId;
    expect(await call("sale:complete", { docId, tenders: [{ method: "cash", amountCents: 1000 }] })).toBe(
      "SHIFT_REQUIRED",
    );
  });

  it("refuses a used-device purchase", async () => {
    expect(await call("used:log", purchasePayload)).toBe("SHIFT_REQUIRED");
  });

  it("refuses a repair intake that takes a deposit", async () => {
    const customer = await handlers.get("customer:upsert")!({}, { name: "Joan", phone: "671220918" });
    const id = (customer as { id: string }).id;
    expect(await call("repair:create", { ...intakePayload(2000), customerId: id })).toBe("SHIFT_REQUIRED");
  });

  it("ALLOWS a repair intake that takes no money", async () => {
    // the device is in the shop either way; only the money needs a drawer
    const customer = await handlers.get("customer:upsert")!({}, { name: "Joan", phone: "671220918" });
    const id = (customer as { id: string }).id;
    expect(await call("repair:create", { ...intakePayload(0), customerId: id })).toBe("OK");
  });

  it("ALLOWS receiving a delivery", async () => {
    // a delivery is unpacked before the shop opens, and involves no drawer
    expect(
      await call("stock:add", {
        entries: [{ productId, qty: 3, unitCostCents: 400, supplierId }],
      }),
    ).toBe("OK");
  });

  it("ALLOWS catalogue work", async () => {
    expect(await call("catalog:list", {})).toBe("OK");
  });
});

/* ------------------------------------------------ what it unblocks */

describe("once a shift is open", () => {
  it("lets the same sale through, and stamps it", async () => {
    expect(await openTheTill()).toBe("OK");

    const draft = await handlers.get("sale:addLine")!({}, { productId, qty: 1 });
    const docId = (draft as { state: { docId: string } }).state.docId;
    expect(await call("sale:complete", { docId, tenders: [{ method: "cash", amountCents: 1000 }] })).toBe("OK");

    const shift = env.db.select().from(s.shifts).all()[0]!;
    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, docId)).all()[0]!;
    expect(doc.shiftId).toBe(shift.id);
  });

  it("lets a purchase through", async () => {
    await openTheTill();
    expect(await call("used:log", purchasePayload)).toBe("OK");
  });

  it("lets a deposit through", async () => {
    await openTheTill();
    const customer = await handlers.get("customer:upsert")!({}, { name: "Joan", phone: "671220918" });
    const id = (customer as { id: string }).id;
    expect(await call("repair:create", { ...intakePayload(2000), customerId: id })).toBe("OK");
  });

  it("refuses a second open, and the database refuses it too", async () => {
    await openTheTill();
    expect(await openTheTill()).toBe("VALIDATION");
    expect(env.db.select().from(s.shifts).all()).toHaveLength(1);
  });

  it("blocks money again once it is closed", async () => {
    await openTheTill();
    const shift = env.db.select().from(s.shifts).all()[0]!;
    env.db.update(s.shifts).set({ closedAt: new Date() }).where(eq(s.shifts.id, shift.id)).run();
    expect(await call("used:log", purchasePayload)).toBe("SHIFT_REQUIRED");
  });
});

/* ------------------------------------------------------- reading */

describe("cash:current", () => {
  it("is null before anyone opens the till", async () => {
    const state = await handlers.get("cash:current")!({}, {});
    expect(state).toBeNull();
  });

  it("reports who opened it, with what, and for how long", async () => {
    await openTheTill();
    const state = (await handlers.get("cash:current")!({}, {})) as {
      openedByName: string;
      openingFloatCents: number;
      openHours: number;
      closedAtMs: number | null;
    };
    expect(state.openedByName).toBe("Ahmer");
    expect(state.openingFloatCents).toBe(20000);
    expect(state.closedAtMs).toBeNull();
    expect(state.openHours).toBeLessThan(1);
  });

  it("refuses a float whose breakdown does not add up", async () => {
    // the total is the authority and the breakdown is evidence for it; two
    // numbers that can drift is what this design rejects everywhere
    expect(await call("cash:open", { floatCents: 20000, breakdown: { "2000": 3 } })).toBe("VALIDATION");
    expect(await call("cash:open", { floatCents: 20000, breakdown: { "2000": 10 } })).toBe("OK");
  });
});
