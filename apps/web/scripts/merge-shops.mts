/**
 * `pnpm cloud:merge-shops` — fold one shop's stream into another's.
 *
 * For exactly one situation, created by exactly one missing path: before
 * ADR-0022 a till had no way to say "I am another counter in a shop that
 * already exists", so first run minted a shop and a second install founded a
 * second business. The account then has two shops that are one shop, and
 * deleting either throws away real history.
 *
 * This moves the losing shop's rows under the surviving one, so the dashboard
 * shows one business with every till's history in it and the till filter can
 * still look at either counter on its own.
 *
 * ## What it is careful about
 *
 * **It writes a rollback file before it changes anything.** Every row it is
 * about to move, as JSON, next to the command. `--undo <file>` puts them back.
 * The point is not that a rollback will be needed; it is that an irreversible
 * step on a shop's only copy of its history should not be taken on trust.
 *
 * **It refuses to merge shops in different accounts.** That would hand one
 * account another account's customers, which is the guarantee ADR-0020 §1
 * exists to make and is not negotiable by a convenience script.
 *
 * **It reports before it acts.** `--yes` is required; without it this is a
 * read-only description of what would happen.
 *
 * **`(tenant_id, op_id)` is the primary key**, so a row whose `op_id` already
 * exists under the surviving shop cannot be moved. That means two tills
 * generated the same UUIDv7, which does not happen — but it is checked and
 * reported rather than discovered as a failed statement halfway through.
 *
 * ## What it does NOT do
 *
 * It does not touch a till. A till holds its own `tenant_id` in its own
 * database, and a till whose shop was merged will be refused on its next push
 * (`DEVICE_MISMATCH`) until it is re-enrolled — which, in the situation this
 * exists for, is the plan anyway. `docs/handover/multi-till-consolidation.md`
 * has the order.
 *
 *   pnpm cloud:merge-shops -- --from <losing tenant> --into <surviving tenant>
 *   pnpm cloud:merge-shops -- --from <id> --into <id> --yes
 *   pnpm cloud:merge-shops -- --undo rollback-<id>.json --yes
 */
import { writeFileSync, readFileSync } from "node:fs";
import postgres from "postgres";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const from = arg("from")?.trim();
const into = arg("into")?.trim();
const undo = arg("undo")?.trim();
const confirmed = process.argv.includes("--yes");

if (!undo && (!from || !into)) {
  console.error(
    "usage: cloud:merge-shops -- --from <tenant> --into <tenant> [--yes]\n" +
      "       cloud:merge-shops -- --undo <rollback file> --yes",
  );
  process.exit(2);
}
if (from && into && from === into) {
  console.error("--from and --into are the same shop. Nothing to do.");
  process.exit(2);
}

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DIRECT_URL is not set. Put it in apps/web/.env.local (see .env.example).");
  process.exit(2);
}

const sql = postgres(url, { prepare: false, max: 1 });

interface Rollback {
  kind: "merge-shops";
  from: string;
  into: string;
  when: string;
  /** op_ids that were moved, so the undo moves back exactly those and no others */
  opIds: string[];
  devices: { id: string; tenantId: string; locationId: string; revokedAt: string | null }[];
  tenant: { id: string; accountId: string; name: string; createdAt: string | null; lastSeenAt: string | null };
}

/* ------------------------------------------------------------------- undo */

if (undo) {
  const plan = JSON.parse(readFileSync(undo, "utf8")) as Rollback;
  if (plan.kind !== "merge-shops") {
    console.error(`${undo} is not a merge-shops rollback file.`);
    process.exit(2);
  }

  console.log("");
  console.log(`  undo      ${plan.into} → ${plan.from}`);
  console.log(`  merged    ${plan.when}`);
  console.log(`  rows      ${plan.opIds.length}`);
  console.log(`  tills     ${plan.devices.length}`);
  console.log("");

  if (!confirmed) {
    console.log("Nothing changed. Add --yes to go ahead.");
    await sql.end();
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    /* the shop row first, so the rows have somewhere to point */
    await tx`
      insert into tenants (id, account_id, name, created_at, last_seen_at)
      values (${plan.tenant.id}, ${plan.tenant.accountId}, ${plan.tenant.name},
              ${plan.tenant.createdAt}, ${plan.tenant.lastSeenAt})
      on conflict (id) do nothing`;

    await tx`
      update sync_entries set tenant_id = ${plan.from}
      where tenant_id = ${plan.into} and op_id in ${tx(plan.opIds)}`;

    for (const device of plan.devices) {
      await tx`
        update devices
        set tenant_id = ${device.tenantId}, location_id = ${device.locationId},
            revoked_at = ${device.revokedAt}
        where id = ${device.id}`;
    }
  });

  console.log("Put back.\n");
  await sql.end();
  process.exit(0);
}

/* ------------------------------------------------------------------ merge */

const shops = await sql<{ id: string; account_id: string; name: string; created_at: Date | null; last_seen_at: Date | null }[]>`
  select id, account_id, name, created_at, last_seen_at from tenants where id in (${from!}, ${into!})`;

const losing = shops.find((row) => row.id === from);
const surviving = shops.find((row) => row.id === into);

if (!losing) {
  console.error(`No shop ${from!} in this database.`);
  await sql.end();
  process.exit(1);
}
if (!surviving) {
  console.error(`No shop ${into!} in this database.`);
  await sql.end();
  process.exit(1);
}
if (losing.account_id !== surviving.account_id) {
  console.error(
    "These two shops belong to DIFFERENT accounts. Merging them would hand one account\n" +
      "another account's customers, which ADR-0020 §1 does not allow. Nothing changed.",
  );
  await sql.end();
  process.exit(1);
}

const [counts] = await sql<{ rows: number; tills: number; clashes: number }[]>`
  select
    (select count(*)::int from sync_entries where tenant_id = ${from!})                     as rows,
    (select count(*)::int from devices where tenant_id = ${from!})                          as tills,
    (select count(*)::int from sync_entries a
       where a.tenant_id = ${from!}
         and exists (select 1 from sync_entries b
                      where b.tenant_id = ${into!} and b.op_id = a.op_id))                  as clashes`;

const perEntity = await sql<{ entity: string; n: number }[]>`
  select entity, count(*)::int as n from sync_entries where tenant_id = ${from!}
  group by entity order by n desc`;

console.log("");
console.log(`  from      ${losing.name}  (${losing.id})`);
console.log(`  into      ${surviving.name}  (${surviving.id})`);
console.log(`  account   ${losing.account_id}`);
console.log("");
console.log(`  moving    ${counts!.rows} row(s), ${counts!.tills} till(s)`);
for (const row of perEntity) console.log(`              ${String(row.n).padStart(5)}  ${row.entity}`);
console.log("");
console.log(`  the shop "${losing.name}" then stops existing; "${surviving.name}" keeps its name.`);
console.log("  every moved till is REVOKED: its token is already dead (its database names");
console.log("  a shop that will not exist), and a live row for a machine about to be reset");
console.log("  would make the shop read as having one more till than it has.");
console.log("");

if (counts!.clashes > 0) {
  console.error(
    `  ${counts!.clashes} row(s) already exist under the surviving shop with the same op_id.\n` +
      "  Two tills cannot generate the same UUIDv7, so this needs looking at by hand.\n" +
      "  Nothing changed.",
  );
  await sql.end();
  process.exit(1);
}

if (!confirmed) {
  console.log("Nothing changed. Add --yes to go ahead.");
  await sql.end();
  process.exit(0);
}

/* the rollback file BEFORE the first write */
const opIds = (await sql<{ op_id: string }[]>`
  select op_id from sync_entries where tenant_id = ${from!}`).map((row) => row.op_id);

const devices = await sql<{ id: string; tenant_id: string; location_id: string; revoked_at: Date | null }[]>`
  select id, tenant_id, location_id, revoked_at from devices where tenant_id = ${from!}`;

const rollback: Rollback = {
  kind: "merge-shops",
  from: losing.id,
  into: surviving.id,
  when: new Date().toISOString(),
  opIds,
  devices: devices.map((d) => ({
    id: d.id,
    tenantId: d.tenant_id,
    locationId: d.location_id,
    revokedAt: d.revoked_at ? d.revoked_at.toISOString() : null,
  })),
  tenant: {
    id: losing.id,
    accountId: losing.account_id,
    name: losing.name,
    createdAt: losing.created_at ? losing.created_at.toISOString() : null,
    lastSeenAt: losing.last_seen_at ? losing.last_seen_at.toISOString() : null,
  },
};

const file = `rollback-${losing.id}.json`;
writeFileSync(file, JSON.stringify(rollback, null, 2), "utf8");
console.log(`  rollback written to ${file}`);

/* one transaction: either the shop is merged or it is exactly as it was */
await sql.begin(async (tx) => {
  await tx`update sync_entries set tenant_id = ${into!} where tenant_id = ${from!}`;

  /* the till moves with its rows, and takes the surviving shop's location —
     one shop is one location in Phase 1 (ADR-0009), and the rows it already
     pushed keep their own `location_id` because that is what happened */
  const [shopLocation] = await tx<{ location_id: string }[]>`
    select location_id from devices where tenant_id = ${into!} order by enrolled_at limit 1`;

  /**
   * And the moved till is REVOKED, which is the part that is easy to miss.
   *
   * Its database still names the shop that no longer exists, so its token is
   * already dead in practice — every push it attempts is refused. Leaving the
   * row alive says otherwise: when the till is reset and re-enrols it mints a
   * NEW terminal id, so the shop ends up with a dead till row beside a live
   * one, `Cajas en la tienda` reads 3 for a shop with 2, and a wiped machine
   * keeps a working credential on the record.
   *
   * Revoking rather than deleting keeps the history — the Tills page shows it
   * as cut off, which is what happened — while `tillCount` and the dashboard's
   * till filter both ignore it, so the shop's own figures stay honest.
   */
  await tx`
    update devices
    set tenant_id = ${into!}${shopLocation ? tx`, location_id = ${shopLocation.location_id}` : tx``},
        revoked_at = coalesce(revoked_at, now())
    where tenant_id = ${from!}`;

  await tx`delete from tenants where id = ${from!}`;
});

const [after] = await sql<{ rows: number; tills: number }[]>`
  select (select count(*)::int from sync_entries where tenant_id = ${into!})  as rows,
         (select count(*)::int from devices
           where tenant_id = ${into!} and revoked_at is null)                as tills`;

console.log("");
console.log(`  done      "${surviving.name}" now holds ${after!.rows} row(s) and ${after!.tills} live till(s)`);
console.log(`  undo      pnpm cloud:merge-shops -- --undo ${file} --yes`);
console.log("");

await sql.end();
