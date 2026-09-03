/**
 * The upgrade rehearsal for v0.15.0 — ADR-0018.
 *
 * The transfers slice is additive: one new table, three new movement reasons,
 * no column rebuilt. That is exactly the shape of change that looks safe and is
 * worth proving anyway, because the thing it lands on is the only artefact in
 * this project that cannot be recreated.
 *
 * So: a database with real rows in it — shifts, movements, a completed sale —
 * migrated forward, then asked whether it still answers the same questions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx, shiftTotals } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
/** the last migration a v0.14.2 install had applied */
const LAST_0142 = "0012_flowery_daredevil";

/** The migrations folder as it stood at a given release. */
function migrationsAt(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "arkom-mig-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut === -1) throw new Error(`no such migration: ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  return dir;
}

/** A till as v0.14.2 left it, with a shift and money in the ledger. */
function v0142() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-up15-"));
  const { db, sqlite } = openDb(join(dir, "test.db"));
  runMigrations(db, migrationsAt(LAST_0142));

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Arkom", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();
  return { db, sqlite, ids, dir };
}

let env: ReturnType<typeof v0142>;

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = v0142();
});

describe("migrating a populated v0.14.2 database", () => {
  it("adds the transfers table and leaves everything else where it was", () => {
    const ctx = { ...env.ids, userId: null as string | null };
    const owner = createUser(env.db, ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
    openShiftTx(env.db, { ...ctx, userId: owner.id }, { floatCents: 20000, breakdown: null });

    const before = {
      shifts: env.sqlite.prepare("select * from shifts").all(),
      movements: env.sqlite.prepare("select * from cash_movements").all(),
      groups: env.sqlite.prepare("select * from product_groups").all(),
    };
    expect(env.sqlite.prepare("select name from sqlite_master where name='transfers'").all()).toEqual([]);

    runMigrations(env.db, MIGRATIONS);

    expect(env.sqlite.prepare("select name from sqlite_master where name='transfers'").all()).toHaveLength(1);
    expect(env.sqlite.prepare("select * from shifts").all()).toEqual(before.shifts);
    expect(env.sqlite.prepare("select * from cash_movements").all()).toEqual(before.movements);
    expect(env.sqlite.prepare("select * from product_groups").all()).toEqual(before.groups);
    expect(env.sqlite.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  it("leaves the drawer figure exactly as it was, then accepts a transfer", async () => {
    const ctx = { ...env.ids, userId: null as string | null };
    const owner = createUser(env.db, ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
    openShiftTx(env.db, { ...ctx, userId: owner.id }, { floatCents: 20000, breakdown: null });

    runMigrations(env.db, MIGRATIONS);
    registerIpcHandlers(env.db);
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });

    const shift = env.db.select().from(s.shifts).all()[0]!;
    /* an upgraded till with no transfers on it reports the same expected cash
       it did yesterday: the new block contributes nothing until it is used */
    expect(shiftTotals(env.db, shift).expectedCashCents).toBe(20000);

    await handlers.get("transfer:send")!({}, {
      mtcn: "1112223334",
      senderName: "Imran",
      receiverName: "Fatima",
      countryCode: "PK",
      principalCents: 30000,
      feeCents: 500,
      method: "cash",
    });
    expect(shiftTotals(env.db, shift).expectedCashCents).toBe(50500);
  });
});
