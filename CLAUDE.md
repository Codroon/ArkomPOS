# CLAUDE.md — Arkom POS

Operating instructions for Claude Code in this repo. Read before writing anything.

## Authority order (conflicts resolve upward)
1. `docs/adr/` — frozen decisions. Do not relitigate. Changing one = new superseding ADR, ask first.
2. `docs/design/system-design.md` — boundaries, write path, IPC contract.
3. `packages/db/src/schema.ts` — the schema. Column changes only via drizzle migration + ADR check.
4. This file.

## What we are building right now (Phase 1 only)
Desktop till (Electron): **Sale**, **Catalog**, **Inventory (+ minimal add-stock)**, **Ajustes-lite**
(printer + paper + command set + the shop's legal block) and **Usuarios** (nav 11 and 12).
Since v0.10.0 the till has PIN login, roles and per-action approval (ADR-0012).
Ticket printing is in: ESC/POS through the Windows RAW spooler, PDF fallback, reprints stamped COPIA.
Since v0.11.0 the till buys used devices: gate, purchase document, shelf label, store credit (ADR-0013).
NOT yet: shifts/float/Z report, refunds/voids, full invoices, card-terminal SDK, sync, web app,
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
- **Every IPC handler declares a permission.** Register through `guarded()`, `authed()` or
  `open()` — never `ipcMain.handle` directly. The open allow-list is short and a test pins it.
- **Permission checks live in main, never only in the renderer.** `useCan()` and `<Guarded>`
  hide buttons as a courtesy; the guard is the control. `mutate()` stamps the actor from the
  SESSION, never from anything the payload carries (ADR-0012).
- **No PIN in a log line, an oplog payload, or an error message** — including "wrong PIN"
  errors, which carry attempts remaining and nothing else. Hashes never leave the main process.
- **Photographs are files, paths are rows.** Device and ID photos live under
  `userData/photos/purchases/<id>/` as resized JPEGs; the database stores a path
  relative to that root. Never a blob — it defeats the backup design (ADR-0013).
- **Store credit is a tender, never a line.** A voucher pays for a sale the way
  cash does; putting it on the document as a negative line corrupts the taxable
  base and the printed IVA breakdown.
- **Brand tokens only.** Colours and faces come from `packages/ui/src/styles/tokens.css` by
  meaning (`canvas`, `ink`, `accent`, `warning-bg`…). No raw hex in components. Signal Blue lands
  on exactly **one** element per screen — the primary action. **White-on-blue is banned** (text on
  blue is always `accent-ink`, Graphite 900); **blue body text on Bone is banned**. See handoff 00.
- **No new dependencies without asking.** No Docker. No CSS frameworks beyond Tailwind/shadcn.
- Language: UI copy Spanish-first, code/comments English. All renderer strings live in the
  typed dictionary (`packages/ui/src/i18n`, `es.ts` = source of truth, `en.ts` must satisfy
  its key map) and render via `useT()` — never hardcoded (ADR-0011). The UI locale toggle is
  staff-only: printed tickets/documents always render fixed Spanish strings, never `useT()`.

## Commands
`pnpm dev` (desktop app w/ HMR) · `pnpm test` (Vitest, core) · `pnpm db:generate` / `db:migrate`
(drizzle-kit) · `pnpm db:seed` · `pnpm db:audit [--verify]` · `pnpm build:win` (installer).
Keep these working at all times. A CLIENT install runs none of them: it migrates on first
launch and asks the shop who it is (see DEPLOYMENT.md). `db:seed` is a dev convenience that
calls the same createShop()/insertDemoData() first run uses — keep it that way.

## Definition of done (every feature)
1. Domain logic in `packages/core` with Vitest cases (esp. money rounding, ledger guards).
2. IPC channel matches `docs/design/system-design.md` §4 — update the doc in the same PR if it must change.
3. Oplog entries written and visible for every mutation the feature performs.
4. Screen matches the mockup's behavior (`docs/design/mockup.html`), Spanish labels.
5. `pnpm test` green, app boots, seed flow still works.

## When unsure
Ask; don't improvise architecture. Small, reviewable commits — one feature slice each.
