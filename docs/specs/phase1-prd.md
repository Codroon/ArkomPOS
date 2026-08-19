# Arkom POS — Phase 1 PRD (Sale · Catálogo · Inventario)

Status: Approved for build · Owner: Zothix (Codroon) · Client: Ahmer (mobile shop, Spain)
Companions: `docs/adr/` (decisions) · `docs/design/system-design.md` (how) ·
`docs/design/handoff/` (screens) · timeline one-pager (when). This PRD defines **what "done" means**.
Requirement numbers (2.x–6.x, 25.x) reference the client requirements document verbatim.

## Problem statement
The shop runs sales, stock and pricing on memory, paper and a generic till that can't model
its real business (serialized phones, strict stock discipline, Spanish fiscal rules coming).
Phase 1 replaces the core loop — sell, know your stock, keep an honest ledger — on a till that
never depends on the internet, and lays a foundation the rest of Arkom POS (repairs, used
devices, agency, cloud) bolts onto without rework.

## Goals
1. A cashier completes a normal sale (scan → tender → printed ticket) start-to-finish on the till, offline, in under 30 seconds.
2. Stock is trustworthy: every quantity is movement-derived, negative stock is impossible, every change has a visible history entry.
3. Serialized phones sell by IMEI with per-unit tracking from stock entry to sale.
4. Every mutation lands in the oplog with before/after — audit-grade from day 1, sync-ready for Phase 2.
5. A clean Windows installer + seed demo Ahmer can be walked through at the end of week 2.

## Non-goals (Phase 1)
Auth/login/shifts (ADR-0010) · refunds/voids/credit notes · full invoices with customer fiscal data ·
card-terminal SDK integration (standalone reference mode instead) · sync + web dashboard (designed, not built) ·
repairs/used-device/trade-in/agency/SIM modules · bulk sheet stock upload · stock counts ·
data migration of client's real catalog (go-live task, after acceptance) · multi-language output (ES only; CA later).
Each exists in schema/enums where cheap (ADR-0007/0009) but gets zero UI.

## User stories (cashier = the only P1 persona)
- As a cashier, I scan a barcode and the line appears instantly so the queue keeps moving.
- As a cashier, I sell a specific phone by picking its IMEI so we always know which unit left.
- As a cashier, I take payment split across cash/card/Bizum/transfer so real-world payments fit one ticket.
- As a cashier, I change a price only with a reason, and it's logged, so pricing stays controlled.
- As a cashier, I park a sale and recover it later so one browsing customer doesn't block the till.
- As a cashier, I register incoming stock by scan (or IMEI for phones) with cost and supplier so inventory stays true.
- As the owner, I see quantities, low-stock flags, valuation and per-item movement history so I trust the numbers without counting the shelf.

## Requirements & acceptance criteria

### P0 — Sale (req 2)
- [ ] **2.1** Scan/search input focused on screen load and re-focuses after every action; scanner input works with no prior click; ≥8-digit fast entry treated as barcode.
- [ ] **2.2** Product grid grouped by the five seed groups; group chips filter; card tap adds a line.
- [ ] **2.3** (P1 subset) `product` vs `serialized_unit` lines visually distinct per handoff; other line types cannot be created.
- [ ] **2.4** No price editing inline; "Modificar precio" requires a reason; result shows original price + reason on the line; oplog entry `sale_line.price_override` with before/after. Discount button rendered locked.
- [ ] **2.5** (P1 subset) Split tender across Efectivo/Tarjeta/Bizum/Transferencia; non-cash tenders cannot exceed amount due (TENDER_MISMATCH); cash over-tender computes change; Cobrar disabled until tenders cover total.
- [ ] **2.6–2.7 deferred** Card tender requires a reference (≥4 chars) typed from the standalone terminal; sale cannot complete with an empty card reference.
- [ ] **2.8** (P1 subset) Park with optional label; parked list with count; resume restores exact lines/tenders; parked drafts survive app restart. Refund/Void rendered locked.
- [ ] **2.9** (P1 subset) Completing a sale allocates the next gap-free number in the till's ticket series and prints a simplified ticket (ESC/POS; PDF fallback) showing shop data, doc number, lines, IVA breakdown, tenders, change. Reprint available.
- [ ] Completion is one transaction: stock movements + unit status + number + oplog; a mid-completion crash leaves either a draft or a completed sale — never a half state (kill-test).
- [ ] Selling beyond on-hand or a non-available unit is blocked with NEGATIVE_STOCK / UNIT_NOT_AVAILABLE; the sale stays open.

### P0 — Catálogo (req 3, 4)
- [ ] **3.1** List shows barcode, name, group, cost, PVP, IVA, stock, type; stock read-only here.
- [ ] **3.2** Filters: group, item type, low stock, missing data; combinable; search by name/code.
- [ ] **3.3** Rows missing cost/price/tax/group/barcode are visually flagged per field and surfaced by the missing-data filter.
- [ ] **4.1** Save blocked unless cost, PVP, IVA and group are set (Zod, field-level messages).
- [ ] **4.2** Barcode field accepts scanner input; "Generar" creates a valid internal EAN-13 when empty.
- [ ] **4.3** (P1 subset) Type selectable: Stock / Serializado; remaining types visible-disabled. Serializado→Stock and Stock→Serializado blocked once stock/units exist (typed error).
- [ ] **4.4** Duplicate name or barcode within tenant rejected server-side with field-level error.
- [ ] **4.5** Reorder point and low-stock threshold editable, integers ≥0, drive Inventario flags.
- [ ] Products with movements can't be deleted — only deactivated; inactive products can't be sold or receive stock but keep history.

### P0 — Inventario + Entrada (req 5, 6)
- [ ] **5.1** No quantity is editable anywhere on the screen; quantities equal Σ movements (property-tested in core).
- [ ] **5.2** Table shows qty, reorder point, BAJO MÍNIMO flag (qty ≤ reorder; a reorder point of 0 means "not tracked" and never flags — otherwise every untracked zero-stock row would drown the filter), unit cost, valuation; header shows total valuation and below-min count.
- [ ] **5.3** No operation can drive on-hand below zero — enforced in `packages/core`, covered by tests, UI merely reports the typed error.
- [ ] **5.4** Per-item drawer lists every movement: date, type, signed qty, cost, linked document number, user ("—" pre-auth); newest first; paginated.
- [ ] **6.1** Entry by barcode scan; serialized products switch to IMEI capture, qty locked to 1, duplicate IMEI rejected.
- [ ] **6.2** Unit cost required per entry line.
- [ ] **6.3** Supplier required per entry (inline create allowed).
- [ ] **6.5** Cost rule = **last cost**: a confirmed entry updates the product's cost; valuation uses current cost (weighted average parked as configurable, P2 — confirm with Ahmer).
- [ ] Confirm posts all lines in one transaction; list and valuation update without reload; oplog entries per movement.
- [ ] **6.4 deferred** (sheet upload) · **6.6** honored by omission (no purchasing module).

### P0 — Cross-cutting (req 25 subset, ADRs)
- [ ] **25.2** (pre-auth form) Every create/update/complete/park/override/entry writes an oplog row with entity, action, before/after JSON, terminal, timestamp; a dev screen or script can dump the oplog for verification.
- [ ] **25.3** (P1 subset) Gated-with-reason: price override, and any manual stock adjustment path if exposed.
- [ ] All money integer cents end-to-end; displayed Spanish-format; totals = Σ line totals exactly (rounding tests per ADR-0006).
- [ ] Runs fully offline; kill-and-restart during any flow loses at most the un-submitted form state.
- [ ] Windows installer (electron-builder) installs on a clean Win10/11 machine; `pnpm db:seed` produces the demo dataset from system-design §8.

### P1 (should-have, only if the week allows)
- [ ] Scan-miss on Venta offers "Crear artículo" prefilled with the code.
- [ ] Row flash on inventory changes; parked-sale labels; reprint from a simple completed-sales peek list.

### P2 (architectural insurance — build nothing, break nothing)
Shifts & users slot into nullable columns (ADR-0010) · REBU/EXEMPT regimes are enum values awaiting UI (ADR-0007) ·
fiscal-chain columns reserved · sync reads the oplog as-is (ADR-0005) · store-credit tender exists in enum.

## Success metrics (evaluated at the week-2 demo)
Leading: scripted demo (12 sales incl. 2 serialized, 1 park/resume, 1 override, 3 stock entries) runs with zero manual DB fixes; scan→line P95 < 100 ms on shop-grade hardware; core suite green with ledger/rounding/gating property tests; installer-to-first-sale < 5 minutes.
Lagging (post go-live, Phase 2 territory): zero stock discrepancies attributable to the POS in month 1; cashier abandons the old till voluntarily.

## Open questions
1. **Ahmer (blocking for go-live, not for build):** shop fiscal data for the ticket footer (name, NIF, address) + logo; which receipt printer & scanner models are on the counter (ESC/POS interface: USB/network?).
2. **Ahmer (non-blocking):** confirm last-cost rule (6.5) over weighted average; confirm ticket series prefix (`T1-`).
3. **Ahmer (Phase 2, ask now):** shop's region — standard AEAT (Verifactu) vs Basque (TicketBAI) — decides the fiscal module.
4. **Internal (non-blocking):** printer library behavior on the client's exact model — PDF fallback is the safety net.

## Timeline
Per the approved two-week one-pager: D1–2 foundations · D3–4 catálogo · D5 inventario · D6 entrada ·
D7–8 venta · D9 ticket+audit · D10 hardening/installer/demo. Serialized selling is the designated
cut-to-buffer item if D7–8 overruns (PRD ACs 2.3/6.1-IMEI move to the buffer day, nothing else moves).
