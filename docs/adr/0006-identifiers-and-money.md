# ADR-0006: UUIDv7 identifiers, integer-cent money, basis-point tax rates

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Rows are created on an offline till and must merge into a shared cloud database without
coordination. Money math must be exact — a rounding bug is a fiscal problem, not a visual
one. JavaScript floats are not an acceptable representation for either.

## Decision
- **Primary keys: UUIDv7**, generated on the till. Time-ordered (index-friendly),
  collision-safe across tills, no central allocator needed.
- **Money: integers in euro cents** everywhere — DB, domain logic, IPC, API. Formatting
  to "12,34 €" happens only at the UI/print edge. No floats, no decimal strings in logic.
- **Tax rates: integer basis points** (21% = 2100) stored wherever a rate is snapshotted.
- **Rounding: per line, half-up, at cent precision.** Line total = round(qty × unit_price
  × (1 + rate)); document totals = exact sum of line totals. One rounding rule, one place
  in `packages/core`, covered by Vitest against hand-computed cases.
- Human-facing numbers (ticket numbers) are a separate concern — ADR-0008.

## Options considered
Float euros (rounding bugs guaranteed) · decimal strings (arithmetic ceremony everywhere) ·
autoincrement integer PKs (collide across tills; leak volume). All rejected.

## Consequences
- Easier: money equality is integer equality; sync merges never collide on ids.
- Harder: every price entering the system converts to cents at the boundary (Zod
  transforms handle it once).
