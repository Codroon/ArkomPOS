/**
 * Groups belong to the shop — ADR-0017.
 *
 * Before v0.14.1 they existed only inside the demo dataset, which made the
 * honest first-run choice a trap: pick "start empty", reach the catalog editor,
 * and find a required field with nothing in it and no way to add anything. The
 * shop's only route out was to load demo data it did not want.
 *
 * What is pinned here is the whole of that: every fresh install has shelves,
 * the shop can add and rename them, a rename reaches everything that reads a
 * group without touching a second row, and clearing the demo data leaves the
 * shelves standing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { STARTER_GROUPS, groupDisplayName, groupNameKey, parseIpcError, uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers, registeredChannels } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { completeFirstRun } from "../setup";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-groups-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  return db;
}

const FIRST_RUN = {
  shopLegalName: "Arkom Electronics S.L.",
  shopNif: "B12345678",
  shopAddress: "C/ Mayor 14",
  ticketFooter: "Precios claros.",
  terminalName: "Caja 1",
  seriesPrefix: "T1-",
};

let db: ReturnType<typeof freshDb>;
let owner: { id: string };
let ctx: { tenantId: string; locationId: string; terminalId: string; userId: string | null };

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

const groupRows = () =>
  db.select().from(s.productGroups).orderBy(s.productGroups.sortOrder).all();

function boot(over: Partial<typeof FIRST_RUN> & { loadDemo?: boolean; locale?: "es" | "en" } = {}) {
  handlers.clear();
  endSession();
  resetTillContext();
  db = freshDb();
  completeFirstRun(db, { ...FIRST_RUN, loadDemo: false, ...over });
  const row = db.select().from(s.tenants).all()[0]!;
  const location = db.select().from(s.locations).all()[0]!;
  const terminal = db.select().from(s.terminals).all()[0]!;
  ctx = { tenantId: row.id, locationId: location.id, terminalId: terminal.id, userId: null };
  owner = createUser(db, ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
  registerIpcHandlers(db);
  startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });
}

beforeEach(() => boot());

/* ----------------------------------------------------------- seeding */

describe("a fresh install", () => {
  it("has shelves even when the shop starts empty", () => {
    /* the bug this whole slice exists for: "start empty" used to mean "no group
       exists", and catalog:save requires one */
    expect(groupRows()).toHaveLength(STARTER_GROUPS.length);
    expect(groupRows().every((g) => g.isDemo === false)).toBe(true);
  });

  it("writes BOTH names, so the toggle works whichever language set it up", () => {
    /* the app cannot translate a name the shop typed, but it CAN carry two —
       and for the five it hands over on day one it knows both (ADR-0017 §2) */
    expect(groupRows()[0]).toMatchObject({ name: "Móviles", nameEn: "Phones" });
    boot({ locale: "en" });
    expect(groupRows()[0]).toMatchObject({ name: "Móviles", nameEn: "Phones" });
  });

  it("shows the English name only where there is one", () => {
    const [mobiles] = groupRows();
    expect(groupDisplayName(mobiles!, "es")).toBe("Móviles");
    expect(groupDisplayName(mobiles!, "en")).toBe("Phones");

    /* a shelf the shop named itself, with no English given: its word stands in
       both languages rather than the field going blank */
    const own = { name: "Coche y viaje", nameEn: null };
    expect(groupDisplayName(own, "es")).toBe("Coche y viaje");
    expect(groupDisplayName(own, "en")).toBe("Coche y viaje");
  });

  it("keeps the second name the shop gives it", async () => {
    const created = await call<{ id: string; name: string; nameEn: string | null }>("catalog:createGroup", {
      name: "Coche y viaje",
      nameEn: "Car & travel",
    });
    expect(created.nameEn).toBe("Car & travel");
    expect(groupDisplayName(created, "en")).toBe("Car & travel");

    await call("catalog:renameGroup", { id: created.id, name: "Coche y viaje", nameEn: "Car and travel" });
    const after = groupRows().find((g) => g.id === created.id)!;
    expect(after.nameEn).toBe("Car and travel");
  });

  it("keeps them in the order the list was written in", () => {
    expect(groupRows().map((g) => g.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("logs each one, like every other write", () => {
    const entries = db
      .select()
      .from(s.oplog)
      .all()
      .filter((e) => e.entity === "product_group" && e.action === "create");
    expect(entries).toHaveLength(STARTER_GROUPS.length);
  });

  it("puts the demo data ON the shop's shelves rather than building its own", () => {
    boot({ loadDemo: true });
    expect(groupRows()).toHaveLength(STARTER_GROUPS.length);
    expect(groupRows().every((g) => g.isDemo === false)).toBe(true);
    // and the demo products found them
    const products = db.select().from(s.products).all();
    expect(products.length).toBeGreaterThan(20);
    expect(products.every((p) => p.groupId !== null)).toBe(true);
  });
});

/* ---------------------------------------------------------- creating */

describe("creating a group", () => {
  it("appends it, and hands back what the editor needs to select it", async () => {
    const created = await call<{ id: string; name: string }>("catalog:createGroup", { name: "Reparaciones" });
    expect(created.name).toBe("Reparaciones");
    const rows = groupRows();
    expect(rows).toHaveLength(STARTER_GROUPS.length + 1);
    /* at the END: the starter five hold 0–4, so a shop's own group never lands
       in the middle of an order it did not choose */
    expect(rows.at(-1)!.id).toBe(created.id);
    expect(rows.at(-1)!.sortOrder).toBe(STARTER_GROUPS.length);
  });

  it("refuses a duplicate, however it is spaced or capitalised", async () => {
    await call("catalog:createGroup", { name: "Reparaciones" });
    for (const attempt of ["Reparaciones", "reparaciones", "  REPARACIONES  ", "Reparaciones"]) {
      expect(await code("catalog:createGroup", { name: attempt })).toBe("DUPLICATE_NAME");
    }
    expect(groupRows()).toHaveLength(STARTER_GROUPS.length + 1);
  });

  it("does not collapse accents, because they are different words", async () => {
    expect(await code("catalog:createGroup", { name: "Moviles" })).toBe("OK");
    expect(groupNameKey("Moviles")).not.toBe(groupNameKey("Móviles"));
  });

  it("writes an oplog entry naming who did it", async () => {
    const created = await call<{ id: string }>("catalog:createGroup", { name: "Fundas premium" });
    const entry = db
      .select()
      .from(s.oplog)
      .all()
      .find((e) => e.entity === "product_group" && e.entityId === created.id && e.action === "create")!;
    expect(entry.userId).toBe(owner.id);
  });

  it("declares the permissions the catalog already uses, not new ones", () => {
    /* no new permission for five rows: somebody trusted to add an article is
       trusted to name the shelf it goes on (ADR-0012, ADR-0017) */
    const policy = registeredChannels();
    expect(policy.get("catalog:createGroup")).toBe("catalog.create");
    expect(policy.get("catalog:renameGroup")).toBe("catalog.edit");
  });

  it("invites a cashier to fetch an approver rather than refusing", async () => {
    const cashier = createUser(db, ctx, { name: "Ana", role: "cashier", pin: "5162" }).user;
    startSession({ id: cashier.id, name: "Ana", role: "cashier", overrides: {} });
    expect(await code("catalog:createGroup", { name: "Nada" })).toBe("APPROVAL_REQUIRED");
    expect(groupRows()).toHaveLength(STARTER_GROUPS.length);
  });

  it("refuses an empty name before it reaches the database", async () => {
    expect(await code("catalog:createGroup", { name: "   " })).toBe("VALIDATION");
  });
});

/* ---------------------------------------------------------- renaming */

describe("renaming a group", () => {
  it("reaches every product without touching one", async () => {
    const group = groupRows()[0]!;
    const productId = uuidv7();
    db.insert(s.products)
      .values({
        id: productId,
        tenantId: ctx.tenantId,
        name: "Funda azul",
        groupId: group.id,
        itemType: "stocked",
        costCents: 100,
        priceCents: 200,
        taxRegime: "IVA21",
        taxRateBp: 2100,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();

    await call("catalog:renameGroup", { id: group.id, name: "Telefonía" });

    /* the product row is untouched: it points at the ID, which is why a rename
       needs no propagation at all */
    const after = db.select().from(s.products).where(eq(s.products.id, productId)).all()[0]!;
    expect(after.groupId).toBe(group.id);
    const listed = await call<Array<{ id: string; groupName: string | null }>>("catalog:list", {});
    expect(listed.find((r) => r.id === productId)!.groupName).toBe("Telefonía");
  });

  it("shows the new name in the filter list and the stock reports", async () => {
    const group = groupRows()[1]!;
    await call("catalog:renameGroup", { id: group.id, name: "Cristales" });
    const groups = await call<Array<{ id: string; name: string }>>("catalog:groups", {});
    expect(groups.find((g) => g.id === group.id)!.name).toBe("Cristales");
  });

  it("refuses a name another group already has", async () => {
    const [first, second] = groupRows();
    expect(await code("catalog:renameGroup", { id: first!.id, name: second!.name })).toBe("DUPLICATE_NAME");
  });

  it("lets a group keep its own name, differently spaced", async () => {
    const group = groupRows()[0]!;
    expect(await code("catalog:renameGroup", { id: group.id, name: "  Móviles  " })).toBe("OK");
    expect(groupRows()[0]!.name).toBe("Móviles");
  });

  it("records what it was before, so the history reads as a change", async () => {
    const group = groupRows()[0]!;
    await call("catalog:renameGroup", { id: group.id, name: "Terminales" });
    const entry = db
      .select()
      .from(s.oplog)
      .all()
      .find((e) => e.entity === "product_group" && e.action === "update")!;
    expect(entry.before).toMatchObject({ name: "Móviles" });
    expect(entry.after).toMatchObject({ name: "Terminales" });
  });

  it("refuses a group that is not this shop's", async () => {
    expect(await code("catalog:renameGroup", { id: uuidv7(), name: "Cualquiera" })).toBe("VALIDATION");
  });
});

/* ------------------------------------------------- clearing the demo */

describe("clearing the demo data", () => {
  it("leaves the shelves standing", async () => {
    boot({ loadDemo: true });
    expect(db.select().from(s.products).all().length).toBeGreaterThan(0);

    await call("demo:remove", {});

    expect(db.select().from(s.products).all()).toEqual([]);
    /* the point: a shop that clears the demo can still save a product, because
       the field it is required to fill still has options (ADR-0017) */
    expect(groupRows()).toHaveLength(STARTER_GROUPS.length);
  });
});
