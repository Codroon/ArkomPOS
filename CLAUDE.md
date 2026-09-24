# CLAUDE.md — Codroon POS

Operating instructions for Claude Code in this repo. Read before writing anything.

## Authority order (conflicts resolve upward)
1. `docs/adr/` — frozen decisions. Do not relitigate. Changing one = new superseding ADR, ask first.
2. `docs/design/system-design.md` — boundaries, write path, IPC contract.
3. `packages/db/src/schema.ts` — the schema. Column changes only via drizzle migration + ADR check.
4. This file.

## What we are building right now (Phase 1 only)
Desktop till (Electron): **Sale**, **Catalog**, **Inventory (+ minimal add-stock)**, **Ajustes-lite**
(printer + paper + command set + the shop's legal block), **Usuarios**, **Comprar usados** +
**Dispositivos usados**, **Reparaciones** + **Taller**, **Caja**, and since
v0.14.0 **Informes** (nav 01–07 and 09–12).
Since v0.10.0 the till has PIN login, roles and per-action approval (ADR-0012).
Ticket printing is in: ESC/POS through the Windows RAW spooler, PDF fallback, reprints stamped COPIA.
Since v0.11.0 the till buys used devices: gate, purchase document, shelf label, store credit (ADR-0013).
Since v0.12.0 the till repairs devices: intake, quote, approval, parts, board, collection (ADR-0014).
Since v0.13.0 the till has shifts: float, drawer ledger, X preview, close with variance, Z report (ADR-0015).
Since v0.14.0 the till reports: sales/tax, repairs, used holding, valuation, dead stock, CSV export (ADR-0016).
Since v0.18.1 the counter refuses to charge with no printer configured (`PRINTER_REQUIRED`).
**v1.0.0 is the release the shop runs.** Since v1.1.0 the product is **Codroon POS**
(pos.codroon.com): the wordmark on every printed document is the SHOP's own name, never
ours, and the till can enrol with the cloud (ADR-0020) — Ajustes → Nube pastes a code, gets
a device token, and a background loop pushes the oplog up. The push never blocks the
counter, the cursor moves only on an ack, and device passcodes, PIN material and the
photographs never leave the shop.
Since v0.18.2 first run is a four-step wizard (language → shop → owner + recovery code →
printer, skippable) and the landing screen carries a fact-driven, dismissible checklist
(`setup:checklist`). `pnpm fresh` archives this machine's dev data and reopens onboarding.
Since v1.2.0 a till can be **linked to the cloud** (ADR-0020): the owner pastes an enrolment
code in Ajustes → Nube, the till holds a device token in `userData/cloud-link.json` — never a
table, because every row is pushed to the service the token authenticates — and a background
timer pushes oplog rows up only. `apps/web` is the other half: `POST /api/enrol`,
`POST /api/sync`, Supabase Postgres in the EU. **The cloud is a read model with one door and
it never writes back.** Nothing in a screen, a sale or a shutdown awaits the network.
Since v0.18.0 the till is handover-clean: the general VAT rate is a SETTING read at snapshot time
(ADR-0007 A1), Eliminar deletes a row nothing points at and archives one with history, a Used-type
article can be typed in and sells REBU, an installed build never sees the demo dataset.
NOT yet: refunds/voids, full invoices, card-terminal SDK, down-sync, the dashboard and its
projections, the landing page and payment, transfers/agency/SIM
screens, margin on SOLD used devices, the refurbishment pipeline, the police-register export.
Schema already anticipates them — build nothing for them.

## Hard rules
- **Money is integer cents. Never floats. Never strings in logic.** Formatting only at UI/print edge.
- **IDs are UUIDv7** from `@arkom/core`. Never `Math.random`, never autoincrement business ids.
- **Every write goes through `mutate()` in core** → one SQLite transaction: business rows +
  `product_stock` cache + `oplog` entry. A write that skips the oplog is a bug, full stop.
- **Stock changes are `stock_movements` inserts only.** Never UPDATE a quantity. Negative on-hand
  must be rejected in core (tested), not by the UI.
- **Renderer never touches DB/Node.** Everything crosses typed IPC validated with Zod on both sides.
- **Tax is snapshotted on lines** (regime + rate_bp + amounts). Phase 1 = the general rate — a
  setting, `vatRateBp`, read when the line is written, never a constant (ADR-0007 A1) — plus REBU
  for used articles. The regime follows the item type; nothing else picks it.
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
  base and the printed IVA breakdown. **A repair deposit is a tender too**, for
  the same reason (ADR-0014 §7).
- **A repair's status is derived, never assigned.** `repairStatus()` computes it
  from the ticket's own facts and `syncStatus()` is the only writer of the
  column — there is no `setStatus`, and no channel accepts a status. Where a
  status would change, the UI offers the action that records the fact.
  `db:audit` asserts stored equals derived, the same way it does for the stock
  cache (ADR-0014 §1).
- **A printed document derives from recorded facts, the same way a status does —
  and its type must be unable to express a claim the facts do not support.**
  A doc type carries no field the shop could fill in with a wish: the intake
  receipt has no passcode field at all, and an approval carries the amount it was
  given for, so no caller can stamp APROBADO over a total nobody agreed to. Where
  a loader could get it wrong, move the constraint into the type — a document is
  evidence, and evidence a caller can shape is not evidence.
- **A repair part leaves the shelf when it is FITTED**, not at hand-back — the
  on-hand figure has to be right for every day the phone sits in the workshop.
  Removing the line posts the exact reversal as a second movement (ADR-0004).
  Collection moves no stock at all.
- **Revenue for a repair lands on the collection ticket and nowhere earlier.**
  The `R-` document is a record of custody with a zero total; the `T1-` created
  at hand-back is the invoice.
- **The device passcode is redacted like a PIN.** Never printed on any document,
  never in an oplog payload (the entry records `hasPasscode`, and an *update*
  strips it from BOTH halves), never in a list, board or peek. It reaches the
  ficha because the technician has to open the phone, and it is masked there;
  revealing it writes an oplog entry naming who looked and no value. Phase 2
  sync must exclude or encrypt the column (ADR-0014 §10).
- **Sale cash never enters `cash_movements`.** Takings are `document_tenders` rows on a
  completed document and are READ from there; the ledger holds only what has no other home —
  deposits, refunds, used-device payouts, manual paid-in/out. One fact stored twice is a
  reconciliation bug waiting for the first path that forgets to write the copy, and the
  drawer would then have two answers with nothing to say which is right (ADR-0015 §3).
- **A closed shift is immutable.** No reopening, no editing, no deleting; a reprint renders
  the FROZEN Z snapshot and never a recomputation. A miscount found tomorrow is a movement in
  tomorrow's shift with a reason naming the Z it corrects. Correcting by editing the record
  destroys the evidence that there was anything to correct (ADR-0015 §7–8).
- **Anything that hands a person paper needs a printer.** `sale:complete`, `refund:create`,
  `repair:collect`, `repair:create` and `used:log` raise `PRINTER_REQUIRED` when Ajustes names
  none (`PRINTER_REQUIRED_CHANNELS`, checked in `guarded()` beside the shift gate, before the
  handler runs — nothing is written and rolled back). A ticket, a refund, a repair invoice, the
  custody receipt for a phone left behind and the purchase document a seller signs are all the
  shop's evidence of what was agreed. This is about CONFIGURATION: a printer that is configured
  and then jams raises `PRINT_FAILED` *after* the document exists and the sale stands. NOT
  blocked, deliberately: `cash:close` (the Z is internal, reprints from its snapshot, and a
  stuck close strands the day), drawer paid-in/out, transfers (WU prints its own), receiving
  stock. `meta:context.printerConfigured` lets those screens say so before the work starts.
- **Money needs an open shift, and the refusal is an invitation.** Any action that creates a
  fiscal document or moves notes raises `SHIFT_REQUIRED` when none is open; the Sale screen
  answers it with the open dialog and re-runs the charge. Receiving stock and a depositless
  repair intake need no shift, and stamp one if it exists.
- **Reports read COMPLETED documents, dated by `completed_at`, and never write.**
  A draft is a ticket somebody is still building and a parked sale is one nobody
  has paid for; `created_at` answers "when did someone start typing", which is not
  a question anybody asks about money. Aggregation is SQL in main returning shaped
  rows — summing in the renderer would be a second implementation of the money
  (ADR-0016 §1, §3). The CSV export's words follow the staff language and its
  Excel format does not (ADR-0016 A1).
- **Cost is snapshotted on the sale line, exactly as tax is.**
  `document_lines.unit_cost_cents` is written at completion from the same figure
  the stock movement records. Joining `products.cost_cents` at report time would
  make last month's margin move when this month's delivery arrives at a different
  price. A NULL means "before v0.14.0": reports fall back to the current cost and
  say so on screen and in the export, never silently (ADR-0016 §2).
- **Nothing in the till ever waits on the cloud, and the cloud never writes back.** The push
  is a background timer; `pushOnce()` does not throw, records its failure and is awaited by
  no screen. A batch is redacted by `redactForSync()` BEFORE it is queued — a device
  passcode, a PIN hash or a recovery hash on the wire has already left the shop. The cursor
  moves only on a parsed ack, and what the cloud acks is what it stored, never the cursor it
  remembers (ADR-0020).
- **Two identities, never merged (ADR-0021).** A cloud login (Supabase Auth) proves a
  browser belongs to an account; a PIN proves the person at the counter is Ana. The join is
  `users.cloud_user_id`, nullable — a link that grants nothing in either direction, because
  ADR-0012 froze the till's PIN as the only authority the till consults. The **till owns the
  shop's fiscal identity** (legal name, NIF, address, series); the website owns the account.
  Codroon's admin console reads shop HEALTH only — no sale, total, customer or `sync_entries`
  row — and support access needs a `support_grants` row naming who, which shop, why and until
  when. Staff is a separate table, never a role an account could grant itself.
- **The cloud stores digests, not secrets, and `seq` is an ordering, not an identity.**
  A device token and an enrolment code exist in the clear exactly once, on the way to the
  person or till that uses them. `sync_entries` is keyed by `(tenant_id, op_id)` — keying it
  by `seq` would make a restored till's next batch a poison pill. Ingest rules live in
  `apps/web/src/sync/` as pure functions over a store interface, so they are tested without a
  Postgres; anything that must be ATOMIC lives in `pg-store.ts` as one statement.
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
`pnpm dev` (desktop app w/ HMR) · `pnpm test` (Vitest: core, desktop, web) · `pnpm db:generate`
/ `db:migrate` (drizzle-kit) · `pnpm db:seed` · `pnpm db:audit [--verify]` · `pnpm build:win`
(installer) · `pnpm dev:web` (the cloud). Cloud-only, from `apps/web`: `db:generate` /
`db:migrate` (its own Postgres lineage, never the till's), `cloud:code` (issue an enrolment
code), `cloud:delete-tenant` (ADR-0020 §4). See `apps/web/README.md`.
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
