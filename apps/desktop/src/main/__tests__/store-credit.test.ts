/**
 * Store credit, end to end.
 *
 * The load-bearing claim is that a voucher cannot be spent twice. It is spent
 * inside the sale's own transaction by an update that matches only a row still
 * marked `issued`, so the second attempt fails and takes its whole sale with
 * it — there is no state where the goods left the shop and the voucher stayed
 * spendable. Everything else here is about the credit never becoming a line.
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
import { logPurchase, findVouchers, voidVoucher } from "../repos/used";
import { addLine, complete } from "../repos/sale";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const IMEI_A = imeiWithCheckDigit("35209411880318");
const IMEI_B = imeiWithCheckDigit("86123456789012");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-credit-"));
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

  const groupId = uuidv7();
  db.insert(s.productGroups)
    .values({ id: groupId, tenantId: ids.tenantId, name: "Protectores", sortOrder: 0, createdAt: now })
    .run();
  const productId = uuidv7();
  db.insert(s.products)
    .values({
      id: productId,
      tenantId: ids.tenantId,
      groupId,
      name: "Funda silicona",
      itemType: "stocked",
      priceCents: 1290,
      costCents: 500,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(s.productStock)
    .values({ productId, locationId: ids.locationId, onHand: 50, updatedAt: now })
    .run();
  db.insert(s.stockMovements)
    .values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      locationId: ids.locationId,
      terminalId: ids.terminalId,
      productId,
      movementType: "purchase_in",
      qty: 50,
      unitCostCents: 500,
      createdAt: now,
    })
    .run();

  return { db, ctx: { ...ids, userId: null as string | null }, productId };
}

let env: ReturnType<typeof freshDb>;
let owner: { id: string };

const ctxOf = () => ({ ...env.ctx, userId: owner.id });

function purchase(over: Partial<UsedLogRequest> = {}): UsedLogRequest {
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
      phone: null,
      idType: "DNI",
      idNumber: "Y2841170F",
      channel: "private_individual",
    },
    photos: [],
    buyPriceCents: 5000,
    payout: "store_credit",
    payoutReference: null,
    barcode: null,
    gateConfirmed: true,
    action: "hold",
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
});

const codeOf = async (fn: () => Promise<unknown> | unknown): Promise<string> => {
  try {
    await fn();
    return "OK";
  } catch (err) {
    if (err instanceof AppError) return err.ipc.code;
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/** A ticket for n × 12,90 €, ready to be charged. */
function cart(qty: number): { docId: string; totalCents: number } {
  const state = addLine(env.db, ctxOf(), { productId: env.productId, qty });
  if (state.kind !== "state") throw new Error("expected a draft");
  return { docId: state.state.docId, totalCents: state.state.totalCents };
}

describe("redeeming a voucher", () => {
  it("pays for a sale and marks the voucher spent, in one transaction", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId, totalCents } = cart(5); // 64,50 €

    const done = complete(env.db, ctxOf(), {
      docId,
      tenders: [
        { method: "store_credit", amountCents: 5000, voucherId },
        { method: "cash", amountCents: totalCents - 5000 },
      ],
    });

    expect(done.docNumber).toBe("T1-000001");
    const voucher = env.db.select().from(s.storeCreditVouchers).all()[0]!;
    expect(voucher.status).toBe("redeemed");
    expect(voucher.remainingCents).toBe(0);
    expect(voucher.redeemedDocumentId).toBe(docId);
    expect(voucher.redeemedAt).not.toBeNull();
  });

  it("never becomes a document line — the goods keep their value", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId, totalCents } = cart(5);

    complete(env.db, ctxOf(), {
      docId,
      tenders: [
        { method: "store_credit", amountCents: 5000, voucherId },
        { method: "cash", amountCents: totalCents - 5000 },
      ],
    });

    const lines = env.db.select().from(s.documentLines).where(eq(s.documentLines.documentId, docId)).all();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.totalCents).toBe(totalCents);

    // the credit is a payment, so the taxable base is untouched by it
    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, docId)).all()[0]!;
    expect(doc.totalCents).toBe(totalCents);
    const tenders = env.db.select().from(s.documentTenders).where(eq(s.documentTenders.documentId, docId)).all();
    expect(tenders.map((t) => t.method).sort()).toEqual(["cash", "store_credit"]);
  });

  it("cannot be spent twice", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());

    const first = cart(5);
    complete(env.db, ctxOf(), {
      docId: first.docId,
      tenders: [
        { method: "store_credit", amountCents: 5000, voucherId },
        { method: "cash", amountCents: first.totalCents - 5000 },
      ],
    });

    const second = cart(5);
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId: second.docId,
          tenders: [
            { method: "store_credit", amountCents: 5000, voucherId },
            { method: "cash", amountCents: second.totalCents - 5000 },
          ],
        }),
      ),
    ).toBe("VALIDATION");

    // and the second sale did not half-happen: it is still a draft, unnumbered
    const doc = env.db.select().from(s.documents).where(eq(s.documents.id, second.docId)).all()[0]!;
    expect(doc.status).toBe("draft");
    expect(doc.docNumber).toBeNull();
    expect(env.db.select().from(s.documents).all().filter((d) => d.docNumber !== null)).toHaveLength(2); // ticket + purchase
  });

  it("refuses a partial amount: a voucher is spent whole", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId, totalCents } = cart(5);
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId,
          tenders: [
            { method: "store_credit", amountCents: 2000, voucherId },
            { method: "cash", amountCents: totalCents - 2000 },
          ],
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("refuses a credit tender with no voucher named", async () => {
    const { docId, totalCents } = cart(5);
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId,
          tenders: [
            { method: "store_credit", amountCents: 1000 },
            { method: "cash", amountCents: totalCents - 1000 },
          ],
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("refuses the same voucher twice on one ticket", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId } = cart(9); // 116,10 €
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId,
          tenders: [
            { method: "store_credit", amountCents: 5000, voucherId },
            { method: "store_credit", amountCents: 5000, voucherId },
            { method: "cash", amountCents: 1610 },
          ],
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("refuses a voucher bigger than the ticket, as non-cash excess", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase({ buyPriceCents: 9000 }));
    const { docId } = cart(1); // 12,90 €
    // the shop rule: credit buys something of equal or greater value, and the
    // existing tender guard already refuses non-cash over the total
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId,
          tenders: [{ method: "store_credit", amountCents: 9000, voucherId }],
        }),
      ),
    ).toBe("TENDER_MISMATCH");
  });
});

describe("the finder", () => {
  it("finds a voucher by its purchase number and says it is usable", async () => {
    await logPurchase(env.db, ctxOf(), purchase());
    const { rows } = findVouchers(env.db, ctxOf(), "C-000001", 20000, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refusal).toBeNull();
    expect(rows[0]!.remainingCents).toBe(5000);
  });

  it("says WHY an unusable voucher cannot be used, rather than hiding it", async () => {
    await logPurchase(env.db, ctxOf(), purchase());
    // too big for this ticket
    expect(findVouchers(env.db, ctxOf(), "C-000001", 1000, true).rows[0]!.refusal).toBe("exceeds_total");
  });

  it("withholds the seller's name from a session that may not read it", async () => {
    await logPurchase(env.db, ctxOf(), purchase());

    const withPermission = findVouchers(env.db, ctxOf(), "C-000001", 20000, true);
    expect(withPermission.rows[0]!.sellerName).toBe("Imran Khan");

    const without = findVouchers(env.db, ctxOf(), "C-000001", 20000, false);
    expect(without.rows[0]!.sellerName).toBeNull();
    expect(JSON.stringify(without)).not.toContain("Imran");
  });

  it("does not let a name be used as a search term without the permission", async () => {
    await logPurchase(env.db, ctxOf(), purchase());
    // otherwise the box becomes a way to probe the register by guessing names
    expect(findVouchers(env.db, ctxOf(), "Imran", 20000, false).rows).toHaveLength(0);
    expect(findVouchers(env.db, ctxOf(), "Imran", 20000, true).rows).toHaveLength(1);
  });

  it("still lists a spent voucher, marked", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId, totalCents } = cart(5);
    complete(env.db, ctxOf(), {
      docId,
      tenders: [
        { method: "store_credit", amountCents: 5000, voucherId },
        { method: "cash", amountCents: totalCents - 5000 },
      ],
    });
    const { rows } = findVouchers(env.db, ctxOf(), "C-000001", 20000, true);
    expect(rows[0]!.status).toBe("redeemed");
    expect(rows[0]!.refusal).toBe("not_issued");
  });
});

describe("voiding a voucher", () => {
  it("needs a reason and records it", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    expect(await codeOf(() => voidVoucher(env.db, ctxOf(), voucherId!, "   "))).toBe("VALIDATION");

    voidVoucher(env.db, ctxOf(), voucherId!, "emitido por error");
    const voucher = env.db.select().from(s.storeCreditVouchers).all()[0]!;
    expect(voucher.status).toBe("void");
    expect(voucher.voidReason).toBe("emitido por error");
    expect(voucher.remainingCents).toBe(0);

    const entry = env.db
      .select()
      .from(s.oplog)
      .all()
      .find((e) => e.entity === "store_credit_voucher" && e.action === "void")!;
    expect(entry.userId).toBe(owner.id);
  });

  it("refuses to void one that was already spent", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const { docId, totalCents } = cart(5);
    complete(env.db, ctxOf(), {
      docId,
      tenders: [
        { method: "store_credit", amountCents: 5000, voucherId },
        { method: "cash", amountCents: totalCents - 5000 },
      ],
    });
    // voiding a redeemed voucher would erase a payment that actually happened
    expect(await codeOf(() => voidVoucher(env.db, ctxOf(), voucherId!, "cambio de idea"))).toBe("VALIDATION");
  });

  it("cannot be spent once void", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    voidVoucher(env.db, ctxOf(), voucherId!, "emitido por error");
    const { docId, totalCents } = cart(5);
    expect(
      await codeOf(() =>
        complete(env.db, ctxOf(), {
          docId,
          tenders: [
            { method: "store_credit", amountCents: 5000, voucherId },
            { method: "cash", amountCents: totalCents - 5000 },
          ],
        }),
      ),
    ).toBe("VALIDATION");
  });

  it("is owner-only", async () => {
    const { voucherId } = await logPurchase(env.db, ctxOf(), purchase());
    const cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(
      await codeOf(async () => handlers.get("used:voidVoucher")!({}, { voucherId, reason: "x" })),
    ).toBe("PERMISSION_DENIED");
  });
});

describe("selling the phone that was bought", () => {
  it("prices the line from the UNIT, not the used product", async () => {
    const { unitId } = await logPurchase(
      env.db,
      ctxOf(),
      purchase({ device: { ...purchase().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 18900 }),
    );

    const state = addLine(env.db, ctxOf(), { unitId });
    if (state.kind !== "state") throw new Error("expected a draft");
    const line = state.state.lines[0]!;
    // the used product's own price is zero; the unit carries the real one
    expect(line.unitPriceCents).toBe(18900);
    expect(state.state.totalCents).toBe(18900);
  });

  it("sells under REBU with no VAT broken out", async () => {
    const { unitId } = await logPurchase(
      env.db,
      ctxOf(),
      purchase({ device: { ...purchase().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 18900 }),
    );
    const state = addLine(env.db, ctxOf(), { unitId });
    if (state.kind !== "state") throw new Error("expected a draft");

    const line = state.state.lines[0]!;
    expect(line.taxRegime).toBe("REBU");
    expect(line.taxRateBp).toBe(0);
    // the margin scheme taxes the shop's margin, not this sale: the customer's
    // document must not show VAT it cannot deduct
    expect(state.state.taxCents).toBe(0);
    expect(state.state.subtotalCents).toBe(18900);
  });

  it("offers the used unit with its grade and its own price", async () => {
    const { productId } = await logPurchase(
      env.db,
      ctxOf(),
      purchase({ device: { ...purchase().device, imei: IMEI_B }, action: "inventory", sellPriceCents: 18900 }),
    );
    const pick = addLine(env.db, ctxOf(), { productId });
    if (pick.kind !== "unitPick") throw new Error("expected the unit picker");
    expect(pick.units).toHaveLength(1);
    expect(pick.units[0]!.grade).toBe("B");
    expect(pick.units[0]!.salePriceCents).toBe(18900);
  });

  it("never offers a held device", async () => {
    const { productId } = await logPurchase(env.db, ctxOf(), purchase({ device: { ...purchase().device, imei: IMEI_B } }));
    // held means the ledger has never heard of it, so there is nothing to pick
    expect(await codeOf(() => addLine(env.db, ctxOf(), { productId }))).toBe("UNIT_NOT_AVAILABLE");
  });
});
