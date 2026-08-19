# ADR-0005: One append-only oplog = sync outbox + audit log

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Two requirements point at the same mechanism: (a) every till change must reach the cloud,
surviving offline gaps (ADR-0001); (b) req 25.2 demands an audit log on every action —
user, time, terminal, before value, after value. Building these separately means two
write paths that can disagree.

## Decision
A single append-only table `oplog` on the till, written **in the same transaction** as
every business mutation:

    id UUIDv7 · seq (local autoincrement) · entity · entity_id · action
    before JSON · after JSON · user_id (nullable, ADR-0010) · terminal_id
    tenant_id · location_id · created_at

- **Sync = push the oplog.** Till sends `WHERE seq > last_acked` in batches over HTTPS to
  the Next.js sync route; cloud applies entries idempotently (by `id`) into Postgres and
  acks the highest `seq`. Offline: entries queue; reconnect: they flush. Retries are safe.
- **Audit = query the oplog.** The audit screens and the "history" panels are views over
  the same rows. No second logging system, ever.
- v1 direction is up-only; the envelope (entity/action/before/after) is already what a
  future down-sync needs, so two-way later is an extension, not a redesign.

## Options considered
- Off-the-shelf sync (PowerSync / ElectricSQL / Turso embedded replicas): fastest start,
  but places a vendor at the center of a resellable product and doesn't give us the audit
  log anyway. Rejected.
- Separate audit table + separate sync queue: double writes, drift risk, more code.
  Rejected.

## Consequences
- Easier: one write path to test; audit and sync can never disagree; idempotent replay
  makes flaky shop Wi-Fi a non-event.
- Harder: JSON before/after discipline on every mutation — enforced by a single
  `mutate()` helper in `packages/core` that all writes go through.
- Revisit: batch size/backpressure once real volume is known; pruning synced oplog rows
  after N months (audit retention stays in cloud).
