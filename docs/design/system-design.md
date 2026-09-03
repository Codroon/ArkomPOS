# Arkom POS — System Design v1

Authority order: `docs/adr/` → this document → `packages/db/src/schema.ts`. Phase 1 scope:
sale screen, catalog, inventory (+ minimal add-stock), ticket printing, Ajustes-lite. Auth
arrived in v0.10.0 (ADR-0012) — §3, §4 and §4.1 below describe the guarded write path.
Used-device purchases and store credit arrived in v0.11.0 (ADR-0013) — §4.2. Repairs arrived
in v0.12.0 (ADR-0014) — §4.3. Shifts, the drawer ledger and the Z report arrive in v0.13.0
(ADR-0015) — §4.4. Reports arrive in v0.14.0 (ADR-0016) — §4.5. Sync remains
*designed* here, built later.

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
| `catalog:createGroup` | {name} → {id, name} | ADR-0017; `catalog.create`; DUPLICATE_NAME on a clash |
| `transfer:send` | {mtcn, sender, receiver, country, principal, fee, method} → {row} | ADR-0018; `transfers.create`; shift required |
| `transfer:payout` | {mtcn, …, confirmedOverDrawer?} → logged \| overDrawerWarning | ADR-0018; a warning, not a refusal |
| `transfer:list` · `transfer:get` | filters → rows | `transfers.view`; defaults to this shift |
| `transfer:cancel` | {id, reason} → {row} | `transfers.cancel`, APPROVABLE; reverses in the CURRENT shift |
| `transfer:verify` | {id, state, note?} → row | ADR-0019; `transfers.verify`; a flag needs a note |
| `transfer:bulkVerify` | {ids} → {verified} | IDs only, never a filter; skips flagged rows |
| `transfer:editMtcn` | {id, mtcn} → row | `transfers.editMtcn`; uniqueness re-checked |
| `sale:findTicket` | {query} → {docId\|null} | ADR-0019 A1; full number, prefixed or bare digits; any age or shift |
| `print:savePdf` | {docId, kind, what?, copy} → saved \| cancelled | v0.17.0; save dialog; nothing is filed per sale any more |
| `print:testDrawer` | — → {ok} | `settings.edit`; a pulse through the configured command set |
| `docs:list` | filters → rows | read-only flat list of completed documents |
| `settings:series` | — → series + regimes | DISPLAY ONLY for the series; the general rate shown is `settings.vatRateBp` (ADR-0007 A1) and is saved through `settings:save` like any setting. There is no series write channel and there must not be |
| `refund:peek` | {documentId} → lines + what is left | `sale.create` |
| `refund:create` | {documentId, reason, method, lines} → {docNumber, …} | ADR-0019; `sale.refund`, APPROVABLE; shift required |
| `supplier:list` · `supplier:create` | — | `supplier.manage`, not `inventory.receive`: a technician orders parts but may not receive stock |
| `catalog:renameGroup` | {id, name} → {id, name} | ADR-0017; `catalog.edit`; no propagation needed |
| `catalog:save` | ProductInput{…, confirmed?} → {kind:'saved', product} \| {kind:'barcodeWarning', code, conflicts[]} | full req-4 validation; barcode auto-gen if blank; duplicate **name** → typed error; duplicate **barcode** → warning payload, re-sent with `confirmed:true` (PRD 4.4 amended) |
| `catalog:codes` | {productId} → ProductCode[] | additional scannable codes on a product |
| `catalog:removal` | {id} → {kind: delete \| archive \| blocked, hasHistory, onHand} | v0.18.0; `catalog.view`; what Eliminar would DO to this row, so the confirm can say it |
| `catalog:remove` | {id} → {kind: deleted \| archived, product?} | v0.18.0; `catalog.edit`; deletes a row nothing points at, archives (`active=false`) one with history; VALIDATION while on-hand > 0; oplog `product.delete` / `product.archive` |
| `catalog:restore` | {id} → ProductRow | v0.18.0; `catalog.edit`; back onto the lists; oplog `product.restore` |
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
| `sale:complete` | {docId, tenders:[{method, amountCents, cardReference?}]} → CompletedSale | ONE tx: totals+tender revalidation (core), sale_out moves through the ledger guard, unit→sold, gap-free number alloc (ADR-0008), oplog per write; NEGATIVE_STOCK/UNIT_NOT_AVAILABLE roll back and leave the sale open  **Since v0.11.0** a tender may be `store_credit`, which must name its `voucherId`. The voucher is spent inside THIS transaction by an update matching only a row still `issued`, so a double redemption fails and rolls the whole sale back with it (ADR-0013 §4). Credit is never a document line: the goods keep their value and the taxable base is untouched. **Since 2026-08-30** a voucher may also be spent in PART (`remaining_cents` decrements, status stays `issued` until empty) or in full with the difference returned as cash — the cashier chooses when the voucher exceeds the ticket. Store credit therefore joins cash as a tender that may produce change; card, Bizum and transfer still may not |
| `sale:peek` | {docId} → TicketPeek | read-only ticket view (drawer Documento links) |
| `settings:get` | {} → Settings | Ajustes KV read; missing keys fall back to defaults (printer off, letterhead blank — no placeholder since v0.18.0) so a till that never opened Ajustes still sells |
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
| `used:checkImei` | {imei} → {ok, rejection:'format'|'duplicate_unit'|'duplicate_purchase'|null, existing:{kind:'unit'|'purchase', id, label}|null} | `usedDevices.create`. Luhn + duplicate across units AND open purchases. **No network call** (ADR-0013). `existing` carries a name or a purchase number and **never** seller data — typing IMEIs here must not become a way to read the register. A duplicate is oplogged; a mistyped IMEI is not |
| `used:log` | {device, seller, photos[]{kind,dataUrl}, buyPriceCents, payout, payoutReference?, barcode?, gateConfirmed, action:'hold'\|'inventory', sellPriceCents?} → {purchaseId, docNumber, unitId, productId, voucherId, status} | `usedDevices.create` — **which also covers the two prints that follow**, because the cashier typed the seller's details a moment ago and has to hand them something to sign (ADR-0013 §6). Re-evaluates the gate from the DATABASE; the payload's `gateConfirmed` is the human half only. ONE transaction: found-or-create used product + document + C- number (ADR-0008) + used_purchases + unit + photos + optional `tradein_in` + optional voucher + oplog. Prints run after it and cannot undo it |
| `used:list` | {state?, search?} → {rows: UsedDeviceRow[], counts} | `usedDevices.create`. Carries NO seller data at all — a list is not a place to read the register. `state` is derived from the unit, never stored, so a chip cannot disagree with the ledger. `counts` are over everything regardless of the filter, so the strip stays navigable |
| `used:get` | {purchaseId} → UsedDeviceDetail | `usedDevices.create`. The seller block AND the ID photo are withheld by the HANDLER when the session lacks `usedDevices.viewSeller` — absent from the payload, not hidden by the UI. Photos come back as data URLs: the renderer never reads the disk (§2) |
| `used:setReview` | {purchaseId, needsReview} → UsedDeviceDetail | `usedDevices.create`. A flag on the purchase, not a unit status: a device under review is still simply held, and the ledger is untouched |
| `used:setRefurbCost` | {purchaseId, refurbCostCents} → UsedDeviceDetail | `usedDevices.editRefurbCost`. Refused once the unit is in stock — the cost is already folded in |
| `used:sendToInventory` | {purchaseId, sellPriceCents} → {unitId, sellPriceCents, unitCostCents} | `usedDevices.sendToInventory`. Posts the `tradein_in` movement at buy + refurb cost, prices the unit, held→in_stock, and clears the review flag — shelving it IS the resolution. Reprints the shelf label, which now carries a price the intake label did not. Refused on a device already in stock |
| `used:findVoucher` | {search, saleTotalCents} → {rows: VoucherRow[] with `refusal`} | `usedDevices.redeemCredit`. Searches by purchase number; the seller's NAME is returned — and searchable — only with `usedDevices.viewSeller`, so the payment panel cannot become a way to read the second-hand register. Unusable vouchers are returned WITH their reason rather than hidden: "that one was spent on Tuesday" ends an argument, silence starts one |
| `used:voidVoucher` | {voucherId, reason} → {ok} | `usedDevices.voidCredit` (owner). Only from `issued`, never after redemption — voiding a spent voucher would erase a payment that happened. Reason is required and oplogged |
| `used:print` | {purchaseId, what:'document'\|'label', target:'auto'\|'pdf', copy} → PrintTicketResponse | `usedDevices.create` for both. **Loosened 2026-08-30** at the shop's request (ADR-0013 §6): a cashier who bought a phone could not reprint the slip the seller lost without fetching the owner. The consequence, accepted knowingly: a cashier can read a seller's details by printing, so the on-screen block is a courtesy and the oplog is the control — every print records who asked. With no printer configured this saves a PDF rather than failing |
| `used:peek` | {purchaseId?, documentId?} → structured purchase | `usedDevices.create`. The purchase as the SCREEN shows it — fields, not the rendered receipt — so the Documento link on a `tradein_in` movement opens the same kind of thing a sale's link opens. Printing still goes through `renderPurchaseDoc`, so what the seller signs cannot drift from what is stored |
| ~~`used:photo`~~ | — | **Dropped.** A purchase id does not exist until the purchase is logged, so a per-photo channel would have to stage files under a temp folder and clean up after every intake a cashier starts and abandons — leaked photographs of somebody ID document. Photos are resized to JPEG ≤1600px in the renderer and ride along with `used:log`, which writes them under `photos/purchases/<id>/` inside the same transaction that creates the id |
| `credit:find` | {search?} → VoucherRow[] | `usedDevices.redeemCredit`. Only `issued` vouchers |
| `credit:void` | {voucherId, reason} → VoucherRow | `usedDevices.voidCredit`. Only from `issued`; reason required and oplogged |

Typed errors: `{code: 'AUTH_REQUIRED' | 'PERMISSION_DENIED' | 'APPROVAL_REQUIRED' | 'INVALID_PIN' | 'USER_LOCKED' | 'WEAK_PIN' | 'LAST_OWNER' | 'PRINT_FAILED' | 'DUPLICATE_NAME' | 'DUPLICATE_BARCODE' | 'DUPLICATE_IMEI' | 'NEGATIVE_STOCK' | 'UNIT_NOT_AVAILABLE' | 'TENDER_MISMATCH' | 'SHIFT_REQUIRED' | 'VALIDATION' , message, field?}` — renderer maps codes to UI, never parses strings. (DUPLICATE_NAME added with the catalog slice: req 4.4 wants name and barcode duplicates distinguished per field. DUPLICATE_IMEI added with the inventory slice: req 6.1 rejects duplicate IMEIs at entry. PRINT_FAILED added with the ticket slice: the sale is already complete when it is raised, so the UI offers Reintentar/Guardar PDF rather than treating it as a write failure. The seven auth codes arrived with ADR-0012; APPROVAL_REQUIRED is the unusual one — it names the permission and is an invitation to retry with an approver's PIN, not a refusal. SHIFT_REQUIRED arrived with ADR-0015 and is the second of that kind: it means "no shift is open on this till", and the Sale screen answers it by offering to open one inline rather than by showing an error.)

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

### 4.2 Used devices (ADR-0013)

**`used_purchases`** (1:1 with a `documents` row of `doc_type = 'purchase'`): device
attributes (brand, model, storage, colour, grade, battery %, IMEI, accessory flags),
the seller block (name, phone, ID type + number, nullable address), `acquisition_channel`,
`buy_price_cents`, `payout_method` + `payout_reference`, `refurb_cost_cents`,
`needs_review`, `purchased_at`, `barcode`.
**`purchase_photos`**: purchase id · **relative** path · kind
(`front`/`back`/`extra`/`seller_id`). Files live under
`userData/photos/purchases/<purchase-id>/` — never blobs, and the backup copies the folder
alongside the database.
**`store_credit_vouchers`**: amount, `remaining_cents` (modelled, partial redemption
disabled), status `issued`/`redeemed`/`void`, purchase id, redeeming document id, void
reason.

**`units` gains** nullable `purchase_id`, `sale_price_cents` (NULL = inherit the product
price, which is every pre-v0.11 row), `grade`, `battery_pct`.

**Enums gain**, TypeScript-only because drizzle's SQLite text enums emit no CHECK:
`units.status += 'held'` and `documents.doc_type += 'purchase'`.

**"On hold" is the absence of a stock movement.** A held device has a `units` row and NO
`tradein_in` row, so on-hand is 0 and `resolveScan` — which only offers in-stock units —
never surfaces it for sale. There is no second inventory to reconcile (ADR-0004/0013 §1).
Sending it to inventory posts the movement and flips the status in one transaction.

**Store credit is a tender, never a line.** `TENDER_METHODS.store_credit` activates;
`LINE_TYPES.tradein_credit` stays deliberately unused, because a negative line would change
the document's taxable base and the printed IVA breakdown. Redemption flips the voucher
inside the sale's completion transaction under a conditional update, so a double redemption
is impossible rather than unlikely.

### 4.3 Repairs (ADR-0014)

Every channel is `guarded()`. **No channel accepts a status**: each one records a fact, and
`repairStatus()` derives the status from the facts in the same transaction (ADR-0014 §1).

| Channel | Payload → Result | Notes |
|---|---|---|
| `customer:search` | {query} → CustomerRow[] | `repair.view`. Matches name or normalized phone |
| `customer:upsert` | {id?, name, phone, note?} → CustomerRow | `repair.create`. Find-or-create deduped on `phone_normalized`; returns the existing row rather than a second one |
| `repair:create` | IntakeInput{customer, device, imei?, fault, condition, damage, accessories?, passcode?, photos[]{kind,dataUrl}, promisedDate?, promisedHalf?, depositCents?, authorizedCapCents?} → {ticketId, docNumber, customerName, depositCents} | `repair.create`. ONE transaction: `repair` document + `R-` number (ADR-0008) + `repair_tickets` + photos + optional `cash_movements` deposit + oplog. Snapshots `diagnosis_fee_cents` and `warranty_months` from settings. **The passcode is never in the oplog payload** |
| `repair:list` | {status?, technicianId?, overdueOnly?, search?} → {rows, counts} | `repair.view`. Counts are over everything regardless of filter. Carries no passcode |
| `repair:get` | {ticketId} → RepairDetail | `repair.view`. Includes the passcode (the technician needs it) — masked in the UI, absent from every print and oplog payload. `photos` are REFERENCES ({id, kind}); the images come from `repair:photos`, so a mutation that returns the whole detail does not re-ship them |
| `repair:revealPasscode` | {ticketId} → {ok} | `repair.view`. Oplogs WHO revealed it and no value; the reveal itself is the record |
| `repair:edit` | {ticketId, …fields} → RepairDetail | `repair.edit`. Device/fault/condition/promised/passcode/accessories |
| `repair:assign` | {ticketId, userId\|null} → RepairDetail | `repair.assign`. Null = *Sin asignar*, a visible state |
| `repair:addLine` | {ticketId, kind, …} → RepairDetail | `repair.parts.manage` (labor/ordered) · `repair.parts.manage` + stock effect for `inventory_part`. An inventory part posts **one `repair_part_out`** immediately, carrying the repair document id. A `part_on_order` posts nothing. Serialized products refused |
| `repair:removeLine` | {ticketId, lineId} → RepairDetail | `repair.parts.manage`. An inventory part posts the **exact reversal** — a second movement, never a delete |
| `repair:setLineCharge` | {ticketId, lineId, chargeCents, reason?} → RepairDetail | `repair.quote.set` — **or `repair.price_override`** when the change lowers a charge the customer already approved. The gate is chosen per call from the ticket's own rows, never from the payload. A reduction also requires `reason`, which rides on the oplog entry |
| `repair:recordApproval` | {ticketId, method:'in_person'\|'by_phone'} → RepairDetail | `repair.quote.approve`. Captures the CURRENT quote total as the approved total; a row, so re-approvals keep both |
| `repair:receivePart` | {ticketId, lineId, unitCostCents, qty, productId?} → RepairDetail | `repair.parts.receive` (**not** a technician default). Runs the existing stock-entry flow — find-or-create product, stock-in at real cost — then converts the line and posts its consumption. Net: one stock-in, one consumption |
| `repair:photos` | {ticketId} → {photos[]{id, kind, dataUrl}} | `repair.view`. Read once when the detail opens (slice 4) |
| `repair:partsToOrder` | {} → OrderedPartRow[] | `repair.view`. Every open ordered line across tickets, oldest first |
| `repair:markReady` | {ticketId} → RepairDetail | `repair.markReady`. Sets `ready_at`; refuses unless work is authorized and no ordered part is open |
| `repair:notify` | {ticketId, method, note?} → RepairDetail | `repair.markReady`. Appends to the notified log with the actor. **Sends nothing** — shaped so a Phase 2 cloud job can |
| `repair:collect` | {ticketId, tenders[]} → {docId, docNumber, changeCents} | `repair.collect`. Creates the collection document as `doc_type='ticket'` in the till's existing series with IVA21 snapshots (ADR-0007), the deposit as a `deposit` tender, and the same change rules as a sale. Zero remainder completes with no tender |
| `repair:markNotRepaired` | {ticketId, reason, resolutions[]{lineId, action:'return'\|'charge'}, depositAction:'refund'\|'apply_fee', chargeDiagnosisFee} → RepairDetail | `repair.markNotRepaired` (owner, **approvable**). Refuses while any consumed part is unresolved. The fee is refused unless the intake snapshot is non-zero. A refund posts a `cash_movements` row out |
| `repair:print` | {ticketId, what:'intake'\|'quote'\|'receipt'\|'return', target, copy} → PrintTicketResponse | `repair.view`. No printer ⇒ a PDF with *Abrir*, never a dead end. **No print payload contains the passcode** |
| `repair:peek` | {ticketId} → RepairPeek | `repair.view`. The ticket as the SCREEN shows it, for the Documento link on a `repair_part_out` movement in Inventario |
| `workshop:board` | {technicianId?} → {columns[]{status, cards[]}} | `workshop.view`. Cards carry number, device, fault line, technician, days in status, promised, overdue |

**Schema additions** (migration `0007`, all additive):

```
customers            id · tenant · name · phone · phone_normalized · note · created/updated
repair_tickets       id · tenant/location/terminal · document_id (1:1, doc_type='repair')
                     customer_id · device_description · imei? · reported_fault
                     condition_at_intake · damage_screen/back/dents/water · damage_note
                     device_passcode?  ← never printed, never oplogged, never logged
                     accessories? · promised_date? · promised_half?('morning'|'afternoon')
                     assigned_user_id? · deposit_cents · authorized_cap_cents?
                     diagnosis_fee_cents (snapshot) · warranty_months (snapshot)
                     ready_at? · not_repaired_at? · not_repaired_reason?
                     collection_document_id? · status (CACHE — audited against derived)
repair_lines         id · tenant · ticket_id · kind('inventory_part'|'labor'|'part_on_order')
                     product_id? · description · qty · unit_cost_cents? · charge_cents
                     supplier_text? · expected_cost_cents? · ordered_at? · received_at?
repair_approvals     id · tenant · ticket_id · method · approved_total_cents · user_id · at
repair_notifications id · tenant · ticket_id · method · note? · user_id · at
repair_photos        id · tenant · ticket_id · kind · path (relative to the photos root)
cash_movements       id · tenant/location/terminal · amount_cents (signed) · reason
                     document_id? · ticket_id? · user_id · created_at
```

`documents.doc_type += 'repair'` · `document_tenders.method += 'deposit'` — TypeScript-only,
no CHECK constraint exists. `units` is untouched: **the customer's device is never inventory**
(ADR-0014 §3). `MOVEMENT_TYPES.repair_part_out` and `LINE_TYPES.repair` were parked in the
enums from day one and are now used.

**Seam, not built:** `used_purchases.customer_id` would link a seller to a customer. Nothing
is migrated now — deciding whether two similar names are one person is the shop's call, one
at a time (ADR-0014 §11).

### 4.4 Cash, shifts and the Z report (ADR-0015)

**A shift has no status column.** `shiftStatus()` derives `open`/`closed` from `closed_at`,
and no channel accepts a status — the ADR-0014 discipline, applied to the drawer. **Sale cash
is never written into `cash_movements`**: the expected figure reads document tenders AND that
table, and copying one into the other would create two answers to "what did we take today"
(ADR-0015 §3).

| Channel | Payload → Result | Notes |
|---|---|---|
| `cash:current` | {} → ShiftState \| null | `cash.view`. The open shift on THIS till with live totals, or null. What the top-bar chip and the screen both render |
| `cash:open` | {floatCents, breakdown?} → ShiftState | `cash.open`. Refused when one is already open — and refused again by a partial unique index, which is the actual guarantee. A breakdown whose quantities do not total `floatCents` is refused |
| `cash:preview` | {} → ShiftTotals | `cash.view`. The **X**: exactly what a close now would freeze, from the same `computeShiftTotals()`. Writes no shift row, allocates no number, oplogs `shift.preview` |
| `cash:close` | {countedCents, breakdown?, reason?} → {shiftId, zDocNumber, totals} | `cash.close` — **or `cash.close_over_tolerance`** when \|counted − expected\| exceeds the tolerance setting; the gate is chosen per call, like `repair:setLineCharge`. Non-zero variance without a `reason` is refused. ONE tx: snapshot frozen + `Z1-` number (ADR-0008) + `closed_at` + oplog |
| `cash:movements` | {shiftId?} → CashMovementRow[] | `cash.view`. Defaults to the open shift. Automatic rows carry their document for the peek link; `repair_deposit_applied` rows are flagged `movesCash: false` |
| `cash:paidIn` / `cash:paidOut` | {amountCents, concept} → CashMovementRow[] | `cash.movement` — **or `cash.movement_over_threshold`** above the settings threshold, chosen per call. Amount is always positive; the channel decides the sign. Concept required |
| `cash:history` | {limit?, cursor?} → ShiftListRow[] | `cash.history` (owner, grantable). Closed shifts, newest first |
| `cash:get` | {shiftId} → ShiftDetail | `cash.history`. Returns **the stored snapshot**, never a recomputation |
| `cash:print` | {shiftId?, what:'z'\|'x', target, copy} → PrintTicketResponse | `cash.view` for the X and the current shift; `cash.history` to reprint a past Z. A reprint renders the frozen snapshot (ADR-0015 §7). No printer ⇒ a PDF, never a dead end |

**Shift preconditions.** `sale:complete`, `used:log`, `repair:collect`, `cash:paidIn` and
`cash:paidOut` are refused with `SHIFT_REQUIRED` when no shift is open on the till.
`repair:create` and `repair:markNotRepaired` require one **only on the branch that moves a
deposit**, checked inside the transaction where the branch is known. `stock:add`, catalogue
work and a depositless intake need none — and stamp the shift when one is open. A registry
test pins the list beside the permission policy.

**Schema additions** (migration `0008`, all additive):

```
shifts               id · tenant/location/terminal
                     opened_by_user_id · opened_at · opening_float_cents
                     opening_breakdown?  (JSON: {"<cents>": qty})
                     closed_by_user_id? · closed_at?      ← the ONLY status fact
                     counted_cash_cents? · closing_breakdown?
                     expected_cash_cents? · variance_cents?   (counted − expected)
                     variance_reason? · approved_by_user_id?
                     z_series_id? · z_number? · z_doc_number?  ("Z1-000007")
                     snapshot?  (JSON, frozen at close, incl. snapshotVersion)
                     created_at · updated_at
  ux_shift_open_per_terminal  UNIQUE (terminal_id) WHERE closed_at IS NULL
  ux_shift_z_number           UNIQUE (z_series_id, z_number)
  ix_shift_terminal_opened    (terminal_id, opened_at)

cash_movements  +=   shift_id?   (NULL = pre-shift, ADR-0010's convention)
                     concept?    (free text; the "why" for a manual row)
```

`documents.shift_id` **already exists** and was nullable from day one (ADR-0010) — no column
is added there, only stamped. `CASH_MOVEMENT_REASONS += 'paid_in' | 'paid_out'` and
`DOC_TYPES += 'shift'` (for the `Z1-` series row) are TypeScript-only: drizzle's SQLite text
enums emit no CHECK. Old rows keep `shift_id = NULL` and **nothing is backfilled** — inventing
which shift a July sale belonged to would be fiction.

**Behaviour change on an existing path:** a used-device **cash** payout is written into
`cash_movements` inside the `used:log` transaction, instead of by the idempotent startup
fix-up. The fix-up stays for historic rows and still skips anything already recorded, so the
two cannot double-post (ADR-0015 §6).

**New settings keys:** `cashDefaultFloatCents` · `cashVarianceToleranceCents` (default 300) ·
`cashMovementApprovalCents` · `cashConcepts` (string[]).

**Seam, not built:** the Reports screen (nav 10). A Z snapshot is a frozen, numbered summary
of a period and is its natural source; `snapshotVersion` exists so a future reader knows which
fields it may rely on. Nothing else is designed for it now.

### 4.5 Reports (ADR-0016)

**Read-only, completed documents only, dated by `completed_at`.** No report reads
a draft or a parked sale, and none of them writes anything — the only write this
slice adds is the cost snapshot below, on paths that already log.

**Aggregation is SQL in main.** Each channel returns rows already in the shape the
table renders; the renderer never sums money (§2). Cost-bearing fields are
**omitted from the response** for a caller without `reports.costs`, never sent for
the UI to hide.

| Channel | Payload → Result | Notes |
|---|---|---|
| `reports:hub` | {} → {sales, repairs, used, valuation, deadStock} | `reports.view`. Five headline aggregates in one call, run on every hub open. Cost-bearing headlines are null without `reports.costs` |
| `reports:sales` | {from, to, shiftId?, groupBy} → {summary, rows, estimated} | `reports.view`. `groupBy`: day \| group \| product \| user \| method. Cost/margin columns and the `estimated` block only with `reports.costs`. Filtered to one shift, it must equal that shift's Z snapshot |
| `reports:salesDetail` | {from, to, shiftId?, key, kind} → {rows} | `reports.view`. The drill-down: a day's or a user's tickets, or a product's lines |
| `reports:repairsOpen` | {status?, technicianId?} → {summary, rows} | `reports.view`. A position — no dates |
| `reports:repairsClosed` | {from, to, byTechnician} → {summary, rows, notRepaired[]} | **`reports.costs`** — it is a margin report |
| `reports:used` | {status?, grade?} → {summary, rows, storeCredit} | `reports.costs`. Oldest first |
| `reports:valuation` | {groupId?} → {totalCents, groups[], products[]} | `reports.costs`. The total must equal the Inventario header to the cent |
| `reports:deadStock` | {groupId?} → {rows, thresholdDays} | `reports.costs`. Threshold from settings, not from the payload |
| `reports:export` | {report, filters, suggestedName} → {kind:'saved', path} \| {kind:'cancelled'} | The report's OWN permission. Re-runs the same query rather than serialising the renderer's rows, and writes UTF-8-BOM · `;` · decimal comma · dd/mm/yyyy · CRLF through a save dialog |

**Schema addition** (migration `0009`, additive):

```
document_lines  +=  unit_cost_cents?   NULL = written before v0.14.0 (ADR-0016 §2)

  ix_doc_status_completed  (status, completed_at)   -- the reports' hot path
  ix_line_doc               (document_id)            -- line joins per document
```

`unit_cost_cents` is written when the line is created — the same moment price
and tax are snapshotted — from `units.cost_cents` (serialized and used),
`products.cost_cents` (stocked) or the repair part's own snapshot. **Nullable on purpose:** `NOT NULL DEFAULT 0` would
report every pre-v0.14.0 sale as pure profit, and nothing is backfilled — a NULL
reports the product's current cost, flagged `estimated`, and the flag is the
point.

**New settings key:** `deadStockDays` (default 90).
**New permissions:** `reports.view` · `reports.costs`, both owner-only, grantable.

**Seam, not built:** margin on **sold** used devices, which needs purchase +
refurbishment + sale joined across three modules. `cost_cents` on a used unit's
sale line is the input it will want, and this slice puts it there.

## 5. Screen ↔ data (Phase 1)

- **Catalog** = `catalog:list` + save form (`catalog:save`). Missing-data chips from NULL columns.
- **Inventory** = `inventory:list` + drawer with `inventory:movements` + Add-stock modal (`stock:add`).
- **Sale** = local Zustand cart mirrored to draft document via `sale:*`; scan box always focused; groups grid from `productGroups`; completion runs the big transaction; ticket prints.
- **Login / Lock / Approval** = `auth:*` only; no business data crosses until a session exists.
- **Usuarios** = `users:*`, gated on `users.manage`; override toggles render from the core registry, so a new permission key appears with no UI change.
- **Comprar usados / Dispositivos usados** = `used:*` + `credit:*`. Selling a used phone reuses the ordinary serialized-unit path — no new sale code (ADR-0013).
- **Caja** = `cash:*` only. The top-bar chip and the Sale screen's inline open both read
  `cash:current`; the X preview and the close call the same core computation, so the number on
  screen and the number on the Z cannot diverge (ADR-0015 §12).
- **Informes** = `reports:*` only, and read-only. Drill-downs reuse the existing
  peeks rather than growing report-shaped copies of them.
- **Reparaciones / Taller** = `repair:*` + `customer:*` + `workshop:board`. The board and the list render DERIVED status (ADR-0014); collection reuses the ordinary document + tender path, so repairs add no second way to take money.

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
