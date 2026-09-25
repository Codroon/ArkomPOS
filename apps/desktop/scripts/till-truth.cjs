/**
 * `pnpm db:truth` — the till's own figures, read straight out of its SQLite.
 *
 * Half of `pnpm cloud:reconcile`. This half deliberately shares NO code with
 * the cloud: not a query, not a helper, not a type. If both sides went through
 * the same function a bug in that function would agree with itself, and the
 * whole point of the exercise is to have two independent answers to compare.
 * So this reads the tables the till writes, with plain SQL, and prints JSON.
 *
 * READ-ONLY, on purpose: opened with `mode=ro`, so it is safe to run against a
 * till that is open and serving customers. It never writes to the database and
 * the only file it creates is the JSON.
 *
 *   pnpm db:truth                        the dev database in .data/
 *   pnpm db:truth -- --db "C:/.../arkom-pos.db"   an installed till
 *   pnpm db:truth -- --out truth.json    somewhere other than the default
 */
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve } = require("node:path");

const repoRoot = resolve(__dirname, "../../..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const dbPath = resolve(arg("db", join(repoRoot, ".data", "arkom-pos.db")));
const outPath = resolve(arg("out", join(repoRoot, ".data", "till-truth.json")));

if (!existsSync(dbPath)) {
  console.error(`No database at ${dbPath}`);
  console.error("Run the app once, or pass --db with the path to an installed till's file.");
  process.exit(1);
}

/*
 * Node's OWN sqlite, not the app's better-sqlite3.
 *
 * That module is compiled against Electron's ABI in this repo, so plain `node`
 * cannot load it (NODE_MODULE_VERSION 136 vs 137) and every other db script
 * goes through Electron to get at it. This one must not: a tool built to be
 * independent of the app has no business booting the app to read a file.
 * `node:sqlite` arrived in Node 22.5 and needs no build step at all.
 */
let db;
try {
  const { DatabaseSync } = require("node:sqlite");
  db = new DatabaseSync(dbPath, { readOnly: true });
} catch (err) {
  console.error("Could not open the database read-only.");
  console.error(`  ${err && err.message}`);
  console.error("This script needs Node 22.5 or newer for its built-in sqlite.");
  console.error(`  you are on ${process.version}`);
  process.exit(1);
}

const one = (sql) => Object.values(db.prepare(sql).get())[0];
const rows = (sql) => db.prepare(sql).all();

const truth = {
  db: dbPath,
  readAt: new Date().toISOString(),

  oplog: one("select count(*) as n from oplog"),
  groups: one("select count(*) as n from product_groups"),
  products_all: one("select count(*) as n from products"),
  products_active: one("select count(*) as n from products where active = 1"),

  /* the till's CACHE of on-hand, and the movements it is supposed to equal.
     `db:audit` asserts these two agree; the reconciler says so in its output,
     because if the till disagrees with ITSELF the cloud is the wrong thing to
     be looking at. */
  on_hand_total: one("select coalesce(sum(on_hand), 0) as n from product_stock"),
  movement_sum: one("select coalesce(sum(qty), 0) as n from stock_movements"),

  documents_completed: one("select count(*) as n from documents where status = 'completed'"),
  documents_draft: one("select count(*) as n from documents where status <> 'completed'"),
  documents_total_cents: one(
    "select coalesce(sum(total_cents), 0) as n from documents where status = 'completed'",
  ),
  documents_tax_cents: one(
    "select coalesce(sum(tax_cents), 0) as n from documents where status = 'completed'",
  ),

  repairs_total: one("select count(*) as n from repair_tickets"),
  repairs_by_status: rows(
    "select status, count(*) as n from repair_tickets group by status order by status",
  ),

  used_purchases: one("select count(*) as n from used_purchases"),
  units_by_status: rows("select status, count(*) as n from units group by status order by status"),

  transfers: one("select count(*) as n from transfers"),
  transfers_principal: one(
    "select coalesce(sum(principal_cents), 0) as n from transfers where cancelled_at is null",
  ),
  transfers_fee: one(
    "select coalesce(sum(fee_cents), 0) as n from transfers where cancelled_at is null",
  ),

  vouchers_outstanding: one(
    "select count(*) as n from store_credit_vouchers where remaining_cents > 0",
  ),
  vouchers_owed_cents: one(
    "select coalesce(sum(remaining_cents), 0) as n from store_credit_vouchers where remaining_cents > 0",
  ),

  /* EVERY active product, not a sample: a total can be right while two rows are
     swapped, and that is exactly the kind of wrongness a dashboard shows. */
  per_product: rows(`
    select p.name, coalesce(ps.on_hand, 0) as on_hand
    from products p left join product_stock ps on ps.product_id = p.id
    where p.active = 1 order by p.name`),
};

db.close();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(truth, null, 1), "utf8");

console.log(`till truth -> ${outPath}`);
console.log(
  `  ${truth.oplog} oplog rows · ${truth.products_active} active products · ` +
    `${truth.documents_completed} completed documents · ${truth.repairs_total} repairs`,
);
if (truth.on_hand_total !== truth.movement_sum) {
  console.log(
    `  WARNING: the till's stock cache (${truth.on_hand_total}) disagrees with its own ` +
      `movements (${truth.movement_sum}) — run pnpm db:audit before trusting this`,
  );
}
