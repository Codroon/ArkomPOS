# ADR-0003: SQLite on the till, Postgres (Supabase) in the cloud, Drizzle on both

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
The till needs a zero-administration database that survives power cuts mid-sale and reads in
microseconds (scan → line added, no lag). The cloud needs a durable multi-tenant store for
the dashboard. Nobody will be administering a database server on a shopkeeper's PC.

## Decision
- **Till:** SQLite via better-sqlite3, WAL mode, `synchronous=NORMAL`, foreign keys on.
  Single file under the app's userData dir. Synchronous API — no async ceremony in the
  main process, transactions are trivial.
- **Cloud:** PostgreSQL managed by Supabase (hosting, backups, PITR). Supabase used as
  "Postgres + Auth" only — sync protocol is ours (ADR-0005), keeping lock-in low.
- **Both** accessed through Drizzle ORM. One logical schema defined once in
  `packages/db`, emitted for both dialects; migrations via drizzle-kit per side.

## Options considered
- **Postgres server on the shop PC:** operational nightmare (service management, upgrades,
  corruption recovery) owned by us forever. Rejected.
- **Embedded replica products (Turso/libSQL, ElectricSQL, PowerSync):** attractive sync
  story, but vendor-shaped data layer at the very center of a product we intend to resell,
  plus another moving part to learn in a 2-week window. Rejected — our sync is a few
  hundred lines we own (ADR-0005).
- **Prisma instead of Drizzle:** heavier runtime, less predictable SQL, weaker
  SQLite+Postgres dual story. Rejected.

## Consequences
- Easier: till installs are copy-a-file simple; local backups = copy the .db (plus
  cloud sync as the real backup).
- Harder: two SQL dialects — mitigated by Drizzle and by keeping SQL portable (no
  Postgres-only features in shared tables).
- Revisit: nothing expected; SQLite comfortably handles single-shop volume for years.
