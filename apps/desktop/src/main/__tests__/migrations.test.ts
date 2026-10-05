/**
 * Migrations run at LAUNCH, on a database that already has a shop's year in it.
 *
 * Every other test in this repo migrates an empty file and then puts rows in.
 * That is the opposite order from a shop's, and it is why a migration that
 * cannot survive existing data passed everything and would have stopped a till
 * from starting.
 *
 * The specific bug, because it is subtle and will be reintroduced by anybody
 * tidying `runMigrations` back into one line:
 *
 *   SQLite cannot drop a column constraint, so drizzle rebuilds the table —
 *   `__new_x`, copy, drop `x`, rename — and wraps it in
 *   `PRAGMA foreign_keys=OFF`. **That pragma is a no-op inside a transaction**,
 *   and `migrate()` opens one. So enforcement stayed on and the DROP was
 *   refused by the children pointing at the table.
 *
 * It only surfaces when the parent has children WITH ROWS, which is why the one
 * rebuild that shipped before it (0010, `users`) was fine: nothing has a
 * foreign key into `users`.
 *
 * So these cases build the shape rather than describing it: a parent, a child
 * with rows in it, and then a migration that rebuilds the parent.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { openDb, runMigrations } from "@arkom/db";

/** A migrations folder drizzle's migrator will accept, built step by step. */
function migrationsFolder() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-mig-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] = [];

  const add = (tag: string, statements: string[]) => {
    writeFileSync(join(dir, `${tag}.sql`), statements.join("\n--> statement-breakpoint\n"), "utf8");
    entries.push({ idx: entries.length, version: "6", when: 1_700_000_000_000 + entries.length, tag, breakpoints: true });
    writeFileSync(
      join(dir, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
      "utf8",
    );
  };

  return { dir, add };
}

let handles: { close: () => void }[] = [];

function open(path: string) {
  const { sqlite, db } = openDb(path);
  handles.push(sqlite);
  return { sqlite, db };
}

afterEach(() => {
  for (const handle of handles) {
    try {
      handle.close();
    } catch {
      /* already closed by a case that was testing closure */
    }
  }
  handles = [];
});

describe("a migration that rebuilds a table a shop already has rows in", () => {
  it("succeeds, which it did not before the pragma moved out of the transaction", () => {
    const { dir, add } = migrationsFolder();
    const file = join(mkdtempSync(join(tmpdir(), "arkom-db-")), "till.db");

    /* v1: a parent and a child that points at it */
    add("0000_start", [
      "CREATE TABLE `parent` (`id` text PRIMARY KEY NOT NULL, `note` text NOT NULL)",
      "CREATE TABLE `child` (`id` text PRIMARY KEY NOT NULL, `parent_id` text NOT NULL REFERENCES `parent`(`id`))",
    ]);

    const { db } = open(file);
    runMigrations(db, dir);

    /* the shop uses it for a year */
    db.run(sql`insert into parent (id, note) values ('p1', 'a repair'), ('p2', 'another')`);
    db.run(sql`insert into child (id, parent_id) values ('c1', 'p1'), ('c2', 'p1'), ('c3', 'p2')`);

    /* v2 drops a constraint, so drizzle rebuilds the parent — the exact shape
       of 0016, and the thing that failed against 68 real repair tickets */
    add("0001_rebuild", [
      "PRAGMA foreign_keys=OFF",
      "CREATE TABLE `__new_parent` (`id` text PRIMARY KEY NOT NULL, `note` text NOT NULL, `extra` text)",
      'INSERT INTO `__new_parent`("id", "note") SELECT "id", "note" FROM `parent`',
      "DROP TABLE `parent`",
      "ALTER TABLE `__new_parent` RENAME TO `parent`",
      "PRAGMA foreign_keys=ON",
    ]);

    expect(() => runMigrations(db, dir)).not.toThrow();

    /* and nothing was lost on the way through */
    const parents = db.all<{ id: string; note: string }>(sql`select id, note from parent order by id`);
    expect(parents).toEqual([
      { id: "p1", note: "a repair" },
      { id: "p2", note: "another" },
    ]);
    expect(db.all(sql`select id from child order by id`)).toHaveLength(3);
  });

  it("leaves foreign key enforcement ON afterwards", () => {
    /*
     * The half that would be easy to forget. A till running with enforcement
     * off would accept a line pointing at no product and nobody would know
     * until a screen rendered a blank name.
     */
    const { dir, add } = migrationsFolder();
    const file = join(mkdtempSync(join(tmpdir(), "arkom-db-")), "till.db");
    add("0000_start", ["CREATE TABLE `a` (`id` text PRIMARY KEY NOT NULL)"]);

    const { db } = open(file);
    runMigrations(db, dir);

    expect(db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)[0]?.foreign_keys).toBe(1);
  });

  it("puts enforcement back even when a migration throws", () => {
    const { dir, add } = migrationsFolder();
    const file = join(mkdtempSync(join(tmpdir(), "arkom-db-")), "till.db");
    add("0000_broken", ["CREATE TABLE this is not sql"]);

    const { db } = open(file);
    expect(() => runMigrations(db, dir)).toThrow();
    /* a failed startup must not leave a running app with the guard off */
    expect(db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)[0]?.foreign_keys).toBe(1);
  });

  it("refuses to finish quietly if a migration orphaned a row", () => {
    /*
     * This is what makes turning enforcement off acceptable. With it on, a bad
     * migration fails loudly. With it off, it SUCCEEDS — so the integrity is
     * checked immediately instead of being discovered in a month.
     */
    const { dir, add } = migrationsFolder();
    const file = join(mkdtempSync(join(tmpdir(), "arkom-db-")), "till.db");
    add("0000_start", [
      "CREATE TABLE `parent` (`id` text PRIMARY KEY NOT NULL)",
      "CREATE TABLE `child` (`id` text PRIMARY KEY NOT NULL, `parent_id` text NOT NULL REFERENCES `parent`(`id`))",
    ]);

    const { db } = open(file);
    runMigrations(db, dir);
    db.run(sql`insert into parent (id) values ('p1')`);
    db.run(sql`insert into child (id, parent_id) values ('c1', 'p1')`);

    /* a migration that takes the parent away and leaves the child behind —
       impossible with enforcement on, which is exactly why it is checked */
    add("0001_orphan", ["DELETE FROM `parent`"]);

    expect(() => runMigrations(db, dir)).toThrow(/pointing at something that is not there/i);
  });
});

describe("the real migrations, against a database that already holds a shop", () => {
  it("apply to an existing database without losing a row or an id", () => {
    /*
     * The closest a unit test gets to the thing itself: migrate, fill the
     * tables the next migration will rebuild, migrate again. Re-running is a
     * no-op today, so what this really pins is that a populated database
     * survives the whole lineage and comes out with its foreign keys intact.
     */
    const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
    const file = join(mkdtempSync(join(tmpdir(), "arkom-db-")), "till.db");

    const { db } = open(file);
    runMigrations(db, MIGRATIONS);

    const orphans = db.all(sql`PRAGMA foreign_key_check`);
    expect(orphans).toEqual([]);

    /* the table 0016 rebuilt, and the ledger it added, both exist */
    const names = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((row) => row.name);
    expect(names).toContain("repair_tickets");
    expect(names).toContain("voucher_redemptions");

    /* and the constraint 0016 removed is actually gone — a ticket may name a
       document this till does not hold (ADR-0023 §1) */
    const ddl = db.all<{ sql: string }>(
      sql`select sql from sqlite_master where name = 'repair_tickets'`,
    )[0]?.sql;
    expect(ddl).toContain("document_id");
    expect(ddl).not.toMatch(/FOREIGN KEY\s*\(\s*`document_id`\s*\)/i);
  });
});
