# ADR-0004: Stock is an insert-only movement ledger

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Requirements are explicit: quantity comes from stock movements and is never edited on the
inventory screen (req 5.1); no row may go below zero (5.3); every item shows movement
history with date, type, quantity, user, document (5.4). The same data must sync to the
cloud without conflicts, and later feed serialized (IMEI) units, repairs parts pulls, and
stock counts.

## Decision
- Table `stock_movements`: **insert-only**. Rows are never updated or deleted; corrections
  are compensating movements.
- On-hand quantity = SUM(movements) per product/location, maintained as a cached column
  updated in the same SQLite transaction that inserts the movement (denormalized for
  instant reads, always derivable from the ledger).
- Movement types (Phase 1): `purchase_in`, `sale_out`, `adjustment` (gated). Reserved for
  later phases: `count_post`, `repair_part_out`, `tradein_in`, `return_in`, `transfer`.
- **Negative stock blocked in `packages/core`,** not in the UI: the domain function that
  builds a movement batch rejects any batch that would take on-hand below zero.
- Serialized units (phones) will be individual rows in a `units` table whose lifecycle
  events also emit ledger movements — same spine, later phase.

## Options considered
Mutable `quantity` column edited in place: simpler day 1, but destroys history (5.4),
invites drift, makes sync conflict-prone, and contradicts 5.1. Rejected.

## Consequences
- Easier: audit-grade history for free; sync = merging inserts (near conflict-free);
  stock counts post as movements like everything else.
- Harder: every stock-touching feature must go through the domain layer — enforced by
  Vitest tests on `packages/core`.
