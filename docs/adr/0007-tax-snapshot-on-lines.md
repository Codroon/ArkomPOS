# ADR-0007: Tax regime, rate and amounts snapshotted on every document line

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Spanish reality ahead of us: standard IVA (21/10/4), REBU margin scheme for used devices,
exempt agency lines (WU principal), and — for productization — Verifactu/TicketBAI-style
invoice reporting with hash-chained records. Historical documents must show the tax as it
was at sale time, immune to later catalog edits. Phase 1 only sells standard-rate stocked
goods, but the shape must not need migration when the rest arrives.

## Decision
Every sale line stores its own immutable tax snapshot at creation time:

    tax_regime ENUM('IVA21','IVA10','IVA4','REBU','EXEMPT')
    tax_rate_bp INTEGER          -- 2100, 1000, 400, 0…
    base_cents / tax_cents / total_cents INTEGER

- Products carry a *default* regime; the line copies it and freezes it.
- Phase 1 uses `IVA21` only; the enum ships complete so used devices (REBU) and agency
  lines (EXEMPT) later are data, not schema changes.
- Documents reserve nullable columns for the fiscal chain (`fiscal_hash`,
  `prev_fiscal_hash`, `fiscal_status`) — written by the Verifactu/TicketBAI module in a
  later phase, present now so no ALTER lands on a live invoice table.

## Options considered
Compute tax at read time by joining the product's current rate: historically wrong the
first time a rate or regime changes, and incompatible with immutable fiscal records.
Rejected.

## Consequences
- Easier: reprints and reports are stable forever; REBU/exempt/fiscal-chain bolt on
  without touching sales code paths.
- Harder: a few "unused" columns in Phase 1 — deliberate.
- Revisit: client's region (standard AEAT Verifactu vs Basque TicketBAI) — open question
  with the client; schema supports either.

## Amendment A1 — the general rate is a setting (v0.18.0, 2026-09-03)

`TAX_RATE_BP.IVA21` stopped being the figure lines are snapshotted with. The till
carries `vatRateBp` in `settings` (default 2100), edited on the Ajustes taxes card,
and it is read at the moment a line is written: a sale line when it is added, a
repair's collection lines at hand-back, the product row's `tax_rate_bp` at save.
Nothing already written moves — the decision above is exactly what makes a rate
change safe, and the test pins a 21 % line staying 21 % after the setting says 10.

The REGIMES are still the law's and stay read-only. REBU is the regime a Used-type
article carries, and it is derived from the type rather than chosen: a used article
is REBU and nothing else is, enforced in `saveProduct` and mirrored in the editor.
The series card gained the rate field and nothing else — there is still no channel
that writes a series (ADR-0008).
