/**
 * Applying migrations — used by the app at startup and by `pnpm db:migrate`.
 *
 * ## Why this is not a one-liner any more
 *
 * SQLite cannot drop a column constraint. To remove one, drizzle emits the
 * standard twelve-step dance: build `__new_table`, copy every row across, drop
 * the original, rename. It wraps that in `PRAGMA foreign_keys=OFF` / `=ON`,
 * because dropping a table whose children point at it is otherwise refused.
 *
 * **And that pragma is a no-op inside a transaction** — SQLite says so
 * explicitly — while `migrate()` opens one. So the OFF never took effect, the
 * enforcement stayed on, and `DROP TABLE repair_tickets` failed against any
 * database that had a repair with a part on it.
 *
 * That was found by copying a real database with 68 tickets and 47 lines in it
 * and running the migration at it. It would otherwise have been found by a shop
 * whose till would not start, because migrations run at launch. The one
 * table-rebuild migration that shipped before this (0010, `users`) worked only
 * because nothing has a foreign key into `users`.
 *
 * So the pragma is set HERE, outside the transaction, where it is honoured. A
 * migration is authored and reviewed code, so running it without enforcement is
 * the same trust we already extend to it; what is not acceptable is finding out
 * afterwards that it broke something, hence the check below.
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { ArkomDb } from "./client";

interface OrphanRow {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

export function runMigrations(db: ArkomDb, migrationsFolder: string): void {
  /* Outside any transaction, so it is honoured. Going through drizzle keeps the
     same connection the migrator will use — a pragma set on another handle
     would do nothing at all, which is a quieter version of the same bug. */
  db.run(sql`PRAGMA foreign_keys = OFF`);

  try {
    migrate(db, { migrationsFolder });
  } finally {
    /* restored even if a migration threw, so a failed startup does not leave a
       running app with enforcement silently off */
    db.run(sql`PRAGMA foreign_keys = ON`);
  }

  /**
   * Prove the migration did not leave a dangling row behind.
   *
   * This is the half that makes turning enforcement off acceptable. With it on,
   * a bad migration fails loudly and early; with it off, it succeeds and the
   * damage is found weeks later by a screen that renders a blank name. So the
   * integrity is checked once, immediately, against the whole database.
   *
   * `foreign_key_check` returns one row per violation and nothing when clean.
   * It is a full scan of the foreign keys, which on a shop's database is
   * milliseconds and happens once per launch, only after a migration ran.
   */
  const orphans = db.all<OrphanRow>(sql`PRAGMA foreign_key_check`);
  if (orphans.length > 0) {
    const where = orphans
      .slice(0, 5)
      .map((row) => `${row.table} → ${row.parent}`)
      .join(", ");
    throw new Error(
      `Migration left ${orphans.length} row(s) pointing at something that is not there: ${where}. ` +
        `The database has NOT been changed further; restore the backup taken before the upgrade.`,
    );
  }
}
