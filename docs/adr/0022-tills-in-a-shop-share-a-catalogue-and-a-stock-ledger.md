# ADR-0022: Tills in a shop share a catalogue and a stock ledger; the cloud is the courier

**Status:** Accepted · **Date:** 2026-10-04 · **Deciders:** Zothix (Codroon)

## Context

Arkom runs two tills. On 1 and 2 October each was enrolled with the cloud, and the dashboard
duly showed **two shops**: one called "ARKOM" with 31 products and 5 sales, one called "Arkom"
with 377 products and 237 stock movements, with no overlap between them. The shop's own
summary of the problem was shorter: *"caja 2 has the real stock."*

Nothing was broken. Every rule in the repo was obeyed. The two tills held different data
because **there is no way for a till to join a shop that already exists** — first run asks
who you are and creates a tenant, so the second install created a second shop, and ADR-0001's
up-only sync carried both upward faithfully and forever apart.

That is the bug: not a defect in the sync, but a missing path. Two decisions have to be
reopened to close it, and one has to be stated for the first time.

1. **ADR-0001 chose up-only sync**, and ADR-0020 §5 wrote it down as a rule: "the cloud never
   writes back". That was the right call when the cloud was a read model behind a dashboard
   and a shop had one till. It is the wrong call for a shop with five, because the only thing
   that can carry till 1's receipt of stock to till 4 is the network they both already have.
2. **ADR-0020's enrolment claims a tenant.** `enrol()` refuses a tenant belonging to another
   account (`TENANT_CLAIMED`) but has no notion of a till asking to be *added* to a shop. The
   till sends its own freshly minted `tenantId` and the cloud records it.
3. **Nothing anywhere says which data belongs to the shop and which belongs to the till.**
   The schema has quietly been right about this since ADR-0009 — `product_stock` is keyed by
   `location_id`, not `terminal_id`; `documents` and `number_series` carry `terminal_id` —
   but it was never written down, so there was nothing to implement against.

The constraint that shaped the original design has also genuinely changed. The till is
offline-first because a shop's counter must not stop when a router does, and that stays. But
a shop with several tills on one counter has a LAN and a connection, the product is sold on
the promise that its tills agree, and every competitor in the category assumes a network.
Offline-first is a guarantee about **availability of the counter**, not a vow of ignorance
between two machines a metre apart.

## Decision

### 1. Shared or per-till is a property of the entity, and here is the list

Replicated between the tills of a shop — the **shop's** facts:

| Entity | Why it is the shop's |
| --- | --- |
| `product_group` | ADR-0017: groups belong to the shop |
| `product` | one catalogue, one price |
| `product_code` | a barcode scans the same at every till |
| `supplier` | one supplier list |
| `customer` | the person who bought at till 1 is known at till 4 |
| `unit` | a serialised phone is on one shelf, not one till's shelf |
| `stock_movement` | the ledger ADR-0004 made insert-only, which is why this works |

Never replicated, and each for a reason that is not squeamishness:

| Entity | Why it stays home |
| --- | --- |
| `setting` | **the printer is a setting.** Replicating settings points till 4 at till 1's printer. Also the shop's legal block, which is genuinely shared, and which is therefore handled by naming the shared keys explicitly rather than by shipping the table |
| `user`, PIN material | ADR-0012 froze the till's PIN as the only authority the till consults; `REDACTED_KEYS` strips the hash before a batch leaves the building. Staff are created per till, deliberately |
| `document`, `document_line`, `document_tender` | a document is that till's fiscal record under a per-till series (ADR-0008), inside that till's shift (ADR-0015). See §8 |
| `number_series` | per-till by ADR-0008. Sharing one would hand two tills the same invoice number |
| `shift`, `cash_movement` | one drawer, one till, one Z (ADR-0015) |
| `repair_ticket`, `used_purchase` and their children | Phase 2. The phone is physically at one counter, and both carry data — passcodes, ID photographs — that ADR-0013 and ADR-0014 §10 keep local |
| `store_credit_voucher` | a voucher is a TENDER (ADR-0013). Replicating one without a lock lets
the same credit be spent at two counters, which is a loss, not a discrepancy. Phase 2, with a
redemption that settles centrally |
| photographs | ADR-0020 §3: files stay home, and nothing here changes that |

This table is the contract. It lives in code as `SHARED_ENTITIES` in `@arkom/core`, and a test
pins it, so adding an entity to the sync is a deliberate edit to a list somebody reviewed.

### 2. The cloud gains a second door, and it is still not a writer

`GET /api/sync/pull` serves a tenant's own entries back to that tenant's other tills,
authenticated by the same device token as the push. The cloud:

- **stores what it is given and hands back exactly that.** It does not compute, merge,
  resolve or decide. The fold in `apps/web/src/db/fold.ts` is a read model for the dashboard
  and plays no part in the pull.
- **never originates a row.** Every entry it serves was written by one of that shop's own
  tills. There is no payload a till can receive that the cloud made up, which is the property
  ADR-0020 §5 was protecting and which survives intact.
- **excludes the caller's own device**, so a till never re-applies its own writes.

So "the cloud never writes back" becomes the sharper and still-true statement: **the cloud is
a courier between a shop's tills, and it never authors.** It holds no authority a till must
obey; if the service vanished tomorrow every till would keep selling with the data it has.

### 3. Ordering a merged stream needs a column the till does not own

`oplog.seq` is per-till (ADR-0005) and `sync_entries` is keyed by `(tenant_id, op_id)`
precisely so that a restored till's renumbered batch is not a poison pill. Neither can order
a stream merged from five tills: till 1's `seq` 400 and till 2's `seq` 400 are unrelated
facts, and paging on `received_at` is paging on a clock that ties.

`sync_entries` therefore gains **`ingest_seq bigserial`** — an arrival order the cloud
assigns, which no till can influence and which exists only to be paged against.

It is an ordering, not an identity. Identity remains `(tenant_id, op_id)`.

### 4. A sequence is assigned before the commit, so the pull lags a few seconds

The subtle failure in every cursor built on a `bigserial`: the number is taken when the row is
written and becomes visible when the transaction commits. Two concurrent ingests can take 500
and 501 and commit in the other order, so a reader that sees 501 and stores it as a cursor
will never see 500. Money quietly missing, once a week, unreproducible.

A pull therefore serves only rows that have **settled**: `received_at < now() - 5s`. Any
transaction that was in flight when a settled row was written has since committed or rolled
back, so there are no holes behind the cursor. The cost is that a sale takes a few seconds
longer to reach the next till, which no one at a counter can perceive.

A cursor is stored per till in `cloud-link.json` beside the push cursor — `lastPulledIngestSeq`
— for the same reason the push cursor lives there (ADR-0020 §2): it is state about the link,
and every table row is pushed to the service the token authenticates.

### 5. Received is not applied, and the inbox is what makes that safe

A pull cannot apply its batch straight into the business tables. `product_code.product_id`
is `NOT NULL REFERENCES products`, `unit.purchase_id` references a `used_purchases` row that
§1 does not replicate, and entries arrive in the order they were ingested, not the order
SQLite's foreign keys demand.

So a pull does one thing: it writes the batch into a local **`sync_inbox`** table and advances
the cursor. Application is a separate pass that:

- walks the pending rows in **dependency order** (`product_group` → `product` →
  `product_code` → `supplier` → `customer` → `unit` → `stock_movement`);
- marks each row applied, or records why it could not be and **leaves it pending**;
- retries the pending rows on every subsequent pass.

An entry that arrives before its parent is not an error, it is early, and it applies on the
next pass without anybody being told. An entry that can never apply — a `unit` belonging to a
used purchase this till will never hold — stays pending forever and is counted, which is a
diagnostic rather than a crash. The pass is idempotent by `op_id`, so applying twice is
applying once.

This is also the honest answer to "what if a till is off for a week": it pulls, fills its
inbox, and drains it in dependency order like any other batch.

### 6. Applying a received entry writes NO oplog entry

`mutate()` throws when a build records no oplog entry, by design (ADR-0005). An applier cannot
use it: an entry written on till 4 for a product till 1 created would be pushed to the cloud,
pulled by till 1, applied, pushed again. An echo, forever, growing.

Received entries are applied through a deliberate sibling, **`absorb()`**, which takes the
same transaction and writes business rows plus the recomputed `product_stock` cache plus the
inbox bookkeeping, and writes nothing to the oplog. The two functions state the rule between
them: **the oplog records what this till decided, and a replicated row is not a decision this
till made.** A test asserts the oplog is unchanged across an absorb, because this is the one
mistake here that would be expensive and silent.

The audit trail is not lost. It is complete on the till that made the decision, and complete
in the cloud, which is where a shop with five tills looks anyway.

### 7. Conflicts: last writer wins per field, and stock cannot conflict

The same rule the dashboard's fold already uses, for the same reason — the till pushes
changes, not rows — now applied locally: **last writer wins per FIELD**, ordered by the
entry's own `(created_at, op_id)`. Renaming a product at till 1 while till 2 changes its price
keeps both edits; two tills renaming it in the same second resolves to one name, and nobody
can tell you which, which is the correct amount of effort to spend on that.

`stock_movement` has no conflict case at all. ADR-0004 made the ledger insert-only, so two
tills selling the same phone produce two movements, both true, and the on-hand figure is their
sum. The cache is **recomputed from the movements** on apply and never replicated — a cached
total on the wire would be a second answer to a question that already has one (ADR-0015 §3).

Clocks skew. `created_at` comes from the till that wrote the row, and a till with a wrong
clock can win or lose an edit it should not have. For catalogue edits that is tolerable. The
pull response carries the server's time and the till records the offset, so a badly set clock
is **visible** in Ajustes → Nube rather than mysterious. Making it authoritative is Phase 2.

### 8. A sale stays on its own till; shop-wide figures are the cloud's job

Documents are not replicated, and this is a boundary rather than an omission.

A document is numbered from a per-till series (ADR-0008), sits inside a per-till shift, and is
counted by a Z that ADR-0015 made immutable. Copying till 1's sales into till 4's database
would put rows in till 4's `documents` table that belong to no shift of till 4's, and `Informes`
— which reads completed documents (ADR-0016) — would answer a different question from the Z
printed at the same counter an hour earlier. Two answers, no way to say which is right: the
exact failure ADR-0015 §3 exists to prevent.

So: **a till's `Informes` reports that till's own takings, and agrees with that till's Z. The
shop's combined figures are on the dashboard**, which is where they were asked for, which now
shows every till together with a filter by till (§10), and which is the one place that holds
all five streams by construction.

What the shop actually asked for is unaffected: the stock is the same at every till, because
the ledger replicates; the catalogue, the prices and the barcodes are the same; a customer is
known everywhere. The thing that stays per-till is the one thing that is genuinely per-till.

### 9. A second till joins the shop instead of founding one

`POST /api/enrol` changes shape. Today the till sends its own `tenantId` and the cloud records
it. From now on:

- the **cloud's response carries the tenant and location to use**. If the account already has
  a shop, that is the shop's existing `tenant_id` and `location_id`, and the till adopts them;
  if it does not, the till's proposal is accepted and becomes the shop.
- the `terminal_id` is always the till's own, because it is the one thing about a till that
  must be unique (ADR-0008).
- the till then **rewrites its local rows** to the adopted keys inside one transaction, pulls
  the shop's catalogue and ledger from `ingest_seq 0`, and only then reports success.

A till that adopts a shop discards the demo or empty data of its own first run. A till that
has already sold under its own tenant is a different and harder case: it is **refused** with
`TILL_HAS_HISTORY` rather than guessed at, because merging two fiscal histories is not
something a wizard should do while somebody waits. That is the state Arkom is in, and it is
handled once, deliberately, by a documented operator path — not by code that runs on a shop's
machine at 9am.

### 10. The dashboard shows the shop, filtered by till

Every panel screen reads the account's tenants together and gains a till filter. This falls
out of the fold already being keyed on `entity_id` rather than the payload's `id` — the
correction that `pnpm cloud:reconcile` caught — so "all tills" is the natural query and one
till is the special case.

### 11. Oversell is reported, not prevented

Two tills can sell the last phone in the same second. Preventing that needs a lock the shop's
counter would wait on, which trades the guarantee the whole product is built around for an
event that is rare and already visible on the shelf.

Core still rejects a negative on-hand **locally** (ADR-0004), so a till cannot sell into a
negative it can see. When replication reveals that two tills did, `pnpm db:audit` and the
dashboard both surface it as what it is: a stock discrepancy, of the kind a shop with a shelf
and a cupboard already has, with a ledger that says exactly how it happened.

## Consequences

**Good.** The shop's stock is one number again, which was the whole complaint. The catalogue
is maintained once. A new till is useful within a minute of enrolling instead of needing its
catalogue typed in. Nothing in the counter's path waits on any of it — the pull is a timer,
the apply is a background pass, and both are invisible to a sale. ADR-0004's insert-only
ledger turns out to have been the decision that made multi-till replication nearly free, four
ADRs before anybody needed it.

**Bad, and accepted.** The cloud is now load-bearing for *agreement* between tills, though not
for the operation of any one of them: cut the network and every till keeps selling, but they
stop converging. A few seconds of settle lag before a receipt of stock shows at the next till.
LWW will, rarely, lose a simultaneous catalogue edit. A till's `Informes` is narrower than the
shop, by §8. Clock skew is visible rather than solved.

**Phase 2, named so nobody builds them here.** Repairs and used purchases crossing tills;
documents replicated read-only so a till can report for the shop; a true clock discipline;
reservation-based oversell prevention; the LAN path that would let two tills converge with the
router unplugged.

## Compliance

- `SHARED_ENTITIES` and the dependency order live in `@arkom/core` with a test that pins both.
- A test asserts `absorb()` writes no oplog row, and that the push cursor does not move when
  an inbox row is applied.
- `redactForSync()` is unchanged and still applies to everything on the wire in both
  directions; a test asserts a pulled batch carries no redacted key.
- `pnpm db:truth` + `pnpm cloud:reconcile` gain a two-till mode that asserts both tills hold
  the same on-hand figure for every product, and is the pre-deploy gate.
- `pnpm db:audit` still asserts the stock cache equals the sum of the movements, which is now
  also the check that replication landed.

## Supersedes

ADR-0001's "up-only" sync and ADR-0020 §5's "the cloud never writes back", both narrowed to:
the cloud is a courier between one shop's tills and never authors a row. Everything else in
ADR-0001, ADR-0005, ADR-0009 and ADR-0020 stands — in particular `(tenant_id, op_id)` as
identity, `seq` as a per-till ordering, `redactForSync()`, and photographs staying home.
