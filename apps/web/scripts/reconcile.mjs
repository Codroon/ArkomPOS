/**
 * `pnpm cloud:reconcile` — does the cloud say the same thing the till says?
 *
 * The other half of `pnpm db:truth`. That script read the till's own SQLite with
 * plain SQL and wrote JSON; this one asks the cloud the same questions through
 * the stream, and prints the two answers side by side. Neither half shares a
 * line of code with the other, so an agreement means something and a
 * disagreement names the figure that is wrong.
 *
 *   pnpm db:truth && pnpm cloud:reconcile
 *   pnpm cloud:reconcile -- --truth some/other/truth.json
 *
 * Exit code is the number of mismatches, capped at 1, so it can gate a deploy.
 *
 * This is how the `after->>'id'` bug was found: every money figure agreed to the
 * cent while repairs, used devices and drafts did not, which pointed straight at
 * the entities the till pushes as PARTIAL payloads. See `src/db/fold.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const truthPath = resolve(flag("truth", "../../.data/till-truth.json"));
if (!existsSync(truthPath)) {
  console.error(`No till figures at ${truthPath}`);
  console.error("Run `pnpm db:truth` first (it reads the till's SQLite read-only).");
  process.exit(2);
}
if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set — put it in apps/web/.env.local");
  process.exit(2);
}

const truth = JSON.parse(readFileSync(truthPath, "utf8"));
console.log(`
  till: ${truth.db}
  read: ${truth.readAt}
`);
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 3 });

/**
 * The current state of every row of an entity.
 *
 * Identity lives in `entity_id`, NOT in the payload: an update op carries only
 * the fields it changed, and `repair_ticket/status` is literally `{status}`.
 * Keying on `after->>'id'` collapses every id-less payload into one NULL group,
 * which is how a shop with 20 used devices looked like a shop with 1. So fold
 * per FIELD, last writer wins, grouped by the row's real identity.
 */
const latest = (entity) => sql`
  select f.entity_id as id, jsonb_object_agg(f.key, f.value) as row
  from (
    select distinct on (e.entity_id, kv.key) e.entity_id, kv.key, kv.value
    from sync_entries e
    cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as kv(key, value)
    where e.entity = ${entity}
    order by e.entity_id, kv.key, e.seq desc
  ) f
  group by f.entity_id`;

const num = (v) => Number(v ?? 0);
let failures = 0;

function check(label, mine, theirs, note = "") {
  const ok = String(mine) === String(theirs);
  if (!ok) failures += 1;
  const mark = ok ? "ok  " : "FAIL";
  console.log(
    `  ${mark} ${label.padEnd(34)} till ${String(theirs).padStart(12)}   cloud ${String(mine).padStart(12)}${note ? "   " + note : ""}`,
  );
}

/* ---------------------------------------------------------------- volume */
const [{ n: entries }] = await sql`select count(*)::int as n from sync_entries`;
check("oplog rows delivered", entries, truth.oplog);

const [{ n: gaps }] = await sql`
  select count(*)::int as n from (
    select seq, lag(seq) over (order by seq) as prev from sync_entries
  ) t where prev is not null and seq <> prev + 1`;
check("gaps in the stream", gaps, 0);

/* -------------------------------------------------------------- catalogue */
const groups = await latest("product_group");
check("product groups", groups.length, truth.groups);

const products = await latest("product");
const active = products.filter((p) => (p.row.active ?? true) !== false);
check("products (all)", products.length, truth.products_all);
check("products (active)", active.length, truth.products_active);

const [{ total }] = await sql`
  select coalesce(sum((after->>'qty')::bigint), 0)::bigint as total
  from sync_entries where entity = 'stock_movement'`;
check("stock on hand (sum of movements)", num(total), truth.on_hand_total,
  truth.on_hand_total === truth.movement_sum ? "(till cache agrees with its own movements)" : "*** till cache disagrees ***");

/* ---- per product, so a total that is right by accident is caught ---- */
const perProduct = await sql`
  with p as (
    select f.entity_id as id,
           (jsonb_object_agg(f.key, f.value))->>'name' as name,
           coalesce(((jsonb_object_agg(f.key, f.value))->>'active')::boolean, true) as active
    from (
      select distinct on (e.entity_id, kv.key) e.entity_id, kv.key, kv.value
      from sync_entries e
      cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as kv(key, value)
      where e.entity = 'product'
      order by e.entity_id, kv.key, e.seq desc
    ) f
    group by f.entity_id
  ),
  m as (
    select after->>'productId' as product_id, sum((after->>'qty')::bigint) as on_hand
    from sync_entries where entity = 'stock_movement' group by 1
  )
  select p.name, coalesce(m.on_hand, 0)::int as on_hand
  from p left join m on m.product_id = p.id
  where p.active order by p.name`;

/*
 * Compared by NAME and in both directions. Not by position: Postgres orders
 * "Altavoz auricular" before "Altavoz Bluetooth" and SQLite does the opposite,
 * so any check that trusted row order would report two phantom mismatches on a
 * shelf that agrees to the unit.
 */
const bad = [];
for (const mine of truth.per_product) {
  const theirs = perProduct.find((r) => r.name === mine.name);
  if (!theirs) bad.push(`${mine.name}: missing in cloud`);
  else if (theirs.on_hand !== mine.on_hand) bad.push(`${mine.name}: ${mine.on_hand} vs ${theirs.on_hand}`);
}
for (const theirs of perProduct) {
  if (!truth.per_product.some((r) => r.name === theirs.name)) bad.push(`${theirs.name}: only in cloud`);
}
check(
  `per-product on hand (all ${truth.per_product.length})`,
  bad.length === 0 ? "all match" : `${bad.length} differ`,
  "all match",
);
for (const line of bad.slice(0, 10)) console.log(`       ${line}`);

/* -------------------------------------------------------------- documents */
const docs = await latest("document");
const completed = docs.filter((d) => d.row.status === "completed");
check("completed documents", completed.length, truth.documents_completed);
check("drafts / parked", docs.length - completed.length, truth.documents_draft);
check(
  "completed total (cents)",
  completed.reduce((s, d) => s + num(d.row.totalCents), 0),
  truth.documents_total_cents,
);
check(
  "completed tax (cents)",
  completed.reduce((s, d) => s + num(d.row.taxCents), 0),
  truth.documents_tax_cents,
);

/* ---------------------------------------------------------------- repairs */
const tickets = await latest("repair_ticket");
check("repair tickets", tickets.length, truth.repairs_total);
for (const { status, n } of truth.repairs_by_status) {
  check(`  repairs: ${status}`, tickets.filter((t) => (t.row.status ?? "received") === status).length, n);
}

/* ------------------------------------------------------------------- used */
const purchases = await latest("used_purchase");
check("used purchases", purchases.length, truth.used_purchases);
const units = await latest("unit");
for (const { status, n } of truth.units_by_status) {
  check(`  units: ${status}`, units.filter((u) => u.row.status === status).length, n);
}

/* -------------------------------------------------------------- transfers */
const transfers = await latest("transfer");
check("transfers", transfers.length, truth.transfers);
const live = transfers.filter((t) => !t.row.cancelledAt);
check("transfer principal (cents)", live.reduce((s, t) => s + num(t.row.principalCents), 0), truth.transfers_principal);
check("transfer fees (cents)", live.reduce((s, t) => s + num(t.row.feeCents), 0), truth.transfers_fee);

/* --------------------------------------------------------- store credit */
const vouchers = await latest("store_credit_voucher");
const owing = vouchers.filter((v) => num(v.row.remainingCents) > 0);
check("vouchers outstanding", owing.length, truth.vouchers_outstanding);
check("voucher debt (cents)", owing.reduce((s, v) => s + num(v.row.remainingCents), 0), truth.vouchers_owed_cents);

/* ------------------------------------------------ what must NOT be there */
console.log("\n  secrets, which must be absent whatever the till holds:");
const dump = JSON.stringify(await sql`select before, after from sync_entries`);
for (const word of ["devicePasscode", "passcode", "pinHash", "pinSalt", "recoveryCodeHash", "argon2", "scrypt$"]) {
  const present = dump.includes(word);
  if (present) failures += 1;
  console.log(`  ${present ? "FAIL" : "ok  "} ${word}`);
}

/* photographs are files, not rows — a path may travel, bytes may not */
const dataUrls = dump.includes("data:image");
if (dataUrls) failures += 1;
console.log(`  ${dataUrls ? "FAIL" : "ok  "} no image bytes on the wire`);

console.log(`\n  ${failures === 0 ? "RECONCILED — every figure agrees" : failures + " MISMATCH(ES)"}\n`);
await sql.end();
process.exit(failures === 0 ? 0 : 1);
