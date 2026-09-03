/**
 * Logging a purchase, against a real database.
 *
 * This is the slice's load-bearing transaction: a document with a gap-free
 * number, a used_purchases row, a unit, photos, maybe a stock movement, maybe a
 * voucher — all of it or none of it. The assertions here are mostly about what
 * lands in which table, because "it returned an id" is not evidence the books
 * are right.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { AppError, imeiWithCheckDigit, isSerializedItem, parseIpcError, uuidv7, type UsedLogRequest } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { logPurchase } from "../repos/used";
import { purchasePhotosDir } from "../photos";
import { openShiftTx } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

const IMEI_A = imeiWithCheckDigit("35209411880318");
const IMEI_B = imeiWithCheckDigit("86123456789012");
const IMEI_C = imeiWithCheckDigit("49015420323751");

/* A 1×1 JPEG. Small enough to keep the suite fast, real enough to be written. */
const JPEG_1PX =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA" +
  "AAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-used-log-"));
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
  registerIpcHandlers(env.db);
  /* a printer, because every act that hands a person a document needs one
     since v0.18.1 — including buying a used phone */
  env.db
    .insert(s.settings)
    .values({ tenantId: env.ctx.tenantId, key: "printerName", value: "Impresora de pruebas", updatedAt: new Date() })
    .run();
  /* money now needs an open drawer (ADR-0015 §9) */
  openShiftTx(env.db, ctxOf(), { floatCents: 20000, breakdown: null });
});

/**
 * The typed code, whichever side of the bridge the call came from.
 *
 * A repo call throws AppError itself; a call through a handler throws the
 * JSON envelope the bridge serialises. Both are the same failure.
 */
const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.ipc.code;
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

describe("a purchase left on hold", () => {
  it("writes the document, the purchase, the unit — and no movement", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());

    const documents = env.db.select().from(s.documents).all();
    expect(documents).toHaveLength(1);
    expect(documents[0]!.docType).toBe("purchase");
    expect(documents[0]!.docNumber).toBe("C-000001");
    expect(documents[0]!.status).toBe("completed");
    // money OUT: the document total stays zero so no sales report inverts
    expect(documents[0]!.totalCents).toBe(0);

    const purchases = env.db.select().from(s.usedPurchases).all();
    expect(purchases).toHaveLength(1);
    expect(purchases[0]!.imei).toBe(IMEI_A);
    expect(purchases[0]!.sellerIdNumber).toBe("Y2841170F");
    expect(purchases[0]!.buyPriceCents).toBe(8000);

    const units = env.db.select().from(s.units).all();
    expect(units).toHaveLength(1);
    expect(units[0]!.status).toBe("held");
    expect(units[0]!.purchaseId).toBe(result.purchaseId);
    expect(units[0]!.salePriceCents).toBeNull(); // priced when it goes on the shelf
    expect(units[0]!.grade).toBe("B");

    expect(env.db.select().from(s.stockMovements).all()).toHaveLength(0);
    expect(env.db.select().from(s.productStock).all()).toHaveLength(0);
    expect(result.status).toBe("held");
  });
});

describe("a purchase sent straight to inventory", () => {
  it("posts exactly one tradein_in at the buy price and prices the unit", async () => {
    const result = await logPurchase(
      env.db,
      ctxOf(),
      request({ action: "inventory", sellPriceCents: 10000 }),
    );

    const movements = env.db.select().from(s.stockMovements).all();
    expect(movements).toHaveLength(1);
    expect(movements[0]!.movementType).toBe("tradein_in");
    expect(movements[0]!.qty).toBe(1);
    expect(movements[0]!.unitCostCents).toBe(8000);
    expect(movements[0]!.unitId).toBe(result.unitId);

    const units = env.db.select().from(s.units).all();
    expect(units[0]!.status).toBe("in_stock");
    expect(units[0]!.salePriceCents).toBe(10000);
    expect(units[0]!.costCents).toBe(8000);

    // the cache moves in the same transaction as the movement it summarises
    const stock = env.db.select().from(s.productStock).all();
    expect(stock).toHaveLength(1);
    expect(stock[0]!.onHand).toBe(1);
  });

  it("refuses to shelve a device with no selling price", async () => {
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), request({ action: "inventory" })))).toBe("VALIDATION");
    expect(env.db.select().from(s.documents).all()).toHaveLength(0);
  });
});

describe("the ledger points back at the paperwork", () => {
  it("stamps the purchase document on the tradein_in movement", async () => {
    /* Without this the movements drawer in Inventario showed a link for the
       sale that took a phone off the shelf and "—" for the purchase that put
       it there: from the ledger there was no way back to the signed document. */
    const result = await logPurchase(
      env.db,
      ctxOf(),
      request({ action: "inventory", sellPriceCents: 10000 }),
    );

    const movement = env.db.select().from(s.stockMovements).all()[0]!;
    expect(movement.documentId).not.toBeNull();

    const doc = env.db
      .select()
      .from(s.documents)
      .where(eq(s.documents.id, movement.documentId!))
      .all()[0]!;
    expect(doc.docType).toBe("purchase");
    expect(doc.docNumber).toBe(result.docNumber);
  });
});

describe("unit status and the ledger can never disagree", () => {
  it("held has zero movements, in stock has exactly one stock-in", async () => {
    const held = await logPurchase(env.db, ctxOf(), request());
    const shelved = await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 12000 }),
    );

    const movementsFor = (unitId: string) =>
      env.db.select().from(s.stockMovements).where(eq(s.stockMovements.unitId, unitId)).all();

    expect(movementsFor(held.unitId)).toHaveLength(0);
    expect(movementsFor(shelved.unitId)).toHaveLength(1);
    expect(movementsFor(shelved.unitId)[0]!.qty).toBe(1);
  });
});

describe("the catalogue product", () => {
  it("is found, not created twice, for the same model", async () => {
    const first = await logPurchase(env.db, ctxOf(), request());
    const second = await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B } }),
    );

    expect(second.productId).toBe(first.productId);
    expect(env.db.select().from(s.products).all()).toHaveLength(1);
  });

  it("is a different product for a different storage size", async () => {
    const first = await logPurchase(env.db, ctxOf(), request());
    const second = await logPurchase(
      env.db,
      ctxOf(),
      request({ device: { ...request().device, imei: IMEI_B, storage: "128GB" } }),
    );
    expect(second.productId).not.toBe(first.productId);
  });

  it("carries the used_device item type and the REBU margin scheme", async () => {
    await logPurchase(env.db, ctxOf(), request());
    const product = env.db.select().from(s.products).all()[0]!;
    expect(product.name).toBe("Apple iPhone SE 2020 64GB Blanco (usado)");
    /* the type ADR-0013 always described. It behaves as serialized everywhere
       — picked by IMEI, valued per unit, refused as a repair part — and differs
       only where a report must tell a phone from a phone case */
    expect(product.itemType).toBe("used_device");
    expect(isSerializedItem(product.itemType)).toBe(true);
    expect(product.taxRegime).toBe("REBU");
  });
});

describe("numbering", () => {
  it("is gap-free and starts at C-000001", async () => {
    const numbers: string[] = [];
    for (const imei of [IMEI_A, IMEI_B, IMEI_C]) {
      const r = await logPurchase(env.db, ctxOf(), request({ device: { ...request().device, imei } }));
      numbers.push(r.docNumber);
    }
    expect(numbers).toEqual(["C-000001", "C-000002", "C-000003"]);
  });

  it("creates the C- series on demand rather than at first run", async () => {
    expect(env.db.select().from(s.numberSeries).all()).toHaveLength(0);
    await logPurchase(env.db, ctxOf(), request());
    const series = env.db.select().from(s.numberSeries).all();
    expect(series).toHaveLength(1);
    expect(series[0]!.prefix).toBe("C-");
    expect(series[0]!.docType).toBe("purchase");
  });

  it("does not burn a number on a refused purchase", async () => {
    await logPurchase(env.db, ctxOf(), request());
    await codeOf(() => logPurchase(env.db, ctxOf(), request({ device: { ...request().device, imei: "352094118803181" } })));
    const next = await logPurchase(env.db, ctxOf(), request({ device: { ...request().device, imei: IMEI_B } }));
    expect(next.docNumber).toBe("C-000002");
  });
});

describe("the gate is enforced here, not in the UI", () => {
  it("refuses when the cashier never confirmed", async () => {
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), request({ gateConfirmed: false })))).toBe("VALIDATION");
    expect(env.db.select().from(s.usedPurchases).all()).toHaveLength(0);
  });

  it("refuses a device already bought, even with the box ticked", async () => {
    await logPurchase(env.db, ctxOf(), request());
    // the renderer may have been open since before the first purchase
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), request()))).toBe("DUPLICATE_IMEI");
    expect(env.db.select().from(s.usedPurchases).all()).toHaveLength(1);
  });

  it("refuses an invalid IMEI", async () => {
    const bad = request({ device: { ...request().device, imei: "352094118803181" } });
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), bad))).toBe("VALIDATION");
  });
});

describe("store credit", () => {
  it("issues a voucher for the buy price, linked to the purchase", async () => {
    const result = await logPurchase(env.db, ctxOf(), request({ payout: "store_credit" }));
    const vouchers = env.db.select().from(s.storeCreditVouchers).all();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]!.id).toBe(result.voucherId);
    expect(vouchers[0]!.amountCents).toBe(8000);
    expect(vouchers[0]!.remainingCents).toBe(8000);
    expect(vouchers[0]!.status).toBe("issued");
    expect(vouchers[0]!.purchaseId).toBe(result.purchaseId);
  });

  it("issues nothing when the seller took cash", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    expect(result.voucherId).toBeNull();
    expect(env.db.select().from(s.storeCreditVouchers).all()).toHaveLength(0);
  });

  it("needs a reference for a transfer", async () => {
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), request({ payout: "transfer" })))).toBe("VALIDATION");
  });
});

describe("photos", () => {
  it("writes files and stores RELATIVE paths", async () => {
    const result = await logPurchase(
      env.db,
      ctxOf(),
      request({
        photos: [
          { kind: "front", dataUrl: JPEG_1PX },
          { kind: "seller_id", dataUrl: JPEG_1PX },
        ],
      }),
    );

    const rows = env.db.select().from(s.purchasePhotos).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // a path the shop can move with its data folder, not one pinned to a machine
      expect(row.path.startsWith("purchases/")).toBe(true);
      expect(row.path).not.toMatch(/^[A-Za-z]:|^\//);
    }

    const dir = purchasePhotosDir(result.purchaseId);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).sort()).toEqual(["front.jpg", "seller_id.jpg"]);
  });

  it("keeps both extra shots instead of overwriting one with the other", async () => {
    const result = await logPurchase(
      env.db,
      ctxOf(),
      request({
        photos: [
          { kind: "extra", dataUrl: JPEG_1PX },
          { kind: "extra", dataUrl: JPEG_1PX },
        ],
      }),
    );
    expect(readdirSync(purchasePhotosDir(result.purchaseId)).sort()).toEqual(["extra-2.jpg", "extra.jpg"]);
  });
});

describe("the audit trail", () => {
  it("records every row of the purchase, stamped with the actor", async () => {
    const result = await logPurchase(
      env.db,
      ctxOf(),
      request({ action: "inventory", sellPriceCents: 10000, payout: "store_credit" }),
    );

    // the owner's own creation is in this table too, written pre-session with a
    // null actor (ADR-0010) — this test is about what the PURCHASE wrote
    const entries = env.db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity !== "user");
    const kinds = new Set(entries.map((e) => `${e.entity}:${e.action}`));
    for (const kind of [
      "product:create",
      "document:create",
      "used_purchase:create",
      "unit:create",
      "stock_movement:create",
      "store_credit_voucher:issue",
    ]) {
      expect(kinds, kind).toContain(kind);
    }
    for (const entry of entries) expect(entry.userId).toBe(owner.id);

    // one envelope: everything shares the transaction, so nothing is half-logged
    const purchaseEntry = entries.find((e) => e.entityId === result.purchaseId)!;
    expect(purchaseEntry).toBeDefined();
  });

  it("keeps the seller out of the oplog payload", async () => {
    const result = await logPurchase(env.db, ctxOf(), request());
    const entry = env.db
      .select()
      .from(s.oplog)
      .where(and(eq(s.oplog.entity, "used_purchase"), eq(s.oplog.entityId, result.purchaseId)))
      .all()[0]!;
    // the oplog is readable by anyone who can read the file; the record of WHO
    // sold us the phone lives in the purchase row, behind a permission
    expect(entry.after ?? "").not.toContain("Imran");
    expect(entry.after ?? "").not.toContain("Y2841170F");
  });
});

describe("the barcode", () => {
  it("is refused when something already owns it", async () => {
    await logPurchase(env.db, ctxOf(), request({ barcode: "2012345678909" }));
    const second = request({ device: { ...request().device, imei: IMEI_B }, barcode: "2012345678909" });
    expect(await codeOf(() => logPurchase(env.db, ctxOf(), second))).toBe("DUPLICATE_BARCODE");
  });
});

describe("who may log a purchase", () => {
  const call = async (payload: unknown) => handlers.get("used:log")!({}, payload);

  it("refuses a cashier without usedDevices.create", async () => {
    const blocked = createUser(env.db, env.ctx, {
      name: "Nuevo",
      role: "cashier",
      pin: "7409",
      overrides: { "usedDevices.create": false },
    }).user;
    startSession({ id: blocked.id, name: "Nuevo", role: "cashier", overrides: { "usedDevices.create": false } });
    expect(await codeOf(() => call(request()))).toBe("PERMISSION_DENIED");
    expect(env.db.select().from(s.usedPurchases).all()).toHaveLength(0);
  });

  it("stamps the SESSION as the actor, never the payload", async () => {
    const cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    await call({ ...request(), userId: owner.id });
    const entries = env.db.select().from(s.oplog).where(eq(s.oplog.entity, "used_purchase")).all();
    expect(entries[0]!.userId).toBe(cashier.id);
  });
});
