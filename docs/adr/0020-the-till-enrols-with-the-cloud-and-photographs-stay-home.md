# ADR-0020: A till enrols once, pushes its oplog, and its photographs stay home

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Zothix (Codroon)

## Context

ADR-0001 chose a hybrid product: an offline-first till that owns every write, and a cloud
that reads what the till did. ADR-0005 chose the mechanism — one append-only oplog that is
both the audit log and the sync outbox, pushed `WHERE seq > last_acked` in batches, applied
idempotently by `op_id`, acked by highest `seq`. ADR-0009 chose shared-schema multi-tenant
Postgres scoped by `tenant_id`.

None of that is reopened here. What those three leave open is everything that turns a
design into a deployed product:

1. **How a till proves it is that shop's till.** The oplog carries `tenant_id`, but a
   `tenant_id` is a UUID any caller could type. Nothing today authenticates a device.
2. **What is excluded from the push.** ADR-0014 §10 says the device passcode column must be
   excluded or encrypted in Phase 2 sync, and never says by what mechanism. Nothing says
   anything about the photographs.
3. **Where the data lives and who is answerable for it.** Codroon is about to hold other
   people's customers' names, phone numbers and identity-document numbers.

The product is now **Codroon POS**, sold at pos.codroon.com to shops Codroon has never met.
That changes the third question from a preference into a legal position.

## Decision

### 1. Enrolment: the till is claimed once, by a person, and holds a device token

A fresh till has no cloud. In **Ajustes → Nube** the owner pastes an **enrolment code** from
their pos.codroon.com account. The till calls `POST /api/enrol` with that code and its own
`tenant_id`, `terminal_id` and machine fingerprint; the cloud binds them to the account and
returns a long-lived **device token**. Every later push carries that token.

- The **till keeps the ids it generated at first run.** The cloud records them; it does not
  issue them. A till that has been selling for a year enrols without renumbering anything,
  and UUIDv7 (ADR-0003) makes collisions across shops a non-question.
- The token is **machine state, not shop data**: it lives in `userData/cloud-link.json`
  beside the window state, and NOT in a table. Every row in the database goes through
  `mutate()` into the oplog and out to the cloud — a token stored as a settings row would
  be uploaded to the service it authenticates. Losing the file costs a replay (the cloud
  deduplicates by `op_id`) and never a duplicate.
- It is the only credential the sync path has, and it authorises **one terminal** to write
  **one tenant's** stream. A batch carrying an `op` for another tenant is rejected whole,
  not filtered: storing the honest rows and dropping the one would leave the till believing
  it had delivered something we deliberately threw away.
- Enrolment is **reversible from the cloud** (revoke) and **repeatable on the till** (paste
  a new code). Revocation stops ingestion; it never stops selling.

### 2. The push is up-only, and it may never block the counter

Exactly as ADR-0005 designed, with the operational rules made explicit:

- The till pushes in the background on its own schedule. **No user action ever waits on the
  network.** A shop with a dead line sells all day and syncs when the line comes back.
- A batch is a list of oplog rows plus the token. The cloud applies each row idempotently by
  `op_id` (the till's unique index guarantees they are unique at source) and acks the
  highest `seq` it stored. The till advances its cursor only on an ack.
- Ordering is per terminal, by `seq`. Two terminals in one shop are two independent streams;
  nothing in the read model needs them interleaved.
- **The cloud never writes back.** Down-sync remains the later, separate decision ADR-0001
  reserved.

### 3. What does NOT leave the shop

| Excluded | Why |
|---|---|
| **Device passcodes** | ADR-0014 §10. The column is stripped from every oplog payload before it is queued, not filtered at the far end. |
| **PIN hashes** | ADR-0012 already keeps them out of the oplog. Nothing to do but keep it true. |
| **Photographs** — device photos and seller ID photos | They are files, not rows (ADR-0013). They are the most sensitive thing the till holds — a photograph of a DNI — and no dashboard metric needs them. They stay under `userData/photos/`, where the shop's own backups cover them. |

Everything else goes: documents, lines, tenders, stock movements, repairs, used purchases,
shifts, settings, and the customer and seller **rows** — names, phones and identity-document
numbers included. A dashboard that cannot name the customer whose repair is late is not
worth hosting, and syncing "some fields now, the rest later" means migrating history twice.

### 4. Residency and roles

- **Postgres and the application run in the EU** (`eu-central`). Personal data of Spanish
  shoppers does not leave the union because of where we chose to deploy.
- **The shop is the data controller; Codroon is the processor.** A data-processing agreement
  ships with the product and is accepted at enrolment. It is short, it is in Spanish, and it
  names exactly what this ADR says leaves the till.
- **Deleting a tenant is a feature, built before the first paying customer** — not a support
  ticket answered with SQL. One call removes that tenant's rows and revokes its tokens.
- Retention follows the shop's own obligations, not ours: fiscal documents are kept, and the
  used-device register has its own legal life in Spain. We delete when the shop leaves.

## Options considered

**Off-the-shelf sync (PowerSync, ElectricSQL, Turso replicas).** Rejected in ADR-0005 and
still rejected: it puts a vendor in the middle of a resellable product and does not produce
the audit log we are required to have anyway.

**Account credentials on the till instead of a device token.** The owner's email and password
sitting in a settings table on a shop PC that cashiers use. Rejected — a token scoped to one
terminal, revocable from the account, is strictly less dangerous.

**Cloud-issued tenant ids.** Tidy on paper, but it makes first run depend on the internet and
forces a renumbering of every existing row at enrolment. Rejected: offline-first means the
till is complete before the cloud exists.

**Syncing the photographs.** Rejected for v1 on risk and cost: object storage, bandwidth, and
the one payload whose breach would be genuinely serious. Revisit behind a per-shop toggle if
a shop asks for remote access to them.

## What shipped (v1.2.0)

Both halves, against one file of shared Zod schemas (`packages/core/src/sync.ts`) so the
envelope cannot drift:

| | |
|---|---|
| **Till** | `main/sync/{link,push,enrol}.ts` · `cloud:*` IPC · Ajustes → Nube |
| **Cloud** | `apps/web` — `POST /api/enrol`, `POST /api/sync`, five Postgres tables |
| **Contract** | `SyncPushRequest/Response`, `SyncEnrolRequest/Response`, `redactForSync()` |

Three things the build decided that this ADR had left open, each pinned by a test:

1. **`seq` is an ordering, not an identity.** `sync_entries` is keyed by `(tenant_id, op_id)`
   and deliberately NOT by `(tenant_id, terminal_id, seq)`: a till restored from a backup can
   legitimately re-use a `seq` for a different row, and a unique constraint there would turn
   that shop's next batch into a poison pill that never drains.
2. **What we ack is what we stored, never the cursor we remember.** A re-enrolled till
   replays from zero while the cloud's copy of its cursor still reads 500; answering with 500
   would make it skip everything in between — a month of a shop's history, silently.
3. **The redaction runs at both ends.** §3 puts the guarantee at the source and that is still
   where it lives, because a secret on the wire has already left the shop. Running it again on
   receipt costs nothing and means the far end is never where a leak becomes *durable* — an
   old build, a future bug, or a hand-made batch all land there.

Not built here: the dashboard, the projections it will read, and the landing page that sells
the thing. The raw stream is complete and ordered, so every projection is derivable from it
by replaying `sync_entries` — which is why this slice stores rows and computes nothing.

## Consequences

- **Easier:** the cloud is a read model with one door; a lost or stolen till is revoked from
  a browser; the dashboard can answer questions about real people because it has their rows.
- **Harder:** we hold personal data, so the DPA, the EU region and the delete path are now
  release blockers rather than nice-to-haves. The passcode strip must be tested, because a
  leak there is a silent one.
- **Revisit:** down-sync of catalogue edits; photographs behind a toggle; Postgres RLS when
  tenant #2 arrives (ADR-0009 already names that trigger); batch size and pruning of acked
  oplog rows once real volume is known.
