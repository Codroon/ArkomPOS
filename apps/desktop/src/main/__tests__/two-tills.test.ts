/**
 * Two tills in one shop — ADR-0022, end to end.
 *
 * This is the test the whole ADR exists for, and it is written as the shop
 * described the problem rather than as the code describes itself: *"caja 2 has
 * the real stock."*
 *
 * Arkom enrolled two tills on consecutive days and the dashboard showed two
 * businesses — one with 31 products and 5 sales, one with 377 products and 237
 * stock movements, with nothing in common. Every rule in the repo was obeyed.
 * There was simply no way for a till to say "I am another counter in a shop
 * that already exists", so each install founded one.
 *
 * So: two REAL SQLite databases, the REAL ingest and pull rules behind a fetch
 * that routes by path, and two real tills that have never heard of each other.
 * Nothing here is a description of the other side. If a column does not
 * replicate, a foreign key lands out of order, or the on-hand figure drifts by
 * one, it fails here rather than at a counter in Alcalá.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s, type ArkomDb } from "@arkom/db";
import { handlers, app } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext, tillContext } from "../context";
import { resetLinkCache, readLink } from "../sync/link";
import { pushAll, resetSyncState } from "../sync/push";
import { pullAll, resetReceiveState } from "../sync/receive";
import { enrolSettled } from "../sync/enrol";
import { ingest as cloudIngest } from "../../../../web/src/sync/ingest";
import { enrol as cloudEnrol } from "../../../../web/src/sync/enrol";
import { pull as cloudPull } from "../../../../web/src/sync/pull";
import { memoryStore, type MemoryStore } from "../../../../web/src/sync/__tests__/memory-store";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const URL_BASE = "https://cloud.arkom.es";

const WIZARD = {
  shopLegalName: "Arkom Móviles S.L.",
  shopNif: "B12345674",
  shopAddress: "Calle Mayor 3",
  shopCity: "Alcalá de Henares",
  shopPostalCode: "28801",
  shopPhone: "918 000 111",
  ticketFooter: "Gracias por su visita",
  seriesPrefix: "T1-",
  loadDemo: false,
  locale: "es" as const,
};

interface Till {
  db: ArkomDb;
  userData: string;
  name: string;
  owner: { id: string; name: string };
}

let cloud: MemoryStore;
let accountId: string;
let current: Till | null = null;

const call = async <T,>(channel: string, payload?: unknown): Promise<T> =>
  (await handlers.get(channel)!({}, payload)) as T;

/**
 * Point the process at one till.
 *
 * Both tills run in one Node, and the three things that are module state —
 * the IPC handler map, the till context cache and the `cloud-link.json` cache —
 * have to follow. Doing it in one function is what stops a case from asserting
 * about till 2 while reading till 1's link.
 */
function use(till: Till): void {
  current = till;
  (app as unknown as { getPath: () => string }).getPath = () => till.userData;
  handlers.clear();
  resetTillContext();
  resetLinkCache();
  resetSyncState();
  resetReceiveState();
  registerIpcHandlers(till.db);
  startSession({ id: till.owner.id, name: till.owner.name, role: "owner", overrides: {} });
}

/** A fresh machine: its own database, its own userData, its own first run. */
async function install(name: string, seriesPrefix: string): Promise<Till> {
  const dir = mkdtempSync(join(tmpdir(), "arkom-till-"));
  const userData = mkdtempSync(join(tmpdir(), "arkom-ud-"));
  const db = openDb(join(dir, "till.db")).db;
  runMigrations(db, MIGRATIONS);

  const till: Till = { db, userData, name, owner: { id: "", name: "" } };
  (app as unknown as { getPath: () => string }).getPath = () => userData;
  handlers.clear();
  resetTillContext();
  resetLinkCache();
  registerIpcHandlers(db);

  await call("setup:complete", { ...WIZARD, terminalName: name, seriesPrefix });
  const owner = await call<{ user: { id: string; name: string } }>("setup:owner", {
    name: "Ahmer",
    pin: "8317",
  });
  till.owner = { id: owner.user.id, name: owner.user.name };
  use(till);
  await call("settings:save", { printerName: "Citizen CT-S310II" });
  return till;
}

/** The cloud, as far as a till can tell: the real rules behind a router. */
function stubCloud(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const target = new URL(String(url));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const authorization = headers.authorization ?? null;
      const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : {};

      const result =
        target.pathname === "/api/enrol"
          ? await cloudEnrol(cloud, body)
          : target.pathname === "/api/sync"
            ? await cloudIngest(cloud, { authorization, body })
            : target.pathname === "/api/sync/pull"
              ? await cloudPull(
                  cloud,
                  { authorization, query: Object.fromEntries(target.searchParams) },
                  /*
                   * The settle window (§4) is five seconds of real time, and no
                   * test should sleep through it. The cloud's clock is pushed
                   * forward so rows written a moment ago count as settled. The
                   * window itself is the SUBJECT of the cloud's own
                   * `pull.test.ts`, which asserts both that an unsettled row is
                   * withheld and that the cursor does not step over it.
                   */
                  new Date(Date.now() + 60_000),
                )
              : { status: 404, body: { error: "NOT_FOUND" } };

      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body,
      } as Response;
    }),
  );
}

/**
 * Enrol the till that is currently in use, and wait for its first exchange.
 *
 * The wait is what makes two tills in one process deterministic: enrolment
 * kicks off a push and a pull that production deliberately does not await, and
 * a stray one landing after this test has switched tills would read the other
 * till's link. See `enrolSettled`.
 */
async function link(): Promise<{ linked: boolean }> {
  const result = await call<{ linked: boolean }>("cloud:enrol", {
    url: URL_BASE,
    code: cloud.addCode(accountId),
  });
  await enrolSettled();
  return result;
}

/** Push until the cloud has it all. */
async function send(till: Till): Promise<void> {
  use(till);
  for (let round = 0; round < 10; round += 1) {
    const status = await pushAll(till.db, { force: true });
    if (status.pending === 0 || status.lastError) break;
  }
}

/** Pull until there is nothing more, then apply what is left. */
async function receive(till: Till): Promise<void> {
  use(till);
  for (let round = 0; round < 10; round += 1) {
    const before = readLink()?.lastPulledIngestSeq ?? 0;
    const status = await pullAll(till.db, { force: true });
    resetReceiveState(); /* the drain's own backoff, not this test's business */
    if (status.lastError) break;
    if ((readLink()?.lastPulledIngestSeq ?? 0) <= before && status.pending === 0) break;
  }
}

const onHand = (till: Till, productId: string): number =>
  till.db.select().from(s.productStock).where(eq(s.productStock.productId, productId)).all()[0]?.onHand ?? 0;

beforeEach(() => {
  endSession();
  cloud = memoryStore();
  accountId = cloud.addAccount("Arkom");
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLinkCache();
  resetTillContext();
  endSession();
  current = null;
});

describe("the second till joins the shop instead of founding one", () => {
  it("adopts the shop's keys, so the dashboard shows ONE business", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const shopTenant = tillContext(one.db).ctx.tenantId;

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    const before = tillContext(two.db).ctx.tenantId;
    expect(before).not.toBe(shopTenant); /* it really did invent its own */

    await link();

    /* the bug, asserted away: one tenant, two terminals */
    resetTillContext();
    expect(tillContext(two.db).ctx.tenantId).toBe(shopTenant);
    expect(cloud.tenants.size).toBe(1);
    expect([...cloud.devices.values()].map((d) => d.terminalId).sort()).toHaveLength(2);
  });

  it("does not rename the shop with whatever the second wizard was told", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    expect([...cloud.tenants.values()][0]!.name).toBe(WIZARD.shopLegalName);
  });

  it("keeps its own document series, because a number may not be issued twice", async () => {
    /* ADR-0008 is NOT reopened by any of this: the shop is shared, the
       numbering is not, and two tills sharing a series would be two tills
       issuing invoice T1-000001. */
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    /* five series per till — ticket, refund, repair, purchase, shift — and the
       SALE one is this till's own. Nothing carries till 1's prefix. */
    const series = two.db.select().from(s.numberSeries).all();
    expect(series.find((row) => row.docType === "ticket")?.prefix).toBe("T2-");
    expect(series.map((row) => row.prefix)).not.toContain("T1-");
    expect(series).toHaveLength(5);
  });

  it("does not push the shop it invented at first run", async () => {
    /*
     * The echo's quieter cousin. A joining till's oplog legitimately contains
     * "create tenant", "create location" and six seeded product groups for a
     * business that never traded. Pushing them would put six phantom groups in
     * the shop's stream and show twelve on the dashboard.
     */
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    await send(one);
    const groupsAfterFirst = cloud
      .entriesFor(tillContext(one.db).ctx.tenantId)
      .filter((e) => e.entity === "product_group").length;
    expect(groupsAfterFirst).toBeGreaterThan(0);

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();
    await send(two);

    resetTillContext();
    use(one);
    const shopTenant = tillContext(one.db).ctx.tenantId;
    const groupsNow = cloud.entriesFor(shopTenant).filter((e) => e.entity === "product_group").length;
    expect(groupsNow).toBe(groupsAfterFirst);
  });

  it("keeps its own printer, because a setting is not the shop's (§1)", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await call("settings:save", { printerName: "Epson TM-T20III" });
    await link();
    await send(one);

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await call("settings:save", { printerName: "Citizen CT-S310II" });
    await link();
    await receive(two);

    const settings = await call<{ printerName: string }>("settings:get");
    expect(settings.printerName).toBe("Citizen CT-S310II");
  });
});

describe("the stock is one number", () => {
  it("a receipt of stock at till 1 is on the shelf at till 2", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();

    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    /* till 1 does a morning's work */
    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Cable USB-C 1m",
      barcode: "8412345678905",
      groupId,
      itemType: "stocked",
      costCents: 300,
      priceCents: 890,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    await call("stock:add", {
      entries: [{ productId: saved.product.id, supplierId: supplier.id, qty: 10, unitCostCents: 300, imeis: [] }],
    });

    await send(one);
    await receive(two);

    /* the catalogue arrived */
    const product = two.db.select().from(s.products).where(eq(s.products.id, saved.product.id)).all()[0];
    expect(product?.name).toBe("Cable USB-C 1m");
    expect(product?.priceCents).toBe(890);

    /* the barcode on the product row came with it */
    expect(product?.barcode).toBe("8412345678905");

    /* and a SECOND code, added at till 1 the way the Códigos panel does, scans
       at the other counter too — `product_codes` is its own replicated entity */
    use(one);
    await call("catalog:addCode", { productId: saved.product.id, code: "8400000000017" });
    await send(one);
    await receive(two);

    const codes = two.db.select().from(s.productCodes).all();
    expect(codes.map((c) => c.code)).toContain("8400000000017");

    /* and the shelf agrees, to the unit */
    expect(onHand(two, saved.product.id)).toBe(10);
    expect(onHand(two, saved.product.id)).toBe(onHand(one, saved.product.id));
  });

  it("a SALE at till 1 takes the phone off the shelf at till 2", async () => {
    /* the sentence the client used: "if there is 1 sale on till 1, it should
       also show on till 4" — as the thing that actually matters, the stock */
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Funda iPhone 14",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 400,
      priceCents: 1290,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    await call("stock:add", {
      entries: [{ productId: saved.product.id, supplierId: supplier.id, qty: 5, unitCostCents: 400, imeis: [] }],
    });
    await call("cash:open", { floatCents: 20000, breakdown: null });
    const lined = await call<{ state: { docId: string; totalCents: number } }>("sale:addLine", {
      productId: saved.product.id,
      qty: 2,
    });
    await call("sale:complete", {
      docId: lined.state.docId,
      tenders: [{ method: "cash", amountCents: lined.state.totalCents }],
    });

    expect(onHand(one, saved.product.id)).toBe(3);

    await send(one);
    await receive(two);

    expect(onHand(two, saved.product.id)).toBe(3);
  });

  it("the sale's own document stays at till 1, and so does its shift (§8)", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Protector de pantalla",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 100,
      priceCents: 500,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    await call("stock:add", {
      entries: [{ productId: saved.product.id, supplierId: supplier.id, qty: 4, unitCostCents: 100, imeis: [] }],
    });
    await call("cash:open", { floatCents: 10000, breakdown: null });
    const lined = await call<{ state: { docId: string; totalCents: number } }>("sale:addLine", {
      productId: saved.product.id,
      qty: 1,
    });
    await call("sale:complete", {
      docId: lined.state.docId,
      tenders: [{ method: "cash", amountCents: lined.state.totalCents }],
    });

    await send(one);
    await receive(two);

    /* the stock moved; the paperwork did not */
    expect(onHand(two, saved.product.id)).toBe(3);
    expect(two.db.select().from(s.documents).all()).toHaveLength(0);
    expect(two.db.select().from(s.shifts).all()).toHaveLength(0);
    expect(two.db.select().from(s.cashMovements).all()).toHaveLength(0);
    /* ...and till 2's drawer is still its own business */
    expect(two.db.select().from(s.documentTenders).all()).toHaveLength(0);
  });

  it("both directions: each till sees the other's work", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    const makeProduct = async (till: Till, name: string, qty: number) => {
      use(till);
      const groupId = till.db.select().from(s.productGroups).all()[0]!.id;
      const saved = await call<{ product: { id: string } }>("catalog:save", {
        name,
        barcode: null,
        groupId,
        itemType: "stocked",
        costCents: 200,
        priceCents: 999,
        taxRegime: "IVA21",
        reorderPoint: 0,
        lowStockThreshold: 0,
        active: true,
      });
      const supplier = await call<{ id: string }>("supplier:create", { name: `Prov ${name}` });
      await call("stock:add", {
        entries: [{ productId: saved.product.id, supplierId: supplier.id, qty, unitCostCents: 200, imeis: [] }],
      });
      return saved.product.id;
    };

    const fromOne = await makeProduct(one, "Cargador 20W", 6);
    const fromTwo = await makeProduct(two, "Auriculares", 9);

    await send(one);
    await send(two);
    await receive(one);
    await receive(two);

    for (const till of [one, two]) {
      expect(onHand(till, fromOne), `${till.name} / Cargador`).toBe(6);
      expect(onHand(till, fromTwo), `${till.name} / Auriculares`).toBe(9);
    }

    /* and the catalogue is the same list on both, which is the other half of
       what the shop asked for */
    const names = (till: Till) =>
      till.db.select().from(s.products).all().map((p) => p.name).sort();
    expect(names(one)).toEqual(names(two));
  });

  it("the cache equals the ledger on the till that only RECEIVED it", async () => {
    /*
     * `pnpm db:audit` asserts `product_stock` is the sum of the movements, and
     * that is now also the check that replication landed — so it has to hold on
     * a till that computed the figure from somebody else's movements.
     */
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Batería externa",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 800,
      priceCents: 1990,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    /* three separate receipts, so the sum is not the same as the last one */
    for (const qty of [3, 4, 5]) {
      await call("stock:add", {
        entries: [{ productId: saved.product.id, supplierId: supplier.id, qty, unitCostCents: 800, imeis: [] }],
      });
    }

    await send(one);
    await receive(two);

    const movements = two.db
      .select()
      .from(s.stockMovements)
      .where(eq(s.stockMovements.productId, saved.product.id))
      .all();
    const sum = movements.reduce((total, m) => total + m.qty, 0);

    expect(movements).toHaveLength(3);
    expect(sum).toBe(12);
    expect(onHand(two, saved.product.id)).toBe(sum);
  });
});

describe("what a till refuses to be told", () => {
  it("writes no oplog entry while absorbing, so no echo can form (§6)", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Soporte de coche",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 150,
      priceCents: 700,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    await send(one);

    use(two);
    const oplogBefore = two.db.select().from(s.oplog).all().length;
    await receive(two);

    /* the product arrived */
    expect(two.db.select().from(s.products).where(eq(s.products.id, saved.product.id)).all()).toHaveLength(1);
    /* and till 2 claimed none of it as its own doing */
    expect(two.db.select().from(s.oplog).all().length).toBe(oplogBefore);

    /* so a second push from till 2 sends nothing new about that product */
    const entriesBefore = cloud.entriesFor(tillContext(two.db).ctx.tenantId).length;
    await send(two);
    expect(cloud.entriesFor(tillContext(two.db).ctx.tenantId).length).toBe(entriesBefore);
  });

  it("never receives PIN material, whatever the other till stored", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    await send(one);
    await receive(two);

    /* till 2 has its own staff and nobody else's hashes */
    const inbox = two.db.select().from(s.syncInbox).all();
    const text = JSON.stringify(inbox);
    for (const key of ["pinHash", "pinSalt", "recoveryCodeHash", "devicePasscode"]) {
      expect(text, key).not.toContain(key);
    }
    expect(inbox.every((row) => row.entity !== "user")).toBe(true);
  });

  it("leaves nothing pending once a batch has landed", async () => {
    const one = await install("Caja 1", "T1-");
    stubCloud();
    use(one);
    await link();
    const two = await install("Caja 2", "T2-");
    stubCloud();
    use(two);
    await link();

    use(one);
    const groupId = one.db.select().from(s.productGroups).all()[0]!.id;
    const saved = await call<{ product: { id: string } }>("catalog:save", {
      name: "Adaptador jack",
      barcode: null,
      groupId,
      itemType: "stocked",
      costCents: 120,
      priceCents: 450,
      taxRegime: "IVA21",
      reorderPoint: 0,
      lowStockThreshold: 0,
      active: true,
    });
    const supplier = await call<{ id: string }>("supplier:create", { name: "Distribuidora" });
    await call("stock:add", {
      entries: [{ productId: saved.product.id, supplierId: supplier.id, qty: 2, unitCostCents: 120, imeis: [] }],
    });
    await send(one);
    await receive(two);

    const pending = two.db.select().from(s.syncInbox).all().filter((r) => r.appliedAt === null);
    expect(pending.map((r) => `${r.entity}: ${String(r.lastError)}`)).toEqual([]);
  });
});
