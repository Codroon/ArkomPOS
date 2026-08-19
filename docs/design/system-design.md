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
| `catalog:save` | ProductInput → ProductRow | full req-4 validation; barcode auto-gen if blank; duplicate name/barcode → typed error |
| `inventory:list` | filters → InventoryRow[] (onHand, reorder, lowStock, valuation) | reads `product_stock` cache |
| `inventory:movements` | {productId, cursor?} → MovementRow[] | req 5.4 history |
| `stock:add` | {entries:[{barcode\|productId, qty, unitCostCents, supplierId, imei?}]} → AddResult | purchase_in; IMEI creates unit (serialized) |
| `sale:new` | {} → SaleDraft | draft document |
| `sale:addLine` | {docId, barcode\|productId\|unitId, qty?} → SaleState | serialized ⇒ unit picked & reserved |
| `sale:overridePrice` | {docId, lineId, newPriceCents, reason} → SaleState | gated, oplog'd (req 2.4) |
| `sale:removeLine` | {docId, lineId} → SaleState | |
| `sale:park` / `sale:resume` / `sale:listParked` | … | req 2.8 |
| `sale:complete` | {docId, tenders:[{method, amountCents, cardReference?}]} → CompletedSale | tx: totals check, sale_out moves, unit→sold, number alloc, oplog |
| `print:ticket` | {docId} → {ok} \| {pdfPath} | ESC/POS, PDF fallback |
| `meta:context` | {} → {tenant, location, terminal} | injected config |

Typed errors: `{code: 'DUPLICATE_NAME' | 'DUPLICATE_BARCODE' | 'NEGATIVE_STOCK' | 'UNIT_NOT_AVAILABLE' | 'TENDER_MISMATCH' | 'VALIDATION' , message, field?}` — renderer maps codes to UI, never parses strings. (DUPLICATE_NAME added with the catalog slice: req 4.4 wants name and barcode duplicates distinguished per field.)

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
