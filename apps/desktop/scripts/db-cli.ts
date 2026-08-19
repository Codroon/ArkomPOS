/**
 * DB task entrypoint (migrate | seed | stats). Not run with plain `node`:
 * better-sqlite3 is rebuilt for the Electron ABI, so this file is bundled and
 * executed under Electron's Node (ELECTRON_RUN_AS_NODE) by
 * scripts/run-db-task.cjs. Env: ARKOM_DB_PATH, ARKOM_MIGRATIONS_DIR.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb, runMigrations } from "@arkom/db";
import { seed } from "./db-seed";

const task = process.argv[2];
const dbPath = process.env.ARKOM_DB_PATH;
const migrationsDir = process.env.ARKOM_MIGRATIONS_DIR;

if (!task || !dbPath || !migrationsDir) {
  console.error("Usage: run-db-task.cjs <migrate|seed|stats> (ARKOM_DB_PATH / ARKOM_MIGRATIONS_DIR must be set)");
  process.exit(2);
}

mkdirSync(dirname(dbPath), { recursive: true });
const { sqlite, db } = openDb(dbPath);

try {
  switch (task) {
    case "migrate": {
      runMigrations(db, migrationsDir);
      console.log(`Migrations applied → ${dbPath}`);
      break;
    }
    case "seed": {
      runMigrations(db, migrationsDir); // seed on a fresh checkout just works
      const result = seed(db);
      console.log(result.message);
      break;
    }
    case "stats": {
      const tables = [
        "tenants", "locations", "terminals", "number_series", "product_groups",
        "suppliers", "products", "units", "stock_movements", "product_stock", "oplog",
      ];
      for (const name of tables) {
        const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number };
        console.log(`${name.padEnd(18)} ${String(row.c).padStart(5)}`);
      }
      break;
    }
    default:
      console.error(`Unknown task: ${task}`);
      process.exit(2);
  }
} finally {
  sqlite.close();
}
