/**
 * Delete a shop and everything the cloud holds about it — ADR-0020 §4.
 *
 * "Deleting a tenant is a feature, built before the first paying customer — not
 * a support ticket answered with SQL." This is that feature's first form: it
 * shows what it is about to remove and does nothing until told twice.
 *
 *   pnpm --filter @arkom/web cloud:delete-tenant -- --tenant <id>
 *   pnpm --filter @arkom/web cloud:delete-tenant -- --tenant <id> --yes
 *
 * The till is unaffected. Its database is the shop's own copy and the only one
 * that was ever authoritative; if they link again, they re-push their history.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { devices, syncEntries, tenants } from "../src/db/schema.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const tenantId = arg("tenant")?.trim();
const confirmed = process.argv.includes("--yes");

if (!tenantId) {
  console.error("usage: cloud:delete-tenant -- --tenant <tenant id> [--yes]");
  process.exit(2);
}

/* the direct connection, like migrations: a one-off script has no reason to go
   through a pooler sized for a serving app */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Put it in apps/web/.env.local (see .env.example).");
  process.exit(2);
}

const client = postgres(url, { prepare: false, max: 1 });
const db = drizzle(client, { schema: { tenants, devices, syncEntries } });

const shop = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
if (!shop[0]) {
  console.error(`No tenant ${tenantId} in this database. Nothing to delete.`);
  await client.end();
  process.exit(1);
}

const counted = await db
  .select({
    entries: sql<number>`(select count(*)::int from ${syncEntries} where ${syncEntries.tenantId} = ${tenantId})`,
    tills: sql<number>`(select count(*)::int from ${devices} where ${devices.tenantId} = ${tenantId})`,
  })
  .from(tenants)
  .where(eq(tenants.id, tenantId))
  .limit(1);

console.log("");
console.log(`  shop      ${shop[0].name}`);
console.log(`  tenant    ${tenantId}`);
console.log(`  rows      ${counted[0]?.entries ?? 0}`);
console.log(`  tills     ${counted[0]?.tills ?? 0}  (their tokens stop working)`);
console.log("");

if (!confirmed) {
  console.log("Nothing deleted. Add --yes to go ahead.");
  await client.end();
  process.exit(0);
}

/* One statement: the foreign keys take the entries and the tills with it, so a
   table added later cannot be left behind by this script. */
await db.delete(tenants).where(eq(tenants.id, tenantId));

console.log(`Deleted. ${shop[0].name} is no longer in the cloud.`);
await client.end();
