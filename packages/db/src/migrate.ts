import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { ArkomDb } from "./client";

/** Apply all pending drizzle migrations (used by the app at startup and by `pnpm db:migrate`). */
export function runMigrations(db: ArkomDb, migrationsFolder: string): void {
  migrate(db, { migrationsFolder });
}
