# Arkom POS

Offline-first point of sale for a retail mobile shop in Spain. The till is an
Electron desktop app that never depends on the internet: sales, catalog and
stock all run against a local SQLite file, every mutation is written to an
append-only audit log, and document numbers are allocated gap-free on the till
itself. A cloud dashboard and sync layer are designed (see `docs/`) and land in
Phase 2 — the schema and oplog already anticipate them.

**Stack:** pnpm workspaces · Electron + Vite + React + TypeScript · Tailwind 4 ·
Zod-validated typed IPC · Drizzle ORM + better-sqlite3 (WAL) · Vitest.
All architectural decisions are frozen as ADRs in [`docs/adr/`](docs/adr/).

## Running it

Requirements: **Node ≥ 20.19** (developed on Node 24) and **pnpm ≥ 10**
(`npm i -g pnpm`). Primary target platform is Windows.

```bash
pnpm install    # native build scripts are pre-approved in pnpm-workspace.yaml
pnpm db:seed    # creates + migrates .data/arkom-pos.db and loads the demo dataset
pnpm dev        # boots the till with hot reload
```

The demo dataset is a small phone shop: 5 product groups, 26 products
(3 serialized phone models with IMEI-tracked units), 2 suppliers and opening
stock. The UI is Spanish by default; the **ES · EN** chip in the top bar
switches the interface language (staff-only — printed documents will always be
Spanish, per ADR-0011).

| Command | What it does |
|---|---|
| `pnpm dev` | run the desktop till (HMR) |
| `pnpm test` | Vitest suite for the domain layer (`packages/core`) |
| `pnpm typecheck` | `tsc --noEmit` across every package |
| `pnpm db:seed` | migrate + seed the local dev database (idempotent) |
| `pnpm db:generate` / `db:migrate` / `db:stats` | drizzle migrations & quick row counts |
| `pnpm build:win` | Windows installer via electron-builder *(not yet exercised — Day 10)* |
| `pnpm dev:web` | Next.js cloud dashboard placeholder (Phase 2) |

Notes for a fresh clone:
- Database scripts run under **Electron's Node** automatically (better-sqlite3
  is compiled for Electron's ABI). If the native module ever complains after a
  dependency change: `pnpm --filter @arkom/desktop exec electron-builder install-app-deps`.
- `pnpm dev` goes through a small wrapper that strips `ELECTRON_RUN_AS_NODE`
  from the environment — some shells (VS Code tasks) leak it and it breaks
  Electron startup.
- The dev database lives in `.data/` (gitignored). Delete it and re-run
  `pnpm db:seed` for a clean slate.

## What's done (Phase 1, Days 1–8)

**Foundations**
- pnpm monorepo per the system design: `packages/core` (pure domain logic),
  `packages/db` (schema + migrations), `packages/ui` (design tokens +
  primitives), `apps/desktop` (Electron till), `apps/web` (Phase-2 placeholder).
- Every write goes through a single `mutate()` envelope: one SQLite
  transaction = business rows + stock cache + oplog entries with before/after
  JSON. Skipping the audit log is impossible by construction.
- Money is integer cents end-to-end; IDs are UUIDv7; typed error codes cross
  the IPC bridge (the UI never string-matches messages).
- Typed ES/EN dictionary — a missing translation fails the type check.

**Venta (sale screen)**
- Scan-first flow: barcode fast-entry, direct IMEI scan adds that exact unit,
  unknown codes offer "create item" prefilled into the catalog.
- Product grid with group chips; serialized products open an IMEI pick modal
  and reserve the chosen unit.
- Ticket panel: quantity stepper (serialized locked at 1), price override
  gated behind a required reason (audited), server-computed totals only.
- Payment: split tenders across cash / card / Bizum / transfer; change only
  from cash over-tender; card payments require the standalone terminal
  reference; completion is a single transaction that posts stock movements,
  marks units sold, allocates the gap-free ticket number (`T1-000123`) and
  writes the audit rows. Failed completions roll back cleanly and never
  consume a number.
- Park / resume with labels; parked tickets survive restarts. A hard app kill
  mid-draft restores the exact ticket on relaunch (power-cut behavior, tested).
- Keyboard: F2 search · F4 charge · F8 park.

**Catálogo (catalog screen)**
- List with search + combinable filters (group, type, low stock, missing
  data); per-field "FALTA" flags on incomplete rows.
- Editor with full validation (cost, price, VAT, group required), barcode
  generation (valid internal EAN-13), duplicate name/barcode rejected with
  field-level errors, item-type switch blocked once stock or units exist,
  deactivation via the Activo switch (delete is intentionally locked).

**Inventario (inventory screen)**
- Live quantities from the movement ledger (nothing is ever edited in place),
  total valuation at cost, below-minimum flags and filter.
- Per-item movement history drawer (type, signed qty, cost, linked ticket
  number with a read-only ticket peek, paginated).
- Stock entry panel: scan to receive, serialized products switch to
  one-row-per-IMEI capture with duplicate rejection, supplier select with
  inline create, last-cost rule applied on confirm, single-transaction post.

## Testing

`pnpm test` runs **110 Vitest cases** over the domain layer, including:
- money rounding against hand-computed values (IVA-inclusive PVP, half-up
  base/VAT split) plus a reconstruction sweep (`base + tax ≡ total`),
- a property-style ledger suite: 300 randomized multi-product batch sequences
  asserting on-hand ≡ Σ movements, with the negative-stock guard rejecting
  exactly at the boundary,
- tender math (split payments, change, non-cash over-tender rejection, card
  reference rules) and gap-free number allocation across 250 chained calls,
- the `mutate()` envelope (no-oplog writes throw; rollbacks leave nothing),
  EAN-13 / IMEI check-digit math, UUIDv7 format & monotonicity, typed-error
  round-trips.

Beyond unit tests, every screen flow has been driven end-to-end against the
real running app (scan → unit pick → override → split tender → completion →
audit trail), including the mid-draft kill/restore test. There is no automated
E2E suite yet — see below.

## What's remaining

**Phase 1 (to finish the two-week scope)**
- **Day 9 — printing & audit:** ESC/POS ticket printing with PDF fallback
  (auto-print on completion, reprint; fixed Spanish strings regardless of the
  UI language toggle — the "Imprimir ticket" button is currently rendered
  locked), and a small script/dev screen to dump the oplog for verification.
- **Day 10 — hardening & delivery:** exercise `pnpm build:win`, verify the
  installer on a clean Windows machine, seed-to-first-sale walkthrough, and the
  scripted demo (12 sales incl. serialized, park/resume, override, stock
  entries).
- **Testing debt:** an automated end-to-end harness for the flows currently
  verified manually, and repository-level tests against a real SQLite file
  (the completion transaction, reservation lifecycle).

**Phase 2 (designed, deliberately not built)**
- Oplog-based sync to Postgres/Supabase and the Next.js cloud dashboard.
- Auth, users & shifts; refunds/voids as credit notes; full invoices and the
  Spanish fiscal module (Verifactu/TicketBAI); card-terminal integration;
  repairs, used devices, trade-ins, agency services and SIM/top-up modules —
  the schema and enums already reserve space for all of these.

## Repository map

```
docs/adr/            frozen architecture decisions (ADR-0001 … ADR-0011)
docs/design/         system design (boundaries, write path, IPC contract) + UI handoffs + mockup
docs/specs/          Phase-1 PRD with acceptance criteria
packages/core        domain: money, tax, ledger, sale, numbering, ids, IPC schemas (all tested)
packages/db          drizzle schema + migrations + SQLite client
packages/ui          design tokens, shared components, ES/EN dictionary
apps/desktop         Electron till (main = IPC handlers/repositories, renderer = screens)
apps/web             Phase-2 dashboard placeholder
```
