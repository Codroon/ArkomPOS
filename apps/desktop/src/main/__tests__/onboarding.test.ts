/**
 * First run, end to end — v0.18.2.
 *
 * Three questions, and they are the ones a shop visit actually asks:
 * can the till be set up when the printer has not arrived yet; does the
 * checklist tick because the shop DID something rather than because it was
 * told to; and is the database a fresh till produces after one day's work one
 * that `db:audit --verify` is happy with.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { parseIpcError, STARTER_CASH_CONCEPTS, STARTER_GROUPS, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext, tillContext } from "../context";
import { getSettings } from "../repos/settings";
import { ensureStarterGroups } from "../setup";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const REPO = join(__dirname, "../../../../..");

interface Env {
  db: ReturnType<typeof openDb>["db"];
  file: string;
}

function freshTill(): Env {
  const dir = mkdtempSync(join(tmpdir(), "arkom-onboard-"));
  const file = join(dir, "arkom-pos.db");
  const { db } = openDb(file);
  runMigrations(db, MIGRATIONS);
  return { db, file };
}

let env: Env;
const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;
const code = async (channel: string, payload?: unknown): Promise<string> => {
  try {
    await handlers.get(channel)!({}, payload);
    return "OK";
  } catch (err) {
    return parseIpcError(err)?.code ?? "UNTYPED";
  }
};

/** The wizard, in the order the screens ask: shop details, then the owner. */
const WIZARD = {
  shopLegalName: "Arkom Electronics S.L.",
  shopNif: "B15987870",
  shopAddress: "Carrer Turó de la Trinitat 25",
  shopCity: "Barcelona",
  shopPostalCode: "08033",
  shopPhone: "934 000 111",
  ticketFooter: "Tu Único Punto Tecnológico",
  terminalName: "Caja 1",
  seriesPrefix: "T1-",
  /* the screen has no demo option any more, and sends none */
  loadDemo: false,
  locale: "en" as const,
};

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = freshTill();
  registerIpcHandlers(env.db);
});

interface Checklist {
  printerConfigured: boolean;
  hasProducts: boolean;
  hasStaff: boolean;
  hasShift: boolean;
  dismissed: boolean;
  done: boolean;
}

/** Walks the wizard and signs the owner in, exactly as the screens do. */
async function onboard(): Promise<{ ownerId: string; ctx: ReturnType<typeof tillContext>["ctx"] }> {
  expect(await call<{ needed: boolean }>("setup:status")).toMatchObject({ needed: true });
  await call("setup:complete", WIZARD);
  const owner = await call<{ user: { id: string; name: string }; recoveryCode: string }>("setup:owner", {
    name: "Ahmer",
    pin: "8317",
  });
  expect(owner.recoveryCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  startSession({ id: owner.user.id, name: owner.user.name, role: "owner", overrides: {} });
  return { ownerId: owner.user.id, ctx: { ...tillContext(env.db).ctx, userId: owner.user.id } };
}

/* --------------------------------------------- 1 · the wizard, printer skipped */

describe("first run with the printer skipped", () => {
  it("finishes, and leaves a till that is set up but cannot charge yet", async () => {
    const { ctx } = await onboard();

    // the shop exists, in the language it was set up in, with shelves and nothing on them
    const settings = getSettings(env.db, ctx);
    expect(settings.shopLegalName).toBe(WIZARD.shopLegalName);
    expect(settings.printerName).toBe("");
    expect(settings.cashConcepts).toEqual(STARTER_CASH_CONCEPTS.en);
    expect(env.db.select().from(s.productGroups).all()).toHaveLength(STARTER_GROUPS.length);
    expect(env.db.select().from(s.products).all()).toEqual([]);

    // skipping the printer step is exactly this: the setting stays empty
    expect(await call<{ needed: boolean; ownerNeeded: boolean }>("setup:status")).toMatchObject({
      needed: false,
      ownerNeeded: false,
    });

    /* and the consequence the step warned about is real: with no printer the
       counter refuses (v0.18.1), which is why the checklist puts it first */
    const checklist = await call<Checklist>("setup:checklist", {});
    expect(checklist).toMatchObject({ printerConfigured: false, done: false });
  });

  it("offers no demo dataset, and refuses one if a caller asks", async () => {
    expect(await code("setup:complete", { ...WIZARD, loadDemo: true })).toBe("OK"); // dev build: allowed
    expect(env.db.select().from(s.products).all().length).toBeGreaterThan(0);
    // the SCREEN never sends it; the packaged refusal is pinned in ship-clean.test.ts
  });
});

/* --------------------------------------- 1b · every series the till numbers */

describe("the numbering the wizard asks for", () => {
  it("creates all five series with the shop's own prefixes", async () => {
    await call("setup:complete", {
      ...WIZARD,
      seriesPrefix: "FA-",
      refundPrefix: "AB-",
      repairPrefix: "REP-",
      purchasePrefix: "COM-",
      shiftPrefix: "CIE-",
    });
    const series = env.db.select().from(s.numberSeries).all();
    expect(Object.fromEntries(series.map((r) => [r.docType, r.prefix]))).toEqual({
      ticket: "FA-",
      refund: "AB-",
      repair: "REP-",
      purchase: "COM-",
      shift: "CIE-",
    });
    // ADR-0008: each starts at one, and the number is the series', not the doc's
    expect(series.every((r) => r.nextNumber === 1)).toBe(true);
  });

  it("defaults the four the shop did not think about", async () => {
    await call("setup:complete", WIZARD);
    const series = env.db.select().from(s.numberSeries).all();
    expect(Object.fromEntries(series.map((r) => [r.docType, r.prefix]))).toEqual({
      ticket: "T1-",
      refund: "D1-",
      repair: "R-",
      purchase: "C-",
      shift: "Z1-",
    });
  });

  it("refuses two series that would number documents the same way", async () => {
    /* two series sharing a prefix produce two documents called T1-000001, and
       no search, refund or spreadsheet can tell them apart afterwards */
    expect(await code("setup:complete", { ...WIZARD, refundPrefix: "T1-" })).toBe("VALIDATION");
    expect(await code("setup:complete", { ...WIZARD, repairPrefix: "r-", purchasePrefix: "R-" })).toBe("VALIDATION");
    expect(env.db.select().from(s.tenants).all()).toEqual([]); // nothing half-created
  });

  it("refuses a prefix nobody could type at a keyboard", async () => {
    expect(await code("setup:complete", { ...WIZARD, shiftPrefix: "Z 1/" })).toBe("VALIDATION");
    expect(await code("setup:complete", { ...WIZARD, refundPrefix: "" })).toBe("VALIDATION");
  });

  it("hands the shop's prefix to the document that is issued later", async () => {
    /* the repos used to create their series on demand; now they find the one
       the wizard made, which is the whole point of asking */
    await call("setup:complete", { ...WIZARD, refundPrefix: "AB-" });
    const owner = await call<{ user: { id: string; name: string } }>("setup:owner", { name: "Ahmer", pin: "8317" });
    startSession({ id: owner.user.id, name: owner.user.name, role: "owner", overrides: {} });
    await call("settings:save", { printerName: "Citizen CT-S310II" });

    const groupId = env.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Cable USB-C 1m",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 300,
      priceCents: 890,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    await call("cash:open", { floatCents: 20000, breakdown: null });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    await call("stock:add", {
      entries: [{ productId: saved.product.id, supplierId: supplier.id, qty: 2, unitCostCents: 300, imeis: [] }],
    });
    const line = await call<{ state: { docId: string; totalCents: number } }>("sale:addLine", {
      productId: saved.product.id,
      qty: 1,
    });
    const sale = await call<{ docId: string }>("sale:complete", {
      docId: line.state.docId,
      tenders: [{ method: "cash", amountCents: line.state.totalCents }],
    });
    const lineId = env.db.select().from(s.documentLines).where(eq(s.documentLines.documentId, sale.docId)).all()[0]!.id;
    const refund = await call<{ docNumber: string }>("refund:create", {
      documentId: sale.docId,
      reason: "Cambio de opinión",
      method: "cash",
      lines: [{ lineId, qty: 1, restock: true }],
    });
    expect(refund.docNumber).toBe("AB-000001");
  });
});

/* ------------------------------------ 2 · the checklist ticks on real actions */

describe("the first-run checklist", () => {
  it("ticks each item when the shop does the thing, not when it is told", async () => {
    const { ctx } = await onboard();
    const read = () => call<Checklist>("setup:checklist", {});

    expect(await read()).toMatchObject({
      printerConfigured: false,
      hasProducts: false,
      hasStaff: false,
      hasShift: false,
      done: false,
    });

    // a printer, in Ajustes
    await call("settings:save", { printerName: "Citizen CT-S310II" });
    expect(await read()).toMatchObject({ printerConfigured: true, done: false });

    // an article, in Catálogo
    const groupId = env.db.select().from(s.productGroups).all()[0]!.id;
    await call("catalog:save", {
      name: "Cable USB-C 1m",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 300,
      priceCents: 890,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    expect(await read()).toMatchObject({ hasProducts: true, done: false });

    // a cashier, in Usuarios — optional, so it does not gate anything
    await call("users:create", { name: "Ana", role: "cashier", pin: "5162", overrides: {} });
    expect(await read()).toMatchObject({ hasStaff: true, done: false });

    // the shift, in Caja: the last one that matters, so the card goes
    await call("cash:open", { floatCents: 20000, breakdown: null });
    const final = await read();
    expect(final).toMatchObject({ hasShift: true, done: true });
    expect(final.dismissed).toBe(false); // finished, not silenced

    void ctx;
  });

  it("goes away for good when the owner says enough, with the work undone", async () => {
    await onboard();
    expect(await call<Checklist>("setup:dismissChecklist", {})).toMatchObject({ dismissed: true, done: true });
    // and stays gone across a reload of the app
    resetTillContext();
    expect(await call<Checklist>("setup:checklist", {})).toMatchObject({
      dismissed: true,
      done: true,
      printerConfigured: false,
    });
  });

  it("needs a session, like anything else that reads the shop", async () => {
    await onboard();
    endSession();
    expect(await code("setup:checklist", {})).toBe("AUTH_REQUIRED");
    expect(await code("setup:dismissChecklist", {})).toBe("AUTH_REQUIRED");
  });
});

/* ------------------------- 2b · a till that upgraded from before the shelves */

describe("a shop that was set up before starter groups existed", () => {
  it("is handed the shelves, because otherwise it cannot save a single article", async () => {
    /* Found on the v1.0.0 install rehearsal: a till set up on a v0.10-era build
       came through every migration with a catalogue it could not add to — the
       group field is required and the dropdown was empty. */
    await onboard();
    env.db.delete(s.productGroups).run(); // the state an upgraded till was in
    expect(env.db.select().from(s.productGroups).all()).toEqual([]);

    const seeded = ensureStarterGroups(env.db);
    expect(seeded).toBe(STARTER_GROUPS.length);
    const groups = env.db.select().from(s.productGroups).all();
    expect(groups).toHaveLength(STARTER_GROUPS.length);
    // both names, because nobody recorded which language that shop was set up in
    expect(groups.every((g) => g.name.trim() !== "" && (g.nameEn ?? "").trim() !== "")).toBe(true);
    expect(groups.every((g) => !g.isDemo)).toBe(true);
  });

  it("leaves a shop that made its own shelves alone", async () => {
    await onboard();
    env.db.delete(s.productGroups).run();
    await call("catalog:createGroup", { name: "Vitrina del escaparate" });

    expect(ensureStarterGroups(env.db)).toBe(0);
    expect(env.db.select().from(s.productGroups).all().map((g) => g.name)).toEqual(["Vitrina del escaparate"]);
  });

  it("does nothing at all on a till nobody has set up yet", () => {
    const untouched = freshTill();
    expect(ensureStarterGroups(untouched.db)).toBe(0);
    expect(untouched.db.select().from(s.productGroups).all()).toEqual([]);
  });
});

/* ----------------------------- 3 · what a day on a fresh till leaves behind */

describe("the database a fresh till produces", () => {
  it("passes db:audit --verify after onboarding and one sale cycle", async () => {
    const { ctx } = await onboard();
    await call("settings:save", { printerName: "Citizen CT-S310II" });

    const groupId = env.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ kind: string; product: { id: string } }>("catalog:save", {
      name: "Funda transparente iPhone 13",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 500,
      priceCents: 1290,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });

    await call("cash:open", { floatCents: 20000, breakdown: null });
    /* stock in through the real door: a receiving movement, not a hand-written
       cache row, because the audit's first check is that the two agree */
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora Madrid" });
    await call("stock:add", {
      entries: [
        {
          productId: saved.product.id,
          supplierId: supplier.id,
          qty: 4,
          unitCostCents: 500,
          imeis: [],
        },
      ],
    });

    const line = await call<{ kind: string; state: { docId: string; totalCents: number } }>("sale:addLine", {
      productId: saved.product.id,
      qty: 2,
    });
    await call("sale:complete", {
      docId: line.state.docId,
      tenders: [{ method: "cash", amountCents: line.state.totalCents }],
    });
    await call("cash:close", { countedCents: 20000 + line.state.totalCents, breakdown: null, reason: null });

    env.db.$client.close();

    /* the real audit, on the real file: the same command the shop visit runs
       with the developer standing there (DEPLOYMENT §9 step 10) */
    const result = spawnSync("node", [join(REPO, "apps/desktop/scripts/run-db-task.cjs"), "audit", "--verify"], {
      cwd: REPO,
      env: { ...process.env, ARKOM_DB_PATH: env.file },
      encoding: "utf8",
      timeout: 240_000,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(output, output).toContain("OK");
    expect(output, output).not.toMatch(/\bFAIL\b/);
    expect(result.status, output).toBe(0);

    void ctx;
  }, 240_000);
});
