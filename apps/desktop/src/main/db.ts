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
import type BetterSqlite3 from "better-sqlite3";

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

/**
 * The raw better-sqlite3 handle, kept because SQLite's ONLINE BACKUP API lives
 * on it. Backing up a live database by copying the file is a way to produce a
 * corrupt copy — WAL means the bytes on disk are not the database.
 */
let sqliteHandle: BetterSqlite3.Database | null = null;

export function rawSqlite(): BetterSqlite3.Database {
  if (!sqliteHandle) throw new Error("initDb() has not run yet");
  return sqliteHandle;
}

export function initDb(): ArkomDb {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const { sqlite, db } = openDb(dbPath);
  sqliteHandle = sqlite;
  runMigrations(db, resolveMigrationsDir());
  return db;
}
