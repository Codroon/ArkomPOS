/**
 * `pnpm cloud:fields` — what is ACTUALLY in the stream, per entity, per field.
 *
 * Write a cloud query against the till's TABLE and you will get it wrong, because
 * the till does not push its tables. It pushes oplog entries, and those are
 * deliberately narrower: `used_purchase/create` carries a composed `device`
 * string and no seller at all, because the oplog is readable by anyone who can
 * read the file and "the entry records the purchase, not the person".
 *
 * The Dispositivos usados screen was built from the table. Five of its nine
 * columns read fields that have never once crossed the wire, so it rendered a
 * grid of dashes — and its join was backwards on top, since the UNIT points at
 * the purchase and not the other way round. Every figure reconciled; the screen
 * was still wrong. Counting rows cannot catch that.
 *
 * So: before writing or changing a query, look at what is there.
 *
 *   pnpm cloud:fields                 every entity
 *   pnpm cloud:fields -- used_purchase   one of them
 *
 * The percentage is how many of that entity's rows have the field non-null after
 * folding. A field at 0% is one no screen should promise.
 */
import postgres from "postgres";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL is not set — put it in apps/web/.env.local");
  process.exit(2);
}

const only = process.argv.slice(2).find((a) => !a.startsWith("-"));
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 2 });

/* folded the same way the app reads it: last writer wins, per field, per row */
const rows = await sql`
  with folded as (
    select distinct on (e.entity, e.entity_id, kv.key)
      e.entity, e.entity_id, kv.key, kv.value
    from sync_entries e
    cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as kv(key, value)
    order by e.entity, e.entity_id, kv.key, e.seq desc
  ),
  totals as (select entity, count(distinct entity_id)::int as n from folded group by 1)
  select f.entity,
         f.key,
         t.n                                                                    as rows,
         count(*) filter (where jsonb_typeof(f.value) <> 'null')::int           as present,
         min(f.value #>> '{}')                                                  as sample,
         string_agg(distinct jsonb_typeof(f.value), '/')                        as types
  from folded f
  join totals t on t.entity = f.entity
  group by f.entity, f.key, t.n
  order by f.entity, f.key`;

let entity = "";
let shown = 0;
for (const r of rows) {
  if (only && r.entity !== only) continue;
  if (r.entity !== entity) {
    entity = r.entity;
    console.log(`\n## ${entity}  —  ${r.rows} rows`);
  }
  shown += 1;
  const pct = Math.round((r.present / r.rows) * 100);
  const flag = pct === 0 ? "  ← never sent" : pct < 100 ? "" : "";
  console.log(
    `   ${r.key.padEnd(24)} ${String(pct).padStart(3)}%  ${String(r.types).padEnd(14)} ` +
      `${String(r.sample ?? "").slice(0, 40)}${flag}`,
  );
}

if (shown === 0) {
  console.log(only ? `\nNo entity called "${only}" in the stream.` : "\nThe stream is empty.");
}
console.log("");
await sql.end();
