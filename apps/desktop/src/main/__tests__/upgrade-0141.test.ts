/**
 * The upgrade rehearsal for v0.14.1.
 *
 * A shop's database is the only thing in this project that cannot be recreated,
 * and this release touches it in two ways that a fresh install never exercises:
 * the `users` table is REBUILT so `pin_hash` can be null (SQLite has no "drop
 * not null"), and the groups a pre-v0.14.1 till owns came in flagged as demo
 * data.
 *
 * So this builds a database the way v0.14.0 left one — rows in every table the
 * migration touches — runs the migrations forward, and asserts nothing was lost
 * and nothing was invented.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { removeDemoData } from "../setup";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
/** the last migration a v0.14.0 install had applied */
const LAST_0140 = "0009_brainy_amphibian";

function dbPath() {
  return join(mkdtempSync(join(tmpdir(), "arkom-upgrade-")), "test.db");
}

/**
 * The migrations folder as it stood at v0.14.0.
 *
 * drizzle's migrator has no "up to" argument, so the shape of an older install
 * is reproduced by handing it an older journal. This copies the real .sql files
 * — the ones that actually ran on the shop's machine — and trims the journal at
 * the last entry that release had.
 */
function migrationsAt(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "arkom-mig-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut === -1) throw new Error(`no such migration: ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  for (const entry of journal.entries) {
    copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  }
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  return dir;
}

/** A till as v0.14.0 left it: migrated to 0009, with rows the shop cares about. */
function v0140() {
  const { db, sqlite } = openDb(dbPath());
  runMigrations(db, migrationsAt(LAST_0140));

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Arkom", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();

  /* two real users, written the v0.14.0 way — every column populated, because
     what the rebuild must prove is that it carries all of them across */
  const owner = uuidv7();
  const cashier = uuidv7();
  db.insert(s.users)
    .values([
      {
        id: owner,
        ...ids,
        name: "Ahmer",
        role: "owner",
        pinHash: "scrypt$fake$owner",
        permissionOverrides: { "sale.price_override": true },
        active: true,
        failedAttempts: 2,
        lockedUntil: new Date(1893456000000),
        recoveryCodeHash: "rec$hash",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: cashier,
        ...ids,
        name: "Ana",
        role: "cashier",
        pinHash: "scrypt$fake$ana",
        active: false,
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();

  /* groups the old way: they arrived with the demo dataset and were flagged */
  const groupId = uuidv7();
  /* raw SQL on purpose: the drizzle schema has columns this old table does not,
     and the point of the rehearsal is to build the table as it WAS */
  sqlite
    .prepare("insert into product_groups (id, tenant_id, name, sort_order, is_demo, created_at) values (?,?,?,?,1,?)")
    .run(groupId, ids.tenantId, "Móviles", 0, now.getTime());
  const productId = uuidv7();
  db.insert(s.products)
    .values({
      id: productId,
      tenantId: ids.tenantId,
      name: "Funda azul",
      groupId,
      itemType: "stocked",
      costCents: 100,
      priceCents: 200,
      taxRegime: "IVA21",
      taxRateBp: 2100,
      active: true,
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { db, sqlite, ids, owner, cashier, groupId, productId };
}

let env: ReturnType<typeof v0140>;

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = v0140();
});

describe("migrating a populated v0.14.0 database", () => {
  it("rebuilds users without losing a column", () => {
    const before = env.sqlite.prepare("select * from users order by name").all();
    runMigrations(env.db, MIGRATIONS);
    const after = env.sqlite.prepare("select * from users order by name").all();
    /* the rebuild copies every column of every row. Comparing the whole rows is
       the assertion — naming them would let a new column slip through */
    expect(after).toEqual(before);
  });

  it("leaves both PINs intact and still NOT NULL in practice", () => {
    runMigrations(env.db, MIGRATIONS);
    const rows = env.db.select().from(s.users).all();
    expect(rows).toHaveLength(2);
    expect(rows.every((u) => u.pinHash !== null)).toBe(true);
  });

  it("accepts a PIN-less technician afterwards, which is the point of the rebuild", () => {
    runMigrations(env.db, MIGRATIONS);
    env.db
      .insert(s.users)
      .values({
        id: uuidv7(),
        ...env.ids,
        name: "Nuria",
        role: "technician",
        pinHash: null,
        active: true,
        failedAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    expect(env.db.select().from(s.users).all()).toHaveLength(3);
  });

  it("keeps the foreign keys pointing at the rebuilt rows", () => {
    runMigrations(env.db, MIGRATIONS);
    const violations = env.sqlite.prepare("pragma foreign_key_check").all();
    expect(violations).toEqual([]);
  });

  it("invents no groups for a till that already has them", () => {
    runMigrations(env.db, MIGRATIONS);
    /* seeding is a FIRST-RUN act, not a migration: an existing shop's shelves
       are its own, however few (ADR-0017) */
    expect(env.db.select().from(s.productGroups).all()).toHaveLength(1);
  });

  it("adopts the old demo-flagged group instead of deleting it", () => {
    runMigrations(env.db, MIGRATIONS);
    registerIpcHandlers(env.db);
    startSession({ id: env.owner, name: "Ahmer", role: "owner", overrides: {} });

    removeDemoData(env.db, { ...env.ids, userId: env.owner });

    expect(env.db.select().from(s.products).all()).toEqual([]);
    /* before v0.14.1 this left the shop with no group and no way to make one,
       so the next product could not be saved at all */
    const groups = env.db.select().from(s.productGroups).where(eq(s.productGroups.id, env.groupId)).all();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isDemo).toBe(false);
    expect(groups[0]!.name).toBe("Móviles");
  });
});
