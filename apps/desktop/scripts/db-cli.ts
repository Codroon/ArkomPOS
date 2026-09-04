/**
 * DB task entrypoint (migrate | seed | stats). Not run with plain `node`:
 * better-sqlite3 is rebuilt for the Electron ABI, so this file is bundled and
 * executed under Electron's Node (ELECTRON_RUN_AS_NODE) by
 * scripts/run-db-task.cjs. Env: ARKOM_DB_PATH, ARKOM_MIGRATIONS_DIR.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb, runDataFixups, runMigrations } from "@arkom/db";
import { uuidv7, groupNameKey, starterEnglishName} from "@arkom/core";
import { ensureStarterGroups } from "../src/main/setup";
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
      /* the same two steps the app runs at startup — a CLI that migrated
         differently from the app would be a way to produce a database the app
         has never seen */
      /* the SAME mapper the app boots with: a database migrated from the CLI and
         one opened by the app must come out identical (v1.0.0) */
      ensureStarterGroups(db);
      const fixups = runDataFixups(db, uuidv7, (name) =>
        starterEnglishName(name) ?? (groupNameKey(name) === "usados" ? "Used" : null));
      console.log(`Migrations applied → ${dbPath}`);
      if (fixups.payoutsBackfilled > 0) {
        console.log(`Cash ledger: backfilled ${fixups.payoutsBackfilled} used-device payout(s).`);
      }
      break;
    }
    case "seed": {
      runMigrations(db, migrationsDir); // seed on a fresh checkout just works
      runDataFixups(db, uuidv7, (name) =>
        starterEnglishName(name) ?? (groupNameKey(name) === "usados" ? "Used" : null));
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
