# ADR-0009: tenant_id, location_id, terminal_id on every business row from day one

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
Req 24.2 mandates multi-location in the data model from day one, and the commercial plan
is to resell Arkom POS to other retailers — multiple tenants sharing one cloud. Retrofitting
tenancy keys onto live fiscal data is the single most expensive migration in SaaS.

## Decision
- Every business table carries `tenant_id` and `location_id`; operational rows
  (documents, movements, oplog) also carry `terminal_id`.
- Phase 1 runs with exactly one tenant, one location, one terminal, created by seed and
  injected by config — the UI never asks.
- Cloud Postgres is shared-schema multi-tenant, every query scoped by `tenant_id`
  (enforced in the data layer; Postgres RLS added when tenant #2 arrives).

## Options considered
Single-tenant schema now, migrate later: cheaper for two weeks, catastrophic at resale
time (rewriting keys under live gap-free invoices). Rejected. Database-per-tenant:
operationally heavy for a one-person team; reconsider only if a big buyer demands
isolation. Deferred.

## Consequences
- Easier: onboarding retailer #2 is an INSERT, not a migration.
- Harder: three extra columns everywhere — invisible cost once helpers stamp them.
