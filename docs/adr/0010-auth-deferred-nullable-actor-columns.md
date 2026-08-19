# ADR-0010: Authentication and shifts deferred; nullable actor columns now

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Full requirements demand named logins, shift open with counted float, and per-user gating
(reqs 1, 21, 25). Phase 1 explicitly excludes auth to hit the two-week window; the app
opens straight onto the sale screen. Bolting identity on later must be a migration-free
step.

## Decision
- No login, no shift UI, no roles in Phase 1.
- Every row that will ever need attribution carries **nullable** `user_id` and documents
  carry nullable `shift_id` from day one. The oplog records `user_id = NULL`,
  `terminal_id = <till>` until auth lands.
- Gated actions (price override, adjustment) already require a **reason** and write full
  oplog entries — the gate exists; only the "who" is missing.
- When auth ships (next phase): local user table + PIN, shift table, columns flip to
  required at the domain layer — no schema rewrite, no backfill beyond NULL = "pre-auth".

## Options considered
Skipping the columns until auth exists: forces ALTERs + backfills across documents,
movements and oplog later. Rejected for two spare columns now.

## Consequences
- Easier: Phase 1 stays lean; auth becomes additive.
- Harder: Phase 1 audit entries answer "what/when/where" but not "who" — accepted and
  understood by the client for the pilot period.
