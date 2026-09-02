/**
 * The Sales report — and the four properties it would be dangerous to get wrong.
 *
 * It disagrees with nothing: filtered to a closed shift it must equal that
 * shift's frozen Z snapshot, and every grouping must add up to the ungrouped
 * total. A group-by that loses a row is the most common reporting bug there is
 * and the only one that looks entirely plausible on screen.
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
import { createUser } from "../auth/users";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const DAY = 86_400_000;

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-reports-"));
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
let groupId: string;
let productA: string;
let productB: string;
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

function makeProduct(name: string, costCents: number, priceCents: number, group = groupId) {
  const id = uuidv7();
  const now = new Date();
  env.db
    .insert(s.products)
    .values({
      id,
      tenantId: env.ctx.tenantId,
      groupId: group,
      name,
      itemType: "stocked",
      costCents,
      priceCents,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      barcode: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  env.db.insert(s.productStock).values({ productId: id, locationId: env.ctx.locationId, onHand: 100, updatedAt: now }).run();
  return id;
}

/**
 * A completed sale, written straight in.
 *
 * The full `sale:complete` path is exercised by its own suite; here the point is
 * a controlled set of documents at controlled instants, which the real path
 * cannot give without freezing the clock.
 */
function sale(opts: {
  completedAt: Date;
  createdAt?: Date;
  status?: "completed" | "draft" | "parked";
  lines: Array<{ productId: string | null; qty: number; unitPriceCents: number; unitCostCents: number | null; regime?: "IVA21" | "REBU"; description?: string }>;
  tenders?: Array<{ method: string; amountCents: number }>;
  userId?: string | null;
  shiftId?: string | null;
}) {
  const docId = uuidv7();
  const status = opts.status ?? "completed";
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  const lineRows = opts.lines.map((l, i) => {
    const lineTotal = l.qty * l.unitPriceCents;
    const rate = (l.regime ?? "IVA21") === "REBU" ? 0 : 2100;
    const base = Math.floor((lineTotal * 10000 + (10000 + rate) / 2) / (10000 + rate));
    subtotal += base;
    tax += lineTotal - base;
    total += lineTotal;
    return {
      id: uuidv7(),
      tenantId: env.ctx.tenantId,
      documentId: docId,
      lineNo: i + 1,
      lineType: "product" as const,
      productId: l.productId,
      unitId: null,
      description: l.description ?? "Línea",
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      priceOverridden: false,
      overrideReason: null,
      taxRegime: (l.regime ?? "IVA21") as "IVA21" | "REBU",
      taxRateBp: rate,
      baseCents: base,
      taxCents: lineTotal - base,
      totalCents: lineTotal,
      unitCostCents: l.unitCostCents,
      createdAt: opts.createdAt ?? opts.completedAt,
    };
  });

  env.db
    .insert(s.documents)
    .values({
      id: docId,
      tenantId: env.ctx.tenantId,
      locationId: env.ctx.locationId,
      terminalId: env.ctx.terminalId,
      docType: "ticket",
      status,
      seriesId: null,
      number: null,
      docNumber: status === "completed" ? `T1-${String(Math.floor(Math.random() * 899999) + 100000)}` : null,
      subtotalCents: subtotal,
      taxCents: tax,
      totalCents: total,
      shiftId: opts.shiftId ?? null,
      userId: opts.userId === undefined ? owner.id : opts.userId,
      createdAt: opts.createdAt ?? opts.completedAt,
      completedAt: status === "completed" ? opts.completedAt : null,
    })
    .run();
  for (const row of lineRows) env.db.insert(s.documentLines).values(row).run();
  for (const t of opts.tenders ?? [{ method: "cash", amountCents: total }]) {
    env.db
      .insert(s.documentTenders)
      .values({ id: uuidv7(), tenantId: env.ctx.tenantId, documentId: docId, method: t.method as never, amountCents: t.amountCents, cardReference: null, createdAt: opts.completedAt })
      .run();
  }
  return { docId, total, subtotal, tax };
}

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshDb();
  owner = createUser(env.db, env.ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(env.db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });

  groupId = uuidv7();
  env.db.insert(s.productGroups).values({ id: groupId, tenantId: env.ctx.tenantId, name: "Accesorios", sortOrder: 1, createdAt: new Date() }).run();
  productA = makeProduct("Funda", 400, 1000);
  productB = makeProduct("Cargador", 800, 2000);
});

const TODAY = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0);
};
const window = () => {
  const from = new Date(TODAY().getFullYear(), TODAY().getMonth(), TODAY().getDate()).getTime();
  return { fromMs: from - 30 * DAY, toMs: from + DAY };
};

type SalesRes = {
  summary: { tickets: number; netCents: number; taxCents: number; grossCents: number; averageTicketCents: number; usedSalesCents: number };
  rows: Array<{ key: string; label: string; count: number; qty: number; netCents: number; taxCents: number; grossCents: number; estimated?: boolean; costCents?: number | null; marginCents?: number | null; marginPct?: number | null }>;
  estimate: { exactLines: number; estimatedLines: number } | null;
  withCosts: boolean;
};

const sales = (over: Partial<{ groupBy: string; shiftId: string | null }> = {}) =>
  get<SalesRes>("reports:sales", { ...window(), shiftId: null, groupBy: "day", ...over });

/* ------------------------------------------------ what counts as a sale */

describe("what the report counts", () => {
  it("ignores drafts and parked tickets", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
    sale({ completedAt: TODAY(), status: "draft", lines: [{ productId: productA, qty: 5, unitPriceCents: 50000, unitCostCents: 400 }] });
    sale({ completedAt: TODAY(), status: "parked", lines: [{ productId: productA, qty: 5, unitPriceCents: 50000, unitCostCents: 400 }] });

    const res = await sales();
    // a parked ticket worth 500 € changes no figure on this screen
    expect(res.summary.tickets).toBe(1);
    expect(res.summary.grossCents).toBe(1000);
  });

  it("dates by completed_at, not by when somebody started typing", async () => {
    // a draft opened before the window and charged inside it belongs INSIDE
    sale({
      createdAt: new Date(TODAY().getTime() - 60 * DAY),
      completedAt: TODAY(),
      lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }],
    });
    // and one begun inside it but charged after belongs OUTSIDE
    sale({
      createdAt: TODAY(),
      completedAt: new Date(TODAY().getTime() + 10 * DAY),
      lines: [{ productId: productA, qty: 1, unitPriceCents: 9900, unitCostCents: 400 }],
    });

    const res = await sales();
    expect(res.summary.tickets).toBe(1);
    expect(res.summary.grossCents).toBe(1000);
  });

  it("separates margin-scheme sales, which carry no VAT", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 12100, unitCostCents: 400 }] });
    sale({
      completedAt: TODAY(),
      lines: [{ productId: productB, qty: 1, unitPriceCents: 24000, unitCostCents: 20000, regime: "REBU" }],
    });

    const res = await sales();
    expect(res.summary.usedSalesCents).toBe(24000);
    // the REBU line's whole price sits in the base, and adds no VAT
    expect(res.summary.taxCents).toBe(2100);
    expect(res.summary.grossCents).toBe(12100 + 24000);
  });
});

/* -------------------------------------------------------- the groupings */

describe("every grouping adds up to the same total", () => {
  beforeEach(() => {
    const other = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 2, unitPriceCents: 1000, unitCostCents: 400 }] });
    sale({
      completedAt: new Date(TODAY().getTime() - 2 * DAY),
      userId: other.id,
      lines: [{ productId: productB, qty: 1, unitPriceCents: 2000, unitCostCents: 800 }],
      tenders: [{ method: "card", amountCents: 2000 }],
    });
    sale({
      completedAt: new Date(TODAY().getTime() - 5 * DAY),
      lines: [
        { productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 },
        { productId: productB, qty: 3, unitPriceCents: 2000, unitCostCents: 800 },
      ],
    });
  });

  it("is the same money however it is sliced", async () => {
    const ungrouped = (await sales()).summary;
    for (const groupBy of ["day", "group", "product", "user"]) {
      const res = await sales({ groupBy });
      const sum = res.rows.reduce(
        (acc, r) => ({
          netCents: acc.netCents + r.netCents,
          taxCents: acc.taxCents + r.taxCents,
          grossCents: acc.grossCents + r.grossCents,
        }),
        { netCents: 0, taxCents: 0, grossCents: 0 },
      );
      expect(sum.netCents, groupBy).toBe(ungrouped.netCents);
      expect(sum.taxCents, groupBy).toBe(ungrouped.taxCents);
      expect(sum.grossCents, groupBy).toBe(ungrouped.grossCents);
    }
  });

  it("counts tenders, not a taxable base, when grouped by payment method", async () => {
    const res = await sales({ groupBy: "method" });
    const total = res.rows.reduce((sum, r) => sum + r.grossCents, 0);
    expect(total).toBe((await sales()).summary.grossCents);
    expect(res.rows.map((r) => r.label).sort()).toEqual(["card", "cash"]);
  });

  it("names the days and the people", async () => {
    const byDay = await sales({ groupBy: "day" });
    expect(byDay.rows).toHaveLength(3);
    const byUser = await sales({ groupBy: "user" });
    expect(byUser.rows.map((r) => r.label).sort()).toEqual(["Ahmer", "Ana"]);
  });
});

/* ------------------------------------------------------------- margin */

describe("cost and margin", () => {
  it("uses the line's own snapshot when it has one", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 2, unitPriceCents: 1000, unitCostCents: 400 }] });

    const res = await sales({ groupBy: "product" });
    const row = res.rows[0]!;
    expect(row.costCents).toBe(800); // 2 × 400, the snapshot
    expect(row.marginCents).toBe(2000 - 800);
    expect(res.estimate).toEqual({ exactLines: 1, estimatedLines: 0 });
  });

  it("does not move when the product's cost changes afterwards", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
    // the next delivery arrives at a different price
    env.db.update(s.products).set({ costCents: 900 }).where(eq(s.products.id, productA)).run();

    const res = await sales({ groupBy: "product" });
    // last month's margin must not depend on this month's purchasing
    expect(res.rows[0]!.costCents).toBe(400);
  });

  it("says it does not know, rather than guessing, for a pre-v0.14.0 line", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: null }] });

    const res = await sales({ groupBy: "product" });
    const row = res.rows[0]!;
    /* a dash, not the product's current cost: mixing a real figure with a guess
       produces a third thing that is neither, and margins get acted on */
    expect(row.estimated).toBe(true);
    expect(row.costCents).toBeNull();
    expect(row.marginCents).toBeNull();
    expect(row.marginPct).toBeNull();
    // and never silently: the count is on the response, the caption on screen
    expect(res.estimate).toEqual({ exactLines: 0, estimatedLines: 1 });
  });

  it("excludes an estimated row from the figures rather than polluting them", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
    sale({ completedAt: TODAY(), lines: [{ productId: productB, qty: 1, unitPriceCents: 2000, unitCostCents: null }] });

    const res = await sales({ groupBy: "product" });
    const known = res.rows.find((r) => r.estimated === false)!;
    const unknown = res.rows.find((r) => r.estimated === true)!;
    expect(known.costCents).toBe(400);
    expect(unknown.costCents).toBeNull();
    // the revenue is still counted; only the cost side declines to answer
    expect(unknown.grossCents).toBe(2000);
  });

  it("counts exactly which lines were guessed in a mixed report", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
    sale({ completedAt: TODAY(), lines: [{ productId: productB, qty: 1, unitPriceCents: 2000, unitCostCents: null }] });

    const res = await sales({ groupBy: "product" });
    expect(res.estimate).toEqual({ exactLines: 1, estimatedLines: 1 });
  });
});

/* --------------------------------------------------------- permissions */

describe("who sees the money", () => {
  beforeEach(() => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
  });

  it("omits the cost fields entirely for a caller without reports.costs", async () => {
    const viewer = createUser(env.db, env.ctx, {
      name: "Nuria",
      role: "cashier",
      pin: "4471",
      overrides: { "reports.view": true },
    }).user;
    startSession({ id: viewer.id, name: "Nuria", role: "cashier", overrides: { "reports.view": true } });

    const res = await sales({ groupBy: "product" });
    const row = res.rows[0]! as Record<string, unknown>;
    // absent, not blanked: there is nothing for a UI to accidentally reveal
    expect("costCents" in row).toBe(false);
    expect("marginCents" in row).toBe(false);
    expect(res.withCosts).toBe(false);
    expect(res.estimate).toBeNull();
  });

  it("refuses the report outright to somebody with neither key", async () => {
    const cashier = createUser(env.db, env.ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await call("reports:sales", { ...window(), shiftId: null, groupBy: "day" })).toBe("PERMISSION_DENIED");
    expect(await call("reports:hub", {})).toBe("PERMISSION_DENIED");
  });

  it("refuses the cost-bearing reports to a viewer without reports.costs", async () => {
    const viewer = createUser(env.db, env.ctx, {
      name: "Nuria",
      role: "cashier",
      pin: "4471",
      overrides: { "reports.view": true },
    }).user;
    startSession({ id: viewer.id, name: "Nuria", role: "cashier", overrides: { "reports.view": true } });

    expect(await call("reports:valuation", { groupId: null })).toBe("PERMISSION_DENIED");
    expect(await call("reports:deadStock", { groupId: null })).toBe("PERMISSION_DENIED");
    expect(await call("reports:used", { status: null, grade: null })).toBe("PERMISSION_DENIED");
    expect(await call("reports:repairsClosed", { ...window(), byTechnician: false })).toBe("PERMISSION_DENIED");
    // but the operational half is theirs
    expect(await call("reports:repairsOpen", { status: null, technicianId: null })).toBe("OK");
  });
});

/* ------------------------------------------------- the Z cross-check */

describe("Sales for one closed shift", () => {
  it("equals that shift's frozen Z snapshot", async () => {
    // open, sell, close — through the real channels, so the Z is a real Z
    await handlers.get("cash:open")!({}, { floatCents: 20000, breakdown: null });
    const shift = env.db.select().from(s.shifts).all()[0]!;

    sale({ completedAt: new Date(), shiftId: shift.id, lines: [{ productId: productA, qty: 2, unitPriceCents: 1000, unitCostCents: 400 }] });
    sale({
      completedAt: new Date(),
      shiftId: shift.id,
      lines: [{ productId: productB, qty: 1, unitPriceCents: 2000, unitCostCents: 800 }],
      tenders: [{ method: "card", amountCents: 2000 }],
    });

    const preview = (await handlers.get("cash:preview")!({}, {})) as {
      totals: { netSalesCents: number; taxCents: number; grossSalesCents: number };
    };
    await handlers.get("cash:close")!({}, { countedCents: 20000 + 2000, breakdown: null, reason: null });
    const closed = env.db.select().from(s.shifts).all()[0]!;
    const snapshot = (closed.snapshot as { totals: { netSalesCents: number; taxCents: number; grossSalesCents: number } }).totals;

    const res = await sales({ shiftId: shift.id });
    // the report and the Z are two readings of the same rows; if they ever
    // differ, one of them is lying and the shop cannot tell which
    expect(res.summary.netCents).toBe(snapshot.netSalesCents);
    expect(res.summary.taxCents).toBe(snapshot.taxCents);
    expect(res.summary.grossCents).toBe(snapshot.grossSalesCents);
    expect(res.summary.tickets).toBe(2);
    expect(snapshot.grossSalesCents).toBe(preview.totals.grossSalesCents);
  });
});

/* ----------------------------------------------------------- drill-down */

describe("drilling in", () => {
  it("lists a day's tickets, and a product's lines", async () => {
    const { docId } = sale({
      completedAt: TODAY(),
      lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400, description: "Funda" }],
    });
    const d = TODAY();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const byDay = await get<{ rows: Array<{ documentId: string }> }>("reports:salesDetail", {
      ...window(),
      shiftId: null,
      kind: "day",
      key,
    });
    expect(byDay.rows.map((r) => r.documentId)).toEqual([docId]);

    const byProduct = await get<{ rows: Array<{ description: string; qty: number }> }>("reports:salesDetail", {
      ...window(),
      shiftId: null,
      kind: "product",
      key: productA,
    });
    expect(byProduct.rows[0]!.description).toBe("Funda");
    expect(byProduct.rows[0]!.qty).toBe(1);
  });
});

/* ----------------------------------------------------------- read-only */

describe("reports never write", () => {
  it("runs twice and changes nothing", async () => {
    sale({ completedAt: TODAY(), lines: [{ productId: productA, qty: 1, unitPriceCents: 1000, unitCostCents: 400 }] });
    const before = env.db.select().from(s.oplog).all().length;

    for (const groupBy of ["day", "group", "product", "user", "method"]) await sales({ groupBy });
    await get("reports:hub", {});
    await get("reports:valuation", { groupId: null });
    await get("reports:deadStock", { groupId: null });
    await get("reports:used", { status: null, grade: null });

    expect(env.db.select().from(s.oplog).all().length).toBe(before);
  });
});
