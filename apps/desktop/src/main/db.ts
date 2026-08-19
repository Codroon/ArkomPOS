/**
 * Database bootstrap for the main process. Migrations run at startup so a
 * fresh install (or fresh checkout) always has the current schema.
 * Dev DB lives at <repo>/.data/arkom-pos.db (same default as `pnpm db:seed`);
 * packaged builds use Electron's userData dir (ADR-0003: single file there).
 */
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openDb, runMigrations, type ArkomDb } from "@arkom/db";

// out/main → apps/desktop → apps → repo root
const REPO_ROOT = join(__dirname, "../../../..");

export function resolveDbPath(): string {
  if (app.isPackaged) return join(app.getPath("userData"), "arkom-pos.db");
  return process.env.ARKOM_DB_PATH ?? join(REPO_ROOT, ".data/arkom-pos.db");
}

function resolveMigrationsDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "drizzle"); // electron-builder extraResources
  return join(REPO_ROOT, "packages/db/drizzle");
}

export function initDb(): ArkomDb {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const { db } = openDb(dbPath);
  runMigrations(db, resolveMigrationsDir());
  return db;
}
