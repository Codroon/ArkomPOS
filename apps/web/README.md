# Codroon POS — the cloud half

The till is the product. This is the read model beside it: tills push what they
have already committed, and **nothing here ever writes back to a till**
(ADR-0001, ADR-0020). If this deployment were deleted tomorrow, every shop would
carry on selling and would re-push from its own cursor when it returned.

Built so far: the ingest door. Not built: the dashboard, the projections it will
read, the landing page and payment.

## What is here

```
app/api/enrol/route.ts    POST — a code buys a device token
app/api/sync/route.ts     POST — Bearer token, a batch of oplog rows
src/sync/ingest.ts        who may write, and what may be acked   (pure, tested)
src/sync/enrol.ts         claiming a till for an account          (pure, tested)
src/sync/store.ts         the port both implementations satisfy
src/db/schema.ts          five tables, Drizzle → Postgres
src/db/pg-store.ts        the atomic half: spend a code once, store a row once
src/lib/secrets.ts        tokens and codes — digests in, secrets out
scripts/                  issue a code · delete a tenant
```

The rules are pure functions over a store interface, so `pnpm test` exercises
them without a Postgres: 37 cases covering revoked tills, batches that name
another shop, replays, an empty push, a re-enrolled till replaying from zero, and
the two secrets that must never become durable. The contract itself —
`SyncPushRequest`, `SyncEnrolRequest`, `redactForSync()` — lives in
`packages/core/src/sync.ts` and is imported by the till too, so the envelope
cannot drift between the two halves.

## Setting up a deployment

1. **Create the database in an EU region.** Neon, `eu-central-1`. This is not a
   preference: ADR-0020 §4 makes the shop the data controller and Codroon the
   processor, and personal data of Spanish shoppers stays in the union because of
   where we chose to deploy. `vercel.json` pins the functions to `fra1` for the
   same reason.
2. **`cp .env.example .env.local`** and paste the pooled connection string.
   `.env.local` is gitignored — it is a database credential.
3. **`pnpm db:migrate`** (from this folder). Migrations live in `drizzle/` and
   are a separate lineage from the till's: that one is SQLite and its own
   business, and the two never meet.
4. **`pnpm dev`** for a local run, or deploy to Vercel with `DATABASE_URL` set as
   an environment variable.

Vercel's Hobby plan forbids commercial use, so a deployment that shops pay to use
needs Pro.

## Linking a till

```
pnpm --filter @arkom/web cloud:code -- --email ana@tienda.es --name "Ana García"
```

Prints a code like `KRQ4-7T2M-9BXH` **once**; the database keeps a digest, so a
lost code is replaced by issuing another. Single use, seven-day life, an alphabet
with no `O/0` or `I/1` because somebody reads it aloud down a phone.

The owner pastes it into the till at **Ajustes → Nube**. The till sends the ids
it generated at its own first run and gets a device token back; from then on it
pushes on a timer. Linking replays the shop's whole history, so the first look at
a dashboard has their past in it and not just this afternoon.

`--label "caja de arriba"` records which till a code was meant for.

## Deleting a shop

```
pnpm --filter @arkom/web cloud:delete-tenant -- --tenant <id>        # shows what it would delete
pnpm --filter @arkom/web cloud:delete-tenant -- --tenant <id> --yes  # does it
```

ADR-0020 §4: a feature, built before the first paying customer — not a support
ticket answered with SQL at midnight. One statement; the foreign keys take the
rows and the tills with it, so a table added later cannot be left behind.

## Two things to know before changing anything here

**`seq` is an ordering, not an identity.** `sync_entries` is keyed by
`(tenant_id, op_id)`. A till restored from a backup can legitimately re-use a
`seq` for a different row, and a unique constraint on `(tenant, terminal, seq)`
would turn that shop's next batch into a poison pill that never drains.

**What we ack is what we stored, never the cursor we remember.** A re-enrolled
till replays from zero while our copy of its cursor still reads 500; answering it
with 500 would make it skip everything in between — a month of a shop's history,
with no error anywhere. The two numbers have two jobs and `ingest.test.ts` pins
both.
