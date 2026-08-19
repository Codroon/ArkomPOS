/**
 * SQLite client per ADR-0003: better-sqlite3, WAL, synchronous=NORMAL,
 * foreign keys on. Synchronous API — no async ceremony in the main process.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export function openDb(dbPath: string) {
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export type ArkomDb = ReturnType<typeof openDb>["db"];
