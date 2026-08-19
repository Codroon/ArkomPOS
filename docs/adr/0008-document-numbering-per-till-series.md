# ADR-0008: Gap-free document numbers allocated locally, per till series

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Spanish invoicing requires sequential, gap-free numbering per series (req 22.2). Numbers
must be allocated while offline — the cloud cannot be the allocator. Two tills must never
race for the same number.

## Decision
- `number_series` table: `id · tenant_id · location_id · terminal_id · doc_type
  (ticket|invoice|credit_note) · prefix · next_number`.
- Allocation happens **on the till, inside the same SQLite transaction** that finalizes
  the document: read `next_number`, stamp `prefix + zero-padded number`, increment.
  Atomic locally, no coordination needed, gap-free by construction.
- Each till gets its own series (e.g. `T1-000123`) — standard Spanish practice and the
  only scheme that works offline. Phase 1 issues **simplified tickets** in one series;
  full invoice and credit-note series activate in a later phase on the same mechanism.
- The cloud never allocates numbers; it only receives them via the oplog.

## Options considered
Cloud-allocated global sequence (breaks offline) · UUID-only documents (illegal for
invoices) · per-day sequences (gaps across days, no benefit). All rejected.

## Consequences
- Easier: fiscal numbering correctness is a 20-line local transaction.
- Harder: voided-before-issue flows must be modeled as issued-then-credited later, never
  by skipping a number — enforced in domain logic.
