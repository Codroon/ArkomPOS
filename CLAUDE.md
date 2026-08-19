# CLAUDE.md — Arkom POS

Operating instructions for Claude Code in this repo. Read before writing anything.

## Authority order (conflicts resolve upward)
1. `docs/adr/` — frozen decisions. Do not relitigate. Changing one = new superseding ADR, ask first.
2. `docs/design/system-design.md` — boundaries, write path, IPC contract.
3. `packages/db/src/schema.ts` — the schema. Column changes only via drizzle migration + ADR check.
4. This file.

## What we are building right now (Phase 1 only)
Desktop till (Electron) with three screens: **Sale**, **Catalog**, **Inventory (+ minimal add-stock)**.
NOT in Phase 1: auth/login/shifts, refunds/voids, full invoices, card-terminal SDK, sync, web app,
repairs/used/agency/SIM screens. Schema already anticipates them — build nothing for them.

## Hard rules
- **Money is integer cents. Never floats. Never strings in logic.** Formatting only at UI/print edge.
- **IDs are UUIDv7** from `@arkom/core`. Never `Math.random`, never autoincrement business ids.
- **Every write goes through `mutate()` in core** → one SQLite transaction: business rows +
  `product_stock` cache + `oplog` entry. A write that skips the oplog is a bug, full stop.
- **Stock changes are `stock_movements` inserts only.** Never UPDATE a quantity. Negative on-hand
  must be rejected in core (tested), not by the UI.
- **Renderer never touches DB/Node.** Everything crosses typed IPC validated with Zod on both sides.
- **Tax is snapshotted on lines** (regime + rate_bp + amounts). Phase 1 = IVA21 only.
- **Errors are typed codes** per the IPC contract — the UI never string-matches messages.
- **No new dependencies without asking.** No Docker. No CSS frameworks beyond Tailwind/shadcn.
- Language: UI copy Spanish-first (customer-facing), code/comments English.

## Commands
`pnpm dev` (desktop app w/ HMR) · `pnpm test` (Vitest, core) · `pnpm db:generate` / `db:migrate`
(drizzle-kit) · `pnpm db:seed` · `pnpm build:win` (installer). Keep these working at all times.

## Definition of done (every feature)
1. Domain logic in `packages/core` with Vitest cases (esp. money rounding, ledger guards).
2. IPC channel matches `docs/design/system-design.md` §4 — update the doc in the same PR if it must change.
3. Oplog entries written and visible for every mutation the feature performs.
4. Screen matches the mockup's behavior (`docs/design/mockup.html`), Spanish labels.
5. `pnpm test` green, app boots, seed flow still works.

## When unsure
Ask; don't improvise architecture. Small, reviewable commits — one feature slice each.
