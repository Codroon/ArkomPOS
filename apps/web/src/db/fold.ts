/**
 * Rebuilding a row from the stream.
 *
 * The till does NOT always push a whole row. A repair's status arrives as
 * `{ "status": "quoted" }` and nothing else; a print is `{}` with the document's
 * identity in the oplog's own `entity_id` column rather than inside the payload.
 * That is correct of the till — an oplog entry records what changed — and it
 * means a reader cannot simply take the newest payload and call it the row.
 *
 * Two bugs came from ignoring that, and a reconciliation against the till's own
 * SQLite is what caught them:
 *
 *   · keying on `after->>'id'` collapsed every id-less payload into one group,
 *     so twenty used purchases read as one and eighty status updates read as
 *     none; and
 *   · taking the newest payload whole would have replaced a repair ticket with
 *     `{ status }`, losing the device, the customer and the fault.
 *
 * So: group by `entity_id`, and for each FIELD take the value from the newest
 * op that carried it. Last write wins per key, which is what an append-only log
 * of changes means. A row that was always pushed whole folds to exactly what it
 * always was, so nothing that worked before changes.
 *
 * The fold also NORMALISES dates, because it is the one place every row passes
 * through. Every `*At` in the stream is epoch millis except two writers that
 * sent `readyAt` and `notRepairedAt` as ISO strings; the till has been corrected
 * but the rows already pushed cannot be — an oplog is append-only, and
 * `(row->>'readyAt')::bigint` on "2026-09-24T23:08:42.180Z" is not a wrong
 * answer, it is a 500 on the repairs screen. So a string that looks like an
 * ISO timestamp becomes millis here, once, and the twenty-seven places
 * downstream that cast to bigint stay as they are. Inside a folded row a date
 * is always a number.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * The current state of every row of `entity` belonging to an account.
 *
 * Yields `(id, row, first_seq, last_seq)`. `row` is the folded jsonb and callers
 * read fields off it with `->>` exactly as they did before. The two sequence
 * numbers are the row's own bounds in the stream — `first_seq` is the op that
 * brought it into being and is therefore the order the shop entered things in,
 * which is the only sane ordering for a list of parts on a ticket; `last_seq` is
 * when it was last touched. A caller that wants either has to be given it,
 * because the fold groups the ops away.
 */
export function folded(accountId: string, entity: string): SQL {
  return sql`
    select f.entity_id as id,
           jsonb_object_agg(f.key, f.value) as row,
           f.first_seq,
           f.last_seq
    from (
      select distinct on (e.entity_id, kv.key)
        e.entity_id, kv.key, kv.value,
        /* windows are computed before DISTINCT ON, so these see every op */
        min(e.seq) over (partition by e.entity_id) as first_seq,
        max(e.seq) over (partition by e.entity_id) as last_seq
      from sync_entries e
      cross join lateral jsonb_each(coalesce(e.after, '{}'::jsonb)) as raw(key, value)
      /* a date in a folded row is ALWAYS epoch millis — see the note above */
      cross join lateral (
        select raw.key as key,
               case
                 when jsonb_typeof(raw.value) = 'string'
                  and raw.key ~ 'At$'
                  and (raw.value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                 then to_jsonb(
                   (extract(epoch from (raw.value #>> '{}')::timestamptz) * 1000)::bigint
                 )
                 else raw.value
               end as value
      ) as kv
      where e.tenant_id in (select t.id from tenants t where t.account_id = ${accountId})
        and e.entity = ${entity}
      /* newest op that mentioned this field, for this row */
      order by e.entity_id, kv.key, e.seq desc
    ) f
    group by f.entity_id, f.first_seq, f.last_seq
  `;
}

/**
 * Same, but only for rows that have ever been touched — used where a caller
 * needs the id alongside the folded row and does its own filtering.
 */
export const foldedAs = (accountId: string, entity: string, alias: string): SQL =>
  sql`${sql.raw(alias)} as (${folded(accountId, entity)})`;

/**
 * A date read straight from `sync_entries`, rather than from a folded row.
 *
 * Only for entities that are insert-only and therefore never folded — a stock
 * movement is never updated, so there is nothing to fold and no normalising
 * pass to hide behind. Same tolerance, same reason.
 */
export const epochMs = (expr: string): SQL =>
  sql.raw(`case
    when ${expr} is null then null
    when ${expr} ~ '^-?[0-9]+$' then (${expr})::bigint
    else (extract(epoch from (${expr})::timestamptz) * 1000)::bigint
  end`);
