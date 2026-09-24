/**
 * DB task entrypoint (migrate | seed | demo | stats | audit). Not run with plain `node`:
 * better-sqlite3 is rebuilt for the Electron ABI, so this file is bundled and
 * executed under Electron's Node (ELECTRON_RUN_AS_NODE) by
 * scripts/run-db-task.cjs. Env: ARKOM_DB_PATH, ARKOM_MIGRATIONS_DIR.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb, runDataFixups, runMigrations, schema } from "@arkom/db";
import { uuidv7, groupNameKey, starterEnglishName, type MutationCtx } from "@arkom/core";
import { ensureStarterGroups } from "../src/main/setup";
import { seed } from "./db-seed";
import { insertDemo } from "./db-demo";

const task = process.argv[2];
const dbPath = process.env.ARKOM_DB_PATH;
const migrationsDir = process.env.ARKOM_MIGRATIONS_DIR;

if (!task || !dbPath || !migrationsDir) {
  console.error("Usage: run-db-task.cjs <migrate|seed|demo|stats|audit> (ARKOM_DB_PATH / ARKOM_MIGRATIONS_DIR must be set)");
  process.exit(2);
}

/* the guard above exits when either is missing; these re-read them as plain
   strings so the narrowing survives into the async dispatcher below */
const DB_PATH = String(dbPath);
const MIGRATIONS = String(migrationsDir);

mkdirSync(dirname(DB_PATH), { recursive: true });
const { sqlite, db } = openDb(DB_PATH);

async function run() {
  switch (task) {
    case "migrate": {
      runMigrations(db, MIGRATIONS);
      /* the same two steps the app runs at startup — a CLI that migrated
         differently from the app would be a way to produce a database the app
         has never seen */
      /* the SAME mapper the app boots with: a database migrated from the CLI and
         one opened by the app must come out identical (v1.0.0) */
      ensureStarterGroups(db);
      const fixups = runDataFixups(db, uuidv7, (name) =>
        starterEnglishName(name) ?? (groupNameKey(name) === "usados" ? "Used" : null));
      console.log(`Migrations applied → ${DB_PATH}`);
      if (fixups.payoutsBackfilled > 0) {
        console.log(`Cash ledger: backfilled ${fixups.payoutsBackfilled} used-device payout(s).`);
      }
      break;
    }
    case "seed": {
      runMigrations(db, MIGRATIONS); // seed on a fresh checkout just works
      runDataFixups(db, uuidv7, (name) =>
        starterEnglishName(name) ?? (groupNameKey(name) === "usados" ? "Used" : null));
      const result = seed(db);
      console.log(result.message);
      break;
    }
    case "demo": {
      /* Adds to whatever is already there, through the same repo functions the
         screens call — so every row lands in the oplog and syncs. */
      runMigrations(db, MIGRATIONS);
      const tenant = db.select().from(schema.tenants).limit(1).all()[0];
      const location = db.select().from(schema.locations).limit(1).all()[0];
      const terminal = db.select().from(schema.terminals).limit(1).all()[0];
      const owner = db.select().from(schema.users).limit(1).all()[0];
      if (!tenant || !location || !terminal) {
        console.error("This till has no shop yet — finish first-run setup, then run demo.");
        process.exit(1);
      }
      const ctx: MutationCtx = {
        tenantId: tenant.id,
        locationId: location.id,
        terminalId: terminal.id,
        /* the actor every oplog entry is stamped with; a script has no session,
           so it writes as the shop's first user rather than as nobody */
        userId: owner?.id ?? null,
      };
      const result = await insertDemo(db, ctx);
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
}

/* the connection is closed whether the task succeeded or threw — a half-written
   dev database left with an open handle is a confusing thing to debug next */
run()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
  });
