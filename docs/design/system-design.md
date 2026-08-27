# Arkom POS — System Design v1

Authority order: `docs/adr/` → this document → `packages/db/src/schema.ts`. Phase 1 scope:
sale screen, catalog, inventory (+ minimal add-stock), ticket printing, Ajustes-lite. Auth
arrived in v0.10.0 (ADR-0012) — §3, §4 and §4.1 below describe the guarded write path.
Shifts and sync remain *designed* here, built later.

## 1. Component map

    ┌────────────────────────── shop PC ──────────────────────────┐      ┌───────── cloud ─────────┐
    │  apps/desktop (Electron)                                    │      │  apps/web (Next.js)     │
    │  ┌ renderer (React) ┐   typed IPC    ┌ main (Node) ┐        │      │  dashboard pages        │
    │  │ screens, Zustand │ ◄────────────► │ handlers    │        │HTTPS │  /api/sync/push (P2)    │
    │  │ shadcn/ui        │   Zod-checked  │ @arkom/core │ ─sync──┼─────►│  Drizzle → Supabase PG  │
    │  └──────────────────┘                │ Drizzle→SQLite       │ (P2) │  Supabase Auth (P2)     │
    │            hardware: scanner(kbd) · ESC/POS printer         │      └─────────────────────────┘
    └─────────────────────────────────────────────────────────────┘

## 2. Monorepo boundaries

| Package | Owns | Never contains |
|---|---|---|
| `packages/core` | Domain: money/rounding, tax snapshot, totals, ledger rules (negative-stock guard, sign-vs-type), number allocation, `mutate()` envelope, all Zod schemas, UUIDv7 | React, Electron, SQL, fetch |
| `packages/db` | Drizzle table definitions + migrations (SQLite now, PG mirror in P2) | Business rules |
| `packages/ui` | Shared presentational components/tokens | Data access |
| `apps/desktop/main` | IPC handlers, repositories (Drizzle calls), printer, updater | Business math (calls core) |
| `apps/desktop/renderer` | Screens, stores, forms | Direct DB/Node access |
| `apps/web` | Dashboard + sync endpoint (P2) | Till-only logic |

Dependency rule: `apps/* → packages/*`; `core` imports nothing from apps; `db` imports only drizzle.

## 3. The write path (the one pattern everything uses)

Renderer → `ipc.invoke(channel, payload)` → **guard: session + permission** →
main handler → **Zod parse** → `core` builds the mutation plan → **one SQLite transaction**:
business rows + `product_stock` cache + `oplog` entry → typed result back.

- No renderer ever touches the DB. No handler computes money or stock math — that lives in core.
- Every mutation goes through `mutate()` so the oplog before/after envelope is impossible to skip (ADR-0005).
- Gap-free numbers allocated inside the same transaction at completion (ADR-0008).
- **Every handler is registered through `handle(channel, permission, fn)`** and receives the
  session as its first argument (ADR-0012). No session ⇒ `AUTH_REQUIRED`; session without the
  permission ⇒ `PERMISSION_DENIED`. Both are decided in main — a hidden button is convenience,
  never the control.
- **`mutate()` stamps `user_id` from the session, never from the payload.** A renderer that
  sends a `userId` cannot influence what the oplog records.
- An `approvable` permission the caller lacks raises `APPROVAL_REQUIRED`; the renderer retries
  the same call with an owner's PIN alongside the payload, and the action runs in that one call
  with **both** `user_id` and `authorized_by_user_id` stamped.

## 4. IPC contract v1 (all payloads/results are Zod schemas in `core/ipc.ts`)

| Channel | Request → Response | Notes |
|---|---|---|
| `catalog:list` | filters{search?, groupId?, itemType?, lowStockOnly?, missingDataOnly?} → ProductRow[] | flags derived from NULLs (req 3.3) |
| `catalog:get` | {id} → ProductDetail | |
| `catalog:groups` | {} → {id, name}[] | editor group select; venta group grid reuses it |
| `catalog:save` | ProductInput{…, confirmed?} → {kind:'saved', product} \| {kind:'barcodeWarning', code, conflicts[]} | full req-4 validation; barcode auto-gen if blank; duplicate **name** → typed error; duplicate **barcode** → warning payload, re-sent with `confirmed:true` (PRD 4.4 amended) |
| `catalog:codes` | {productId} → ProductCode[] | additional scannable codes on a product |
| `catalog:addCode` | {productId, code, confirmed?} → {kind:'added', codes[]} \| {kind:'sharedWarning', code, conflicts[]} | attaching a code already on other products warns first; oplog `product_code.create` |
| `catalog:removeCode` | {productId, codeId} → ProductCode[] | oplog `product_code.delete` |
| `scan:resolve` | {code} → {kind:'product', product, matchedVia} \| {kind:'unit', unit, product} \| {kind:'ambiguous', code, matches[]} \| {kind:'none', code, unavailableUnit?} | THE scan entry point for sale and stock entry: primary barcodes ∪ product_codes ∪ in-stock unit IMEIs. Ambiguity is expected (one EAN can sit on sibling variants) — the UI shows a picker, the domain never guesses. `unavailableUnit` explains a near-miss (a known IMEI whose phone is sold/reserved) so the UI does not offer to create a product for it. Catalog search reaches the same codes through `catalog:list`, which matches name ∪ barcode ∪ product_codes |
| `inventory:list` | filters{search?, groupId?, itemType?, lowStockOnly?} → InventoryRow[] (onHand, reorder, lowStock, valuation) | reads `product_stock` cache; serialized valuation = Σ in-stock unit costs |
| `inventory:movements` | {productId, cursor?} → {rows: MovementRow[], nextCursor} | req 5.4 history; keyset cursor = movement id (UUIDv7 time-ordered), newest first |
| `stock:add` | {entries:[{barcode\|productId, unitCostCents, supplierId, **qty** (stocked) \| **expectedQty + imeis[]** (serialized)}]} → {lineCount, productIds} | purchase_in; a serialized line brings in `expectedQty` units in ONE line and is rejected unless `imeis.length === expectedQty` (req 6.1); each IMEI creates a unit + its own +1 movement; applies last-cost (6.5); one oplog row per movement |
| `supplier:list` | {} → {id, name}[] | entrada supplier select (req 6.3) |
| `supplier:create` | {name} → {id, name} | inline create from entrada; duplicate → DUPLICATE_NAME |
| `sale:current` | {} → SaleState \| null | the terminal's live draft (boot restore / power-cut). Drafts are created LAZILY by the first addLine — no empty-draft rows; `sale:new` was folded into this. |
| `sale:addLine` | {docId?, barcode\|productId\|unitId, qty?} → {kind:'state', state} \| {kind:'unitPick', units[]} | scan text resolves barcode→product, else direct IMEI→unit; serialized product ⇒ unitPick payload for the modal; picking (unitId) reserves the unit |
| `sale:setQty` | {docId, lineId, qty} → SaleState | ticket stepper; serialized lines locked at 1 |
| `sale:overridePrice` | {docId, lineId, newPriceCents, reason} → SaleState | gated, oplog'd (req 2.4) |
| `sale:removeLine` | {docId, lineId} → SaleState | releases unit reservations |
| `sale:park` / `sale:resume` / `sale:listParked` | park {docId, label?} → {docId, parkedLabel} · resume {docId} → SaleState (auto-parks a non-empty current draft) · list {} → [{docId, label, lineCount, totalCents, createdAtMs}] | req 2.8; parked keeps units reserved |
| `sale:complete` | {docId, tenders:[{method, amountCents, cardReference?}]} → CompletedSale | ONE tx: totals+tender revalidation (core), sale_out moves through the ledger guard, unit→sold, gap-free number alloc (ADR-0008), oplog per write; NEGATIVE_STOCK/UNIT_NOT_AVAILABLE roll back and leave the sale open |
| `sale:peek` | {docId} → TicketPeek | read-only ticket view (drawer Documento links) |
| `settings:get` | {} → Settings | Ajustes KV read; missing keys fall back to defaults (printer off, shop data `PENDIENTE`) so a till that never opened Ajustes still sells |
| `settings:save` | Partial\<Settings\> → Settings | one oplog row per changed key (`setting.create`/`setting.update`); a patch that changes nothing writes nothing |
| `print:printers` | {} → {name, displayName}[] | OS printer list for the Ajustes dropdown. No "is default" flag — Electron 37 dropped it from PrinterInfo and the replacement is platform-specific |
| `print:ticket` | {docId, copy?, target?:'auto'\|'pdf'} → {kind:'printed', printer} \| {kind:'pdf', path} | `auto` = the configured printer, else **PRINT_FAILED**; `pdf` = always a file under `userData/tickets`. `copy` stamps COPIA and withholds the drawer pulse. Every attempt writes `document.print` to the oplog with its target and outcome. A print failure NEVER rolls back the sale |
| `print:test` | {target?:'auto'\|'pdf'} → same union as `print:ticket` | "Imprimir prueba": a sample ticket, not a document — consumes no ticket number, logged as `printer.test` |
| `meta:context` | {} → {tenant, location, terminal} | injected config · **unguarded** (the Login screen needs the shop name) |
| `auth:login` | {userId, pin} → SessionInfo | **unguarded.** Wrong PIN ⇒ `INVALID_PIN` with attempts remaining; locked ⇒ `USER_LOCKED` with the unlock time. Never echoes the PIN |
| `auth:session` | {} → SessionInfo | null | **unguarded.** What the renderer boots against; also pushed on every session change |
| `auth:logout` | {} → {ok} | auto-parks an open cart with a note naming the outgoing user |
| `auth:lock` / `auth:unlock` | lock {} → {ok} · unlock {pin} → SessionInfo | unlock accepts only the **current** user's PIN; the session and cart survive |
| `auth:activity` | {} → void | throttled idle-timer ping from the renderer |
| `auth:recover` | {userId, code, newPin} → {recoveryCode} | **unguarded.** Owners only; returns a fresh code, invalidates the old |
| `users:list` | {} → UserRow[] | `users.manage`. Includes inactive; never returns a hash |
| `users:create` | {name, role, pin, overrides} → UserRow | `users.manage`. Weak PIN ⇒ `WEAK_PIN` |
| `users:update` | {id, name?, role?, overrides?, active?} → UserRow | `users.manage`. Last active owner ⇒ `LAST_OWNER` |
| `users:resetPin` | {id, newPin, currentPin?} → {ok} | `users.manage`. `currentPin` required when changing your own |

Typed errors: `{code: 'AUTH_REQUIRED' | 'PERMISSION_DENIED' | 'APPROVAL_REQUIRED' | 'INVALID_PIN' | 'USER_LOCKED' | 'WEAK_PIN' | 'LAST_OWNER' | 'PRINT_FAILED' | 'DUPLICATE_NAME' | 'DUPLICATE_BARCODE' | 'DUPLICATE_IMEI' | 'NEGATIVE_STOCK' | 'UNIT_NOT_AVAILABLE' | 'TENDER_MISMATCH' | 'VALIDATION' , message, field?}` — renderer maps codes to UI, never parses strings. (DUPLICATE_NAME added with the catalog slice: req 4.4 wants name and barcode duplicates distinguished per field. DUPLICATE_IMEI added with the inventory slice: req 6.1 rejects duplicate IMEIs at entry. PRINT_FAILED added with the ticket slice: the sale is already complete when it is raised, so the UI offers Reintentar/Guardar PDF rather than treating it as a write failure. The seven auth codes arrived with ADR-0012; APPROVAL_REQUIRED is the unusual one — it names the permission and is an invitation to retry with an approver's PIN, not a refusal.)

### 4.1 Users and permissions (ADR-0012)

`users`: UUIDv7 `id` · tenant/location/terminal keys · `name` · `role` (text, Zod-validated in
code, **no CHECK constraint** so a new role is not a migration) · `pin_hash` · `pin_salt` ·
`permission_overrides` (JSON key→boolean) · `active` · `failed_attempts` · `locked_until` ·
`recovery_code_hash` (owners, nullable) · `created_at` · `updated_at`.

`oplog` gains nullable `authorized_by_user_id` beside `user_id`. Auth events (login, logout,
lock, unlock, failed attempt, lockout, PIN reset, approval granted/denied) are oplog entries —
no second logging system (ADR-0005).

Permissions are a typed registry in `packages/core`: `{ key, module, labelEs, approvable }`
plus role defaults, in one file. Effective = role defaults merged with the user's overrides;
the owner role cannot be reduced. `can(user, key, ctx?)` carries `ctx` from day one, unused
now, for future resource-level rules ("a technician may only edit repairs assigned to them")
that must not require editing call sites.

Users are **deactivated, never deleted** — history references them.

## 5. Screen ↔ data (Phase 1)

- **Catalog** = `catalog:list` + save form (`catalog:save`). Missing-data chips from NULL columns.
- **Inventory** = `inventory:list` + drawer with `inventory:movements` + Add-stock modal (`stock:add`).
- **Sale** = local Zustand cart mirrored to draft document via `sale:*`; scan box always focused; groups grid from `productGroups`; completion runs the big transaction; ticket prints.
- **Login / Lock / Approval** = `auth:*` only; no business data crosses until a session exists.
- **Usuarios** = `users:*`, gated on `users.manage`; override toggles render from the core registry, so a new permission key appears with no UI change.

## 6. Sync (designed now, built Phase 2)

`POST /api/sync/push` `{terminalId, entries: OplogEntry[≤500]}` → `{ackSeq}`.
Cloud upserts by `opId` (idempotent), applies entity payloads into PG, returns highest
contiguous seq. Till timer: flush when online && seq > lastAcked. Failure = retry same
batch; duplicates are no-ops. Down-sync deliberately out of v1 (ADR-0001).

## 7. Non-functionals & failure notes

- Scan→line P95 < 50 ms (synchronous better-sqlite3; no awaits in hot path).
- Power cut mid-sale: WAL + single-tx completion ⇒ draft survives, never a half-completed sale.
- Printer offline: sale still completes; ticket re-printable; PDF fallback.
- Volume assumption: ≤ ~500 sales/day/shop — SQLite headroom for years.

## 8. Seed data (dev + demo)

Tenant "Arkom Demo", location "Tienda", terminal "Till 1" + ticket series `T1-`;
groups: Moviles, Protector, Cargador y Cable, Auriculares, Memoria y Ordenador;
~29 products across groups (incl. 4 serialized phone models + example units w/ IMEIs),
2 suppliers; opening `purchase_in` movements so inventory is non-empty on first run.

Fixtures the manual walkthrough (`TESTING.md`) depends on — keep them in step with it:
- **Apple iPhone 17 Pro Max 256GB Negro** — serialized, realistic box EAN `0194253172567`,
  **5 in-stock units** of the identical model/colour/storage, told apart only by IMEI.
- **Protector iPhone 15 Pro Max** / **Protector iPhone 16 Pro Max** — sibling accessories,
  each with its own distinct box EAN and opening stock. They start with NO shared code:
  the walkthrough attaches one deliberately to exercise the warning and the picker.
Products may carry an explicit real barcode; the rest fall back to our internal series.

## 9. Revisit as it grows

Batched oplog pruning · Postgres RLS at tenant #2 · dedicated sync service if Vercel
limits bite · down-sync for web-edited catalog · CHECK constraints promoted from
migration SQL into schema when drizzle-kit supports them cleanly.
