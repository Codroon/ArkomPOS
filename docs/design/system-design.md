# Arkom POS — System Design v1

Authority order: `docs/adr/` → this document → `packages/db/src/schema.ts`. Phase 1 scope:
sale screen, catalog, inventory (+ minimal add-stock), ticket printing, Ajustes-lite. Auth
arrived in v0.10.0 (ADR-0012) — §3, §4 and §4.1 below describe the guarded write path.
Used-device purchases and store credit arrived in v0.11.0 (ADR-0013) — §4.2. Shifts and
sync remain *designed* here, built later.

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
| `sale:complete` | {docId, tenders:[{method, amountCents, cardReference?}]} → CompletedSale | ONE tx: totals+tender revalidation (core), sale_out moves through the ledger guard, unit→sold, gap-free number alloc (ADR-0008), oplog per write; NEGATIVE_STOCK/UNIT_NOT_AVAILABLE roll back and leave the sale open  **Since v0.11.0** a tender may be `store_credit`, which must name its `voucherId`. The voucher is spent inside THIS transaction by an update matching only a row still `issued`, so a double redemption fails and rolls the whole sale back with it (ADR-0013 §4). Credit is never a document line: the goods keep their value and the taxable base is untouched. **Since 2026-08-30** a voucher may also be spent in PART (`remaining_cents` decrements, status stays `issued` until empty) or in full with the difference returned as cash — the cashier chooses when the voucher exceeds the ticket. Store credit therefore joins cash as a tender that may produce change; card, Bizum and transfer still may not |
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
| `repair:create` | IntakeInput{customer, device, imei?, fault, condition, damage, accessories?, passcode?, photos[]{kind,dataUrl}, promisedDate?, promisedHalf?, depositCents?, authorizedCapCents?} → {ticketId, docNumber} | `repair.create`. ONE transaction: `repair` document + `R-` number (ADR-0008) + `repair_tickets` + photos + optional `cash_movements` deposit + oplog. Snapshots `diagnosis_fee_cents` and `warranty_months` from settings. **The passcode is never in the oplog payload** |
| `repair:list` | {status?, technicianId?, overdueOnly?, search?} → {rows, counts} | `repair.view`. Counts are over everything regardless of filter. Carries no passcode |
| `repair:get` | {ticketId} → RepairDetail | `repair.view`. Includes the passcode (the technician needs it) — masked in the UI, absent from every print and oplog payload |
| `repair:revealPasscode` | {ticketId} → {ok} | `repair.view`. Oplogs WHO revealed it and no value; the reveal itself is the record |
| `repair:edit` | {ticketId, …fields} → RepairDetail | `repair.edit`. Device/fault/condition/promised/passcode/accessories |
| `repair:assign` | {ticketId, userId\|null} → RepairDetail | `repair.assign`. Null = *Sin asignar*, a visible state |
| `repair:addLine` | {ticketId, kind, …} → RepairDetail | `repair.parts.manage` (labor/ordered) · `repair.parts.manage` + stock effect for `inventory_part`. An inventory part posts **one `repair_part_out`** immediately, carrying the repair document id. A `part_on_order` posts nothing. Serialized products refused |
| `repair:removeLine` | {ticketId, lineId} → RepairDetail | `repair.parts.manage`. An inventory part posts the **exact reversal** — a second movement, never a delete |
| `repair:setLineCharge` | {ticketId, lineId, chargeCents} → RepairDetail | `repair.quote.set`. Cost stays snapshotted; only the charge moves |
| `repair:recordApproval` | {ticketId, method:'in_person'\|'by_phone'} → RepairDetail | `repair.quote.approve`. Captures the CURRENT quote total as the approved total; a row, so re-approvals keep both |
| `repair:receivePart` | {ticketId, lineId, unitCostCents, qty} → RepairDetail | `repair.parts.receive` (**not** a technician default). Runs the existing stock-entry flow — find-or-create product, stock-in at real cost — then converts the line and posts its consumption. Net: one stock-in, one consumption |
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

## 5. Screen ↔ data (Phase 1)

- **Catalog** = `catalog:list` + save form (`catalog:save`). Missing-data chips from NULL columns.
- **Inventory** = `inventory:list` + drawer with `inventory:movements` + Add-stock modal (`stock:add`).
- **Sale** = local Zustand cart mirrored to draft document via `sale:*`; scan box always focused; groups grid from `productGroups`; completion runs the big transaction; ticket prints.
- **Login / Lock / Approval** = `auth:*` only; no business data crosses until a session exists.
- **Usuarios** = `users:*`, gated on `users.manage`; override toggles render from the core registry, so a new permission key appears with no UI change.
- **Comprar usados / Dispositivos usados** = `used:*` + `credit:*`. Selling a used phone reuses the ordinary serialized-unit path — no new sale code (ADR-0013).
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
