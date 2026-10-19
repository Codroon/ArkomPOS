# ADR-0024: Tills know each other's names, and a change is announced rather than waited for

**Status:** Accepted · **Date:** 2026-10-19 · **Deciders:** Zothix (Codroon)

## Context

The pilot shop ran two tills on v1.3.1 for a day and reported four things, all true:

1. Both counters were called "Caja 2" — the second install took the wizard's prefill — and
   nothing let the shop change it. The dashboard could not tell them apart.
2. A stock movement made at the other counter showed a long id where the person should be,
   and then "Otra caja" — this till had never been told who anyone at the other one was.
3. A sale at one counter took 15–45 seconds to reach the other one, and up to a minute to
   reach the dashboard. Measured on the pilot: median 26 s, worst 46 s.
4. (Found while fixing 2.) A repair taken in at one till could not be found at the other:
   its list was empty and opening the ticket said it did not exist. ADR-0023 made the ticket
   travel, and every repair screen still joined the `R-` receipt, which by ADR-0023 §2 does
   not. The test of collecting at the other till called the collect channel directly, which
   no person can do, so it passed.

The delay in 3 had four parts, each a decision that was right when it was made: the push ran
once a minute (ADR-0020: nobody was waiting for the cloud then); the pull ran every fifteen
seconds; the pull served nothing younger than five seconds (ADR-0022 §4); and a screen that
was already open never read again.

## Decision

### 1. A till can be renamed; its series cannot

`terminal:rename` (`settings.edit`) changes `terminals.name` through `mutate()`, writing a
`terminal/rename` oplog entry with the old and new name. The cloud takes a till's new name
from that entry — **only** an entry for the device's own terminal, so a till restored from a
sibling's backup cannot rename its neighbour on the dashboard.

The number series is untouched and stays untouchable (ADR-0008). Renaming the till that
prints `T1-` to "Caja 1" is the fix for a shop whose names and numbers disagree; renumbering
is not, and there is still no channel that could do it. A document already printed keeps the
name it was printed with.

### 2. Names travel as a list beside the pull, never as rows

Staff stay per-till (ADR-0022 §1) and must: a `users` row here is a PIN that signs in here.
So the names of a shop's tills and people ride along with every pull as a read-only
directory — `{tills: [{terminalId, name}], staff: [{userId, name}]}` — folded by the cloud
from what the tills already pushed (`entity_id`, latest by `created_at`). It carries **names
only**: no role, no PIN material (which the cloud never held), nothing that could sign
anybody in. The till keeps it in `cloud-link.json`, beside the token, for the same reason the
token lives there: it is the cloud's answer, not the shop's fact, and a table would be pushed.

A screen asks this till's own staff first and the directory second (`main/people.ts`). Rosa,
who works only at the other counter, appears as "Rosa" on this till's repair board, and a
test asserts there is still no Rosa in this till's `users` table.

### 3. A change is announced, not waited for

Three moves, each with the old mechanism kept underneath as the fallback:

- **The outbox sends on write.** Every committed `mutate()` rings `outbox-signal.ts`; the
  push follows 300 ms later, gathering a sale's several writes into one batch. A write that
  rolled back rings nothing. The minute timer stays for a till whose line was down.
- **The cloud pokes the shop.** When a push stores something new, the route sends a Supabase
  Realtime **broadcast** on the shop's channel. The poke carries an event name and a random
  tag — no row, no id, no amount, no name — so the channel could be read by anybody and tell
  them only that a shop is busy. The topic is an HMAC of the tenant id under a server secret
  (`SYNC_LIVE_SECRET`, else derived from `DATABASE_URL`), sent with the project's PUBLIC key.
  The push answer echoes the tag so the till that pushed ignores its own poke. A poke that
  fails costs the other till the old fifteen seconds and never un-acks a batch.
- **Tills and dashboards listen.** The till keeps one socket to the channel (Node's own
  WebSocket, Phoenix wire format, no dependency), pulls on a poke, pulls again whenever it
  rejoins, and replaces a socket that goes silent. While the socket is up the fifteen-second
  timer relaxes to one minute. An open dashboard page listens the same way and calls
  `router.refresh()`, gathered and paused while the tab is hidden. When rows land, main tells
  the windows which entities changed (`shop:changed`) and the screens showing them read again
  through their usual guarded channels.

Supabase Realtime on the free plan carries this comfortably: 200 concurrent connections and
two million messages a month, against two sockets and a few hundred pokes a day per shop.
Measured against the live project before building: a poke arrived 485 ms after it was sent.
Polling every two seconds was rejected: it could not beat the five-second settle below, and
two tills would make about 2.6 million requests a month to say "nothing new".

### 4. The settle window is replaced by a lock

`recordBatch` takes `pg_advisory_xact_lock(hashtextextended(tenant_id, 0))` as the first
statement of its transaction. One shop's pushes therefore commit in `ingest_seq` order: a
second push cannot take a number until the first one's rows are visible, so a committed row
never has an uncommitted row behind it, and the pull can serve a row the moment it lands.
Other shops are not held up. An integration test against the real pooler proves the second
push waits, and fails when the lock is removed.

`SYNC_SETTLE_MS` goes to 0 and the pull then applies **no** time filter at all — filtering on
`received_at` would itself be the hazard now, because that clock belongs to whichever server
took the push. This is deployed in two steps: the lock first, the zero once every server
instance without the lock has drained.

### 5. The `R-` number travels with the repair

`repair_tickets.intake_doc_number` (migration 0018, backfilled from the till's own receipts)
carries the number the customer reads off their receipt. Repair reads left-join the receipt
and fall back to the carried number. Named `intake_` because a collection's payload already
carries a `docNumber` — the `T-` invoice's — and a column of that name would have been
overwritten with it on every sibling. The receipt itself still stays home (ADR-0023 §2):
reprinting it happens at the till that printed it.

## Consequences

- A sale reaches the other counter and the dashboard in about one to two seconds when both
  are online, and in the old 15–60 seconds when the socket is down. Nothing in a sale waits
  on any of it; ADR-0001 is not touched.
- ADR-0022 §4's settle window is superseded by §4 here. ADR-0022 §1's "users/PINs are not
  shared" stands: names are displayed, never stored as users. ADR-0023 §2 stands, with the
  number of the receipt now travelling where the receipt does not.
- Tickets taken in before v1.4.0 at a sibling till show no `R-` number there until a fresh
  write to the ticket carries it; the pilot had none.
- New on Vercel: nothing required. `SYNC_LIVE_SECRET` is optional and, if set later, rotates
  every topic; tills pick up the new one on their next pull.
