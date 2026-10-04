/**
 * `pnpm cloud:shops` — which shops exist, with their ids and what is in them.
 *
 * Written for one job: the step before `cloud:delete-tenant`. That script shows
 * what it is about to remove and refuses to act without `--yes`, which is the
 * right shape, but it still needs a tenant id — and the only way to GET one was
 * to write SQL by hand against production. Somebody doing that at the end of a
 * long day, with two shops in one account whose names differ by capitalisation
 * ("Arkom" and "ARKOM"), is how the wrong shop gets deleted.
 *
 * So this prints the row counts that say which is which. A shop with 377
 * products and 237 stock movements is a catalogue somebody built; one with 31
 * products is a till somebody started typing into. The figures decide, not the
 * name.
 *
 *   pnpm cloud:shops
 *   pnpm cloud:shops -- --account <id>    one account only
 *   pnpm cloud:shops -- --tenant <id>     one shop's products and what it holds
 *
 * The `--tenant` listing exists for the step BEFORE a consolidation. Deleting a
 * shop is safe only if what it holds also exists in the shop that survives, and
 * the only way to know is to read the names. A product on the losing side that
 * nobody has on the winning side is stock the shop is about to stop having a
 * record of — which is a decision for the shop, made by looking at a list.
 *
 * Read-only. It cannot change anything.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { accounts, devices, syncEntries, tenants } from "../src/db/schema.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const onlyAccount = arg("account")?.trim();
const onlyTenant = arg("tenant")?.trim();

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Put it in apps/web/.env.local (see .env.example).");
  process.exit(2);
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema: { accounts, tenants, devices, syncEntries } });

/* ----------------------------------------------- one shop's products -- */
if (onlyTenant) {
  const shop = await db.execute<{ name: string }>(
    sql`select name from ${tenants} where id = ${onlyTenant}`,
  );
  if (!shop[0]) {
    console.error(`
No shop ${onlyTenant} in this database.
`);
    await client.end();
    process.exit(1);
  }

  /*
   * Folded the same way the dashboard folds — group by `entity_id`, newest op
   * per field (ADR-0022, and the bug `cloud:reconcile` caught). Keying on
   * `after->>'id'` would collapse every partial payload into one NULL group and
   * print one product where there are thirty-one.
   */
  const items = await db.execute<{ id: string; name: string; on_hand: number }>(sql`
    with p as (
      select distinct on (e.entity_id, kv.key) e.entity_id, kv.key, kv.value
      from ${syncEntries} e
      cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as kv(key, value)
      where e.tenant_id = ${onlyTenant} and e.entity = 'product'
      order by e.entity_id, kv.key, e.seq desc
    ),
    folded as (
      select entity_id as id, jsonb_object_agg(key, value) as row from p group by entity_id
    ),
    /* on-hand is NOT pushed — product_stock is a cache (ADR-0015 §3) — so it is
       summed from the ledger, exactly as the till recomputes it */
    moves as (
      select distinct on (e.entity_id, kv.key) e.entity_id, kv.key, kv.value
      from ${syncEntries} e
      cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as kv(key, value)
      where e.tenant_id = ${onlyTenant} and e.entity = 'stock_movement'
      order by e.entity_id, kv.key, e.seq desc
    ),
    m as (
      select entity_id as id, jsonb_object_agg(key, value) as row from moves group by entity_id
    ),
    levels as (
      select m.row->>'productId' as product_id, sum((m.row->>'qty')::bigint) as on_hand
      from m group by m.row->>'productId'
    )
    select f.id, coalesce(f.row->>'name', '(sin nombre)') as name,
           coalesce(l.on_hand, 0)::int as on_hand
    from folded f
    left join levels l on l.product_id = f.id
    where coalesce(f.row->>'active', 'true') <> 'false'
    order by name
  `);

  console.log(`
  ${shop[0].name}  (${onlyTenant})`);
  console.log(`  ${items.length} product(s), with what the ledger says is on the shelf:
`);
  for (const item of items) {
    console.log(`    ${String(item.on_hand).padStart(5)}  ${item.name}`);
  }
  console.log("");
  console.log("  Before deleting this shop: every name above has to exist in the shop that");
  console.log("  survives, or the stock stops being recorded anywhere. Check, then decide.");
  console.log("");
  await client.end();
  process.exit(0);
}

const rows = await db.execute<{
  account_id: string;
  account_name: string;
  tenant_id: string;
  shop_name: string;
  tills: number;
  entries: number;
  products: number;
  movements: number;
  documents: number;
  last_seen: Date | null;
}>(sql`
  select a.id   as account_id,
         a.name as account_name,
         t.id   as tenant_id,
         t.name as shop_name,
         (select count(*)::int from ${devices} d where d.tenant_id = t.id)             as tills,
         (select count(*)::int from ${syncEntries} e where e.tenant_id = t.id)         as entries,
         /* the figures that say which shop is the real one */
         (select count(distinct e.entity_id)::int from ${syncEntries} e
           where e.tenant_id = t.id and e.entity = 'product')                          as products,
         (select count(distinct e.entity_id)::int from ${syncEntries} e
           where e.tenant_id = t.id and e.entity = 'stock_movement')                   as movements,
         (select count(distinct e.entity_id)::int from ${syncEntries} e
           where e.tenant_id = t.id and e.entity = 'document')                         as documents,
         t.last_seen_at as last_seen
  from ${tenants} t
  join ${accounts} a on a.id = t.account_id
  ${onlyAccount ? sql`where a.id = ${onlyAccount}` : sql``}
  order by a.name, t.name
`);

if (rows.length === 0) {
  console.log("\nNo shops in this database.\n");
  await client.end();
  process.exit(0);
}

/* grouped by account, because "this account has two shops" is the thing the
   reader is usually checking for — ADR-0022 §9 refuses a new till in that state */
let account = "";
console.log("");
for (const row of rows) {
  if (row.account_id !== account) {
    account = row.account_id;
    console.log(`  ${row.account_name}  (${row.account_id})`);
  }
  console.log(`    shop      ${row.shop_name}`);
  console.log(`    tenant    ${row.tenant_id}`);
  console.log(
    `    holds     ${row.products} products · ${row.movements} stock movements · ` +
      `${row.documents} documents · ${row.entries} rows · ${row.tills} till(s)`,
  );
  console.log(`    last seen ${row.last_seen ? new Date(row.last_seen).toISOString() : "never"}`);
  console.log("");
}

const perAccount = new Map<string, number>();
for (const row of rows) perAccount.set(row.account_id, (perAccount.get(row.account_id) ?? 0) + 1);
const split = [...perAccount.entries()].filter(([, n]) => n > 1);

if (split.length > 0) {
  console.log("  ⚠  More than one shop in an account.");
  console.log("     A new till cannot join one of these — it is refused with SHOP_AMBIGUOUS,");
  console.log("     because 'the shop' has no referent (ADR-0022 §9). Consolidate first:");
  console.log("     docs/handover/multi-till-consolidation.md");
  console.log("");
}

await client.end();
