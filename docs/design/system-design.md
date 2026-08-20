# Arkom POS — System Design v1

Authority order: `docs/adr/` → this document → `packages/db/src/schema.ts`. Phase 1 scope:
sale screen, catalog, inventory (+ minimal add-stock), no auth, no sync build (sync is
*designed* here, built in Phase 2).

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

Renderer → `ipc.invoke(channel, payload)` → main handler → **Zod parse** →
`core` builds the mutation plan → **one SQLite transaction**:
business rows + `product_stock` cache + `oplog` entry → typed result back.

- No renderer ever touches the DB. No handler computes money or stock math — that lives in core.
- Every mutation goes through `mutate()` so the oplog before/after envelope is impossible to skip (ADR-0005).
- Gap-free numbers allocated inside the same transaction at completion (ADR-0008).

## 4. IPC contract v1 (all payloads/results are Zod schemas in `core/ipc.ts`)

| Channel | Request → Response | Notes |
|---|---|---|
| `catalog:list` | filters{search?, groupId?, itemType?, lowStockOnly?, missingDataOnly?} → ProductRow[] | flags derived from NULLs (req 3.3) |
| `catalog:get` | {id} → ProductDetail | |
| `catalog:groups` | {} → {id, name}[] | editor group select; venta group grid reuses it |
| `catalog:save` | ProductInput → ProductRow | full req-4 validation; barcode auto-gen if blank; duplicate name/barcode → typed error |
| `inventory:list` | filters{search?, groupId?, itemType?, lowStockOnly?} → InventoryRow[] (onHand, reorder, lowStock, valuation) | reads `product_stock` cache; serialized valuation = Σ in-stock unit costs |
| `inventory:movements` | {productId, cursor?} → {rows: MovementRow[], nextCursor} | req 5.4 history; keyset cursor = movement id (UUIDv7 time-ordered), newest first |
| `stock:add` | {entries:[{barcode\|productId, qty, unitCostCents, supplierId, imei?}]} → {lineCount, productIds} | purchase_in; IMEI creates unit (serialized, qty 1); applies last-cost (6.5); one oplog row per movement |
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
| `print:ticket` | {docId} → {ok} \| {pdfPath} | ESC/POS, PDF fallback |
| `meta:context` | {} → {tenant, location, terminal} | injected config |

Typed errors: `{code: 'DUPLICATE_NAME' | 'DUPLICATE_BARCODE' | 'DUPLICATE_IMEI' | 'NEGATIVE_STOCK' | 'UNIT_NOT_AVAILABLE' | 'TENDER_MISMATCH' | 'VALIDATION' , message, field?}` — renderer maps codes to UI, never parses strings. (DUPLICATE_NAME added with the catalog slice: req 4.4 wants name and barcode duplicates distinguished per field. DUPLICATE_IMEI added with the inventory slice: req 6.1 rejects duplicate IMEIs at entry.)

## 5. Screen ↔ data (Phase 1)

- **Catalog** = `catalog:list` + save form (`catalog:save`). Missing-data chips from NULL columns.
- **Inventory** = `inventory:list` + drawer with `inventory:movements` + Add-stock modal (`stock:add`).
- **Sale** = local Zustand cart mirrored to draft document via `sale:*`; scan box always focused; groups grid from `productGroups`; completion runs the big transaction; ticket prints.

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
~25 products across groups (incl. 3 serialized phone models + example units w/ IMEIs),
2 suppliers; opening `purchase_in` movements so inventory is non-empty on first run.

## 9. Revisit as it grows

Batched oplog pruning · Postgres RLS at tenant #2 · dedicated sync service if Vercel
limits bite · down-sync for web-edited catalog · CHECK constraints promoted from
migration SQL into schema when drizzle-kit supports them cleanly.
