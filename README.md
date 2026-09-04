# Arkom POS

An offline-first Windows point-of-sale for a mobile phone shop in Spain: sell
phones by IMEI and accessories by quantity, keep stock honest, print a legal
ticket. A cloud dashboard is planned for Phase 2 — the till is built so that
syncing to it later needs no rewrite. Built by [Codroon](https://codroon.com).

**The till runs completely offline.** No account, no server, no internet. The
shop's data lives in one SQLite file on the counter PC.

---

## Current state — v1.0.1 · 4 September 2026

Phase 1 is complete and packaged. Verified on a clean Windows machine end to
end, with one exception noted below.

### Built

| Area | What works |
|---|---|
| **Sale** | Scan or tap, mixed tickets, serialized units picked by IMEI, price override with reason, park/resume, split tender (cash · card · Bizum · transfer), change, gap-free per-till numbering |
| **Catalog** | Products in four types (stock, serialized, used, repair — a used article sells under the margin scheme), groups the shop creates itself, multiple scannable codes per product, incomplete-data flags, Eliminar that deletes a row nothing points at and archives one with history (reversible from the Archived filter) |
| **Inventory** | Insert-only stock ledger, receiving drawer with per-IMEI entry, movement history, low-stock and reorder points |
| **Tickets** | ESC/POS over the Windows RAW spooler, branded PDF fallback for anything a person asks to print, reprints stamped COPIA, cash-drawer pulse. A till with no printer configured refuses to charge rather than selling without a ticket |
| **Ajustes** | A card per subject: the shop's full letterhead, taxes (the general rate is a setting, the regimes and series stay read-only), printer + paper + command set + drawer and scanner tests, the till's own limits, repairs, used devices, reports, backups |
| **Documentos** | Every completed document in one read-only list — filter by type and date, search by number, any row opens the standard peek with Reprint and Save PDF |
| **Backups** | Nightly + on close via SQLite's online backup API, each one verified, last 14 kept, optional second destination |
| **First run** | Fresh install asks the shop who it is, then migrates and starts — no seed step on a client machine |
| **Audit** | `db:audit --verify` checks every invariant the design rests on |
| **Diagnostics** | A boot log in `%TEMP%\arkom-boot.log` names the last step main reached, so a launch that fails before the app's own logger still says where |
| **Auth** | PIN login with roles, per-action owner approval with dual attribution, idle lock, per-user permission overrides, owner recovery code |
| **Used devices** | Buy over the counter behind an offline IMEI gate, photos, printed purchase document with a signature line, shelf label, hold or shelve, refurbishment cost, and a register of every device bought |
| **Store credit** | Paying a seller in credit issues a voucher; it pays for a later sale as a tender, redeemed inside that sale's transaction so it cannot be spent twice |
| **Repairs** | Intake with damage marks, photos and a signed deposit receipt; quote with per-line margin; approval bound to an amount; parts from stock or on order with goods-received; a workshop board; collection onto a normal fiscal ticket with the deposit applied as a tender; and closing a ticket unrepaired with every consumed part resolved first |
| **Reports** | Five reports on the data the till already holds — sales and tax by day, group, item, user or payment method with margin; repairs open and closed with turnaround; used devices held with cost tied up; inventory valuation that equals the Inventario header to the cent; and dead stock. Every one exports a CSV a Spanish Excel opens on a double-click |
| **Cash** | A shift per till with a counted float, one expected-cash figure derived from the tenders and the drawer ledger, an X preview that is exactly what a close would freeze, cash paid in and out with approval over a threshold, and a close that freezes an immutable numbered Z with the variance, its reason and its approver. Both reports open on screen in the staff language; printing them is a choice, and the second copy of a Z is stamped |

### Not built yet

Refunds and voids · full invoices (tickets only) · margin on SOLD used devices
(a real report needing purchase, refurbishment and sale joined; the sale line now
carries the cost it will want) · card-terminal SDK
integration (references are typed in) · sync and the web dashboard · transfers,
agency and SIM sales · reopening a closed shift, which is deliberate rather than
missing · the refurbishment pipeline and the second-hand police-register export
(the data for it is captured at intake).

Dragging a card between columns on the workshop board is not built either: the
honest version runs the same guard as the ficha's buttons, so a card opens its
ficha rather than pretending to move.

The schema already anticipates all of these — tenancy keys,
document types — so they extend rather than replace what is here. A new role or
module is an edit to the permission registry, not a migration (ADR-0012).

### Known gaps

- **The thermal printer has never touched paper.** The ESC/POS path is written
  and its byte delivery is verified against the Windows spooler, but no Citizen
  CT-S310S has printed from it. That happens at the shop visit. The PDF path is
  fully working and is how tickets are checked today.
- **The installer is unsigned**, so Windows SmartScreen shows a warning. See
  [DEPLOYMENT.md](DEPLOYMENT.md) §2.

---

## Architecture

An Electron desktop app over a local SQLite database. The renderer never touches
the database, Node, or the filesystem — everything crosses a typed IPC bridge
validated with Zod **on both sides**. All business logic lives in a
framework-free core package that knows nothing about Electron or SQL, which is
what makes it testable and what will let the Phase-2 cloud reuse it unchanged.

Every write goes through one envelope, `mutate()`, which wraps the business rows
and their audit entries in a single transaction. A write that records nothing in
the audit log throws — skipping the trail is impossible by construction rather
than by discipline.

### Layout

| Package | What it is | May depend on |
|---|---|---|
| `apps/desktop` | The Electron till: main process, IPC handlers, repositories, screens | everything |
| `apps/web` | Next.js placeholder for the Phase-2 dashboard | `core`, `ui` |
| `packages/core` | Domain logic, money, IDs, the IPC contract, the ticket renderer. **No SQL, no Electron, no React** | nothing |
| `packages/db` | Drizzle schema, client, migrations. **Only drizzle** | nothing |
| `packages/ui` | Design tokens, vendored fonts, shared components, the i18n dictionary | nothing |

**The dependency rule:** packages never import from apps, and never from each
other except `ui`/`db` → nothing. Apps compose packages. If core needs a
database, it takes a function as an argument instead.

### Stack

Electron 37 · React 19 · TypeScript · Vite / electron-vite · Tailwind 4 ·
Zustand · Drizzle ORM · better-sqlite3 (WAL) · Zod · Vitest · electron-builder ·
node-thermal-printer · pnpm workspaces

---

## Getting started

**Prerequisites:** Windows 10/11 · Node ≥ 20.19 · pnpm 11.22 · a C++ toolchain
for `better-sqlite3` (Visual Studio Build Tools, or just install and let the
prebuilt binary do the work).

```bash
pnpm install          # postinstall rebuilds better-sqlite3 for Electron's ABI
pnpm db:migrate       # create/upgrade the dev database at .data/arkom-pos.db
pnpm db:seed          # 29 sample products, stock, IMEI units — dev only
pnpm dev              # launch the till with HMR
```

| Command | What it does |
|---|---|
| `pnpm dev` | Run the desktop app with hot reload |
| `pnpm test` | Vitest: `packages/core` + the main-process guard and approval tests (224) |
| `pnpm -r typecheck` | Typecheck every package |
| `pnpm db:generate` | Generate a migration after editing `schema.ts` |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Fill a dev database (thin wrapper over the same code first run uses) |
| `pnpm db:stats` | Row counts per table |
| `pnpm db:audit` | Read the audit trail — `--entity`, `--action`, `--since`, `--diff` |
| `pnpm db:audit --verify` | Check every invariant; exits non-zero on any failure |
| `pnpm imei:gen` | Generate valid test IMEIs (Luhn check digit) |
| `pnpm build:win` | Build the NSIS installer into `apps/desktop/release/` |

A **client install runs none of these.** It migrates on first launch and asks
the shop who it is. `db:seed` is a developer convenience.

> Point the dev database somewhere else with `ARKOM_DB_PATH`. Useful for
> testing first-run against an empty file.

---

## Documentation

Read in roughly this order.

| Document | Read it for |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The house rules and the authority order. **Start here.** |
| [`docs/adr/`](docs/adr/) | The twelve frozen decisions and why. Changing one needs a superseding ADR |
| [`docs/design/system-design.md`](docs/design/system-design.md) | Boundaries, the write path, and the full IPC contract (§4) |
| [`docs/specs/phase1-prd.md`](docs/specs/phase1-prd.md) | What Phase 1 promised, requirement by requirement, with what is still owed by the client |
| [`docs/specs/auth-slice.md`](docs/specs/auth-slice.md) | The v0.10.0 auth slice, acceptance criteria A1–K3 |
| [`docs/specs/used-devices-slice.md`](docs/specs/used-devices-slice.md) | The v0.11.0 used-devices slice, acceptance criteria U1–B3 |
| [`docs/specs/repairs-slice.md`](docs/specs/repairs-slice.md) | The v0.12.0 repairs slice, acceptance criteria R1–B3 |
| [`docs/design/handoff/`](docs/design/handoff/) | Per-screen specs: foundations (brand tokens, the one-blue rule), sale, catalog, inventory, auth |
| [`TESTING.md`](TESTING.md) | Manual walkthroughs in plain Spanish/English, for the owner to drive |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Installing on the shop PC, printer and scanner setup, backups, restore, the shop-visit checklist |

---

## Conventions that matter

Break one of these and something is quietly wrong rather than loudly broken.

| Rule | Why |
|---|---|
| **Money is integer cents.** Never floats, never strings in logic | Formatting happens once, at the UI and print edge |
| **IDs are UUIDv7** from `@arkom/core` | Time-ordered, so they double as pagination cursors. Never `Math.random`, never autoincrement |
| **Every write goes through `mutate()`** and lands in the oplog | One transaction: business rows + stock cache + audit entries. A build that logs nothing throws |
| **Stock changes are `stock_movements` inserts only** | Never UPDATE a quantity. On-hand is a derived cache; negative stock is rejected in core, not the UI |
| **Tax is snapshotted on each line** (regime + rate + amounts) | A ticket must still be readable after the VAT rate changes. Phase 1 is IVA21 only |
| **Ticket numbers are per-till and gap-free** | Allocated inside the completion transaction. The prefix is permanent once selling starts |
| **Errors are typed codes** | The renderer maps codes to its own strings and never parses messages |
| **Brand tokens only** — no raw hex in components | Signal Blue lands on exactly one element per screen. **White-on-blue is banned**, and so is blue body text on Bone |
| **Every IPC handler declares a permission** | Checks live in main; a hidden button is a courtesy, never the control. `mutate()` stamps the actor from the session, never the payload |
| **No PIN in logs, payloads or errors** | Not even in "wrong PIN" messages, which carry attempts remaining and nothing else |
| **Spanish first**, via the typed dictionary | `es.ts` is the source of truth; `en.ts` must satisfy the same key map or typecheck fails. Printed tickets are always Spanish regardless of the UI toggle |

---

© Codroon. Not currently licensed for redistribution.
