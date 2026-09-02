/**
 * The used-devices list and detail.
 *
 * Two things here are worth more than the rest: that the seller block is
 * ABSENT from the payload rather than hidden, and that the refurbishment cost
 * freezes the moment the device is shelved. The first is the whole of ADR-0013
 * §6; the second is what stops a posted stock movement and a unit's cost from
 * quietly disagreeing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { AppError, imeiWithCheckDigit, parseIpcError, uuidv7, type UsedLogRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { getUsedDevice, listUsedDevices, logPurchase, sendToInventory, setNeedsReview, setRefurbCost } from "../repos/used";
import { openShiftTx } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const IMEI_A = imeiWithCheckDigit("35209411880318");
const IMEI_B = imeiWithCheckDigit("86123456789012");
const IMEI_C = imeiWithCheckDigit("49015420323751");

const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA" +
  "AAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-used-detail-"));
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

function request(over: Partial<UsedLogRequest> = {}): UsedLogRequest {
  return {
    device: {
      brand: "Apple",
      model: "iPhone SE 2020",
      storage: "64GB",
      color: "Blanco",
      grade: "B",
      batteryPct: 86,
      imei: IMEI_A,
      accessories: { charger: true, box: false, cable: true, case: false },
    },
    seller: {
      name: "Imran Khan",
      phone: "+34 632 118 044",
      idType: "DNI",
      idNumber: "Y2841170F",
      channel: "private_individual",
    },
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

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
  registerIpcHandlers(env.db);
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
});

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.ipc.code;
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

describe("the list", () => {
  it("shows every device with a derived state", async () => {
    await logPurchase(env.db, ctxOf(), request());
    await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 12000 }),
    );

    const { rows, counts } = listUsedDevices(env.db, ctxOf());
    expect(rows).toHaveLength(2);
    expect(counts).toEqual({ held: 1, needs_review: 0, in_stock: 1, sold: 0 });
    expect(rows.map((r) => r.state).sort()).toEqual(["held", "in_stock"]);
  });

  it("moves a device to needs_review without touching its unit", async () => {
    const { purchaseId, unitId } = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), purchaseId, true);

    const { counts } = listUsedDevices(env.db, ctxOf());
    expect(counts.needs_review).toBe(1);
    expect(counts.held).toBe(0);
    // the flag is on the purchase; the unit is still simply held
    const unit = env.db.select().from(s.units).where(eq(s.units.id, unitId)).all()[0]!;
    expect(unit.status).toBe("held");
  });

  it("counts every state whatever the filter, so the strip stays navigable", async () => {
    await logPurchase(env.db, ctxOf(), request());
    await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 12000 }),
    );

    const filtered = listUsedDevices(env.db, ctxOf(), { state: "held" });
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.counts).toEqual({ held: 1, needs_review: 0, in_stock: 1, sold: 0 });
  });

  it("searches by IMEI, model, purchase number and barcode", async () => {
    await logPurchase(env.db, ctxOf(), request({ barcode: "2012345678909" }));
    await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B, brand: "Samsung", model: "Galaxy A52" } }),
    );

    const find = (search: string) => listUsedDevices(env.db, ctxOf(), { search }).rows;
    expect(find(IMEI_B)).toHaveLength(1);
    expect(find("galaxy")).toHaveLength(1);
    expect(find("C-000001")).toHaveLength(1);
    expect(find("2012345678909")).toHaveLength(1);
    expect(find("nothing here")).toHaveLength(0);
  });

  it("puts the newest purchase first", async () => {
    const first = await logPurchase(env.db, ctxOf(), request());
    const second = await logPurchase(env.db, ctxOf(), request({ device: { ...request().device, imei: IMEI_B } }));
    const rows = listUsedDevices(env.db, ctxOf()).rows;
    expect([rows[0]!.purchaseId, rows[1]!.purchaseId]).toEqual([second.purchaseId, first.purchaseId]);
  });
});

describe("the seller block", () => {
  it("is present for someone who may read it", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.seller?.name).toBe("Imran Khan");
    expect(detail.seller?.idNumber).toBe("Y2841170F");
    expect(detail.canViewSeller).toBe(true);
  });

  it("is ABSENT from the payload for someone who may not", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, false);

    expect(detail.seller).toBeNull();
    expect(detail.canViewSeller).toBe(false);
    // not hidden with CSS: the words are not in the payload at all
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("Imran");
    expect(serialized).not.toContain("Y2841170F");
    expect(serialized).not.toContain("632 118 044");
  });

  it("withholds the ID photo with the block it belongs to", async () => {
    const { purchaseId } = await logPurchase(
      env.db,
      ctxOf(),
      request({
        photos: [
          { kind: "front", dataUrl: JPEG_1PX },
          { kind: "seller_id", dataUrl: JPEG_1PX },
        ],
      }),
    );

    const withPermission = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(withPermission.photos.map((p) => p.kind).sort()).toEqual(["front", "seller_id"]);

    // a photograph of somebody's DNI is the seller block in image form
    const without = await getUsedDevice(env.db, ctxOf(), purchaseId, false);
    expect(without.photos.map((p) => p.kind)).toEqual(["front"]);
  });

  it("is decided by the handler from the session, not by the payload", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());

    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    const asCashier = (await handlers.get("used:get")!({}, { purchaseId })) as { seller: unknown };
    expect(asCashier.seller).toBeNull();

    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
    const asOwner = (await handlers.get("used:get")!({}, { purchaseId })) as { seller: { name: string } | null };
    expect(asOwner.seller?.name).toBe("Imran Khan");
  });
});

describe("the detail", () => {
  it("carries the photos as data URLs, because the renderer never reads disk", async () => {
    const { purchaseId } = await logPurchase(
      env.db,
      ctxOf(),
      request({ photos: [{ kind: "front", dataUrl: JPEG_1PX }] }),
    );
    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.photos).toHaveLength(1);
    expect(detail.photos[0]!.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("builds a history from the oplog, newest first, naming the actor", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), purchaseId, true);

    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.timeline.length).toBeGreaterThanOrEqual(2);
    expect(detail.timeline[0]!.action).toBe("flag_review");
    expect(detail.timeline[0]!.actorName).toBe("Ahmer");

    /* the purchase, the unit it created and the document are three separate
       facts, and the history has to be able to tell them apart — a print is
       logged against the document, and "did that slip ever come out?" is
       exactly what someone opens this pane to answer */
    const kinds = detail.timeline.map((e) => `${e.entity}:${e.action}`);
    expect(kinds).toContain("used_purchase:create");
    expect(kinds).toContain("unit:create");
    expect(kinds).toContain("document:create");
  });

  it("reports the total cost as buy + refurb", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    setRefurbCost(env.db, ctxOf(), purchaseId, 1500);
    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.refurbCostCents).toBe(1500);
    expect(detail.unitCostCents).toBe(9500);
  });

  it("links a sold device to the sale that sold it", async () => {
    const { purchaseId, unitId } = await logPurchase(
      env.db,
      ctxOf(),
      request({ action: "inventory", sellPriceCents: 12000 }),
    );
    // stand in for the sale path: the unit is marked sold against a document
    const saleId = uuidv7();
    const now = new Date();
    env.db
      .insert(s.documents)
      .values({
        id: saleId,
        tenantId: env.ctx.tenantId,
        locationId: env.ctx.locationId,
        terminalId: env.ctx.terminalId,
        docType: "ticket",
        status: "completed",
        docNumber: "T1-000045",
        createdAt: now,
      })
      .run();
    env.db.update(s.units).set({ status: "sold", soldDocumentId: saleId }).where(eq(s.units.id, unitId)).run();

    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.state).toBe("sold");
    expect(detail.soldDocNumber).toBe("T1-000045");
    expect(detail.editable).toBe(false);
  });
});

describe("the refurbishment cost", () => {
  it("is editable while the device is held, and moves the unit's cost with it", async () => {
    const { purchaseId, unitId } = await logPurchase(env.db, ctxOf(), request());
    setRefurbCost(env.db, ctxOf(), purchaseId, 2000);

    const unit = env.db.select().from(s.units).where(eq(s.units.id, unitId)).all()[0]!;
    expect(unit.costCents).toBe(10000);
    // nothing is posted while it is held, so the cost is still just a number
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(0);
  });

  it("freezes once the device is in stock", async () => {
    const { purchaseId } = await logPurchase(
      env.db,
      ctxOf(),
      request({ action: "inventory", sellPriceCents: 12000 }),
    );
    // the figure is already inside a posted movement, and ADR-0004 forbids
    // rewriting one
    expect(await codeOf(async () => setRefurbCost(env.db, ctxOf(), purchaseId, 1500))).toBe("VALIDATION");
  });

  it("needs its own permission", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    const blocked = createUser(env.db, env.ctx, {
      name: "Nuevo",
      role: "cashier",
      pin: "7409",
      overrides: { "usedDevices.editRefurbCost": false },
    }).user;
    startSession({
      id: blocked.id,
      name: "Nuevo",
      role: "cashier",
      overrides: { "usedDevices.editRefurbCost": false },
    });
    expect(
      await codeOf(async () => handlers.get("used:setRefurbCost")!({}, { purchaseId, refurbCostCents: 500 })),
    ).toBe("PERMISSION_DENIED");
  });
});

describe("sending a held device to the shelf", () => {
  it("posts one movement at buy + refurb cost and prices the unit", async () => {
    const { purchaseId, unitId } = await logPurchase(env.db, ctxOf(), request());
    setRefurbCost(env.db, ctxOf(), purchaseId, 1500);

    const result = sendToInventory(env.db, ctxOf(), purchaseId, 15000);
    expect(result.unitCostCents).toBe(9500);

    const movements = env.db.select().from(s.stockMovements).all();
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe("tradein_in");
    expect(movements[0]!.unitCostCents).toBe(9500);

    const unit = env.db.select().from(s.units).where(eq(s.units.id, unitId)).all()[0]!;
    expect(unit.status).toBe("in_stock");
    expect(unit.salePriceCents).toBe(15000);
    expect(unit.costCents).toBe(9500);

    const stock = env.db.select().from(s.productStock).all();
    expect(stock[0]!.onHand).toBe(1);
  });

  it("clears the review flag once somebody confirms the review", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), purchaseId, true);
    /* Shelving used to clear the flag on its own, which made the flag's only
       consequence its own disappearance. It is now answered, not absorbed
       (ADR-0013 amendment) — the gate itself is covered below. */
    sendToInventory(env.db, ctxOf(), purchaseId, 12000, true);
    const detail = await getUsedDevice(env.db, ctxOf(), purchaseId, true);
    expect(detail.needsReview).toBe(false);
    expect(detail.state).toBe("in_stock");
  });

  it("refuses to shelve the same device twice", async () => {
    const { purchaseId } = await logPurchase(env.db, ctxOf(), request());
    sendToInventory(env.db, ctxOf(), purchaseId, 12000);
    expect(await codeOf(async () => sendToInventory(env.db, ctxOf(), purchaseId, 12000))).toBe("VALIDATION");
    // and the ledger still says exactly one stock-in
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(1);
  });

  it("keeps the invariant across the whole lifecycle", async () => {
    const held = await logPurchase(env.db, ctxOf(), request());
    const untouched = await logPurchase(env.db, ctxOf(), request({ device: { ...request().device, imei: IMEI_C } }));
    sendToInventory(env.db, ctxOf(), held.purchaseId, 12000);

    const movementsFor = (unitId: string) =>
      env.db.select().from(s.stockMovements).where(eq(s.stockMovements.unitId, unitId)).all();
    expect(movementsFor(held.unitId)).toHaveLength(1);
    expect(movementsFor(untouched.unitId)).toHaveLength(0);
  });
});

/* ------------------------------------------------- the review gate */

describe("shelving a device somebody flagged", () => {
  it("refuses until the flag is answered", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), result.purchaseId, true);

    /* the flag used to be cleared silently by shelving, so its only consequence
       was that it disappeared (ADR-0013 amendment) */
    expect(
      await codeOf(async () => sendToInventory(env.db, ctxOf(), result.purchaseId, 10000)),
    ).toBe("REVIEW_REQUIRED");

    const unit = env.db.select().from(s.units).all()[0]!;
    expect(unit.status).toBe("held");
    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(0);
  });

  it("goes through once confirmed, clears the flag, and records who", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), result.purchaseId, true);

    sendToInventory(env.db, ctxOf(), result.purchaseId, 10000, true);

    const purchase = env.db.select().from(s.usedPurchases).all()[0]!;
    expect(purchase.needsReview).toBe(false);
    expect(env.db.select().from(s.units).all()[0]!.status).toBe("in_stock");

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .find((e) => e.action === "review_confirmed")!;
    expect(entry).toBeDefined();
    // who decided this was fine is answerable afterwards
    expect(entry.userId).toBe(owner.id);
    expect((entry.after as { reviewConfirmedByUserId: string }).reviewConfirmedByUserId).toBe(owner.id);
  });

  it("sends an unflagged device straight through, with no confirmation entry", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    sendToInventory(env.db, ctxOf(), result.purchaseId, 10000);

    expect(env.db.select().from(s.units).all()[0]!.status).toBe("in_stock");
    expect(env.db.select().from(s.oplog).all().some((e) => e.action === "review_confirmed")).toBe(false);
  });

  it("changes nothing when the confirmation is cancelled", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    setNeedsReview(env.db, ctxOf(), result.purchaseId, true);
    await codeOf(async () => sendToInventory(env.db, ctxOf(), result.purchaseId, 10000));

    // cancelling is simply not calling again: the refusal left no trace
    const purchase = env.db.select().from(s.usedPurchases).all()[0]!;
    expect(purchase.needsReview).toBe(true);
    expect(env.db.select().from(s.units).all()[0]!.salePriceCents).toBeNull();
  });
});
