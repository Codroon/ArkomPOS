# Arkom POS — Used devices slice (Comprar usados · Dispositivos usados · Saldo a favor)

Status: **Stage B — building** · Target: **v0.11.0** · Owner: Zothix (Codroon)
Companions: [`ADR-0013`](../adr/0013-used-device-purchases-and-store-credit.md) (decisions) ·
[`system-design.md`](../design/system-design.md) (schema + IPC) ·
[`handoff/used-devices.md`](../design/handoff/used-devices.md) (screens).
This spec defines **what "done" means**.

## Problem statement

The shop buys phones over the counter every week and records it on paper: a notebook for
the seller's details, a mental note of what was paid, and a phone in a drawer that nobody
can price or find later. Three consequences: the second-hand register that Spanish law
requires does not exist in any retrievable form, the resale is priced from memory, and
store credit handed to a customer is remembered rather than recorded.

This slice makes buying a device an operation the till performs — with a number, a printed
document, photographs, and a device that becomes sellable stock when the shop decides it
should.

## Goals

1. A cashier logs a purchase in under three minutes, ending with a printed document the
   seller signs and a shelf label on the phone.
2. A bought phone is never sellable by accident: it enters stock only when someone
   explicitly sends it there, with a selling price set at that moment.
3. Every field the second-hand police register needs is captured at intake, so the export
   is later a report rather than a data-collection exercise.
4. Store credit is money the shop owes, redeemable once, impossible to redeem twice, and
   visible in the books as a payment rather than a discount.
5. A used phone resells through the existing Sale screen with no new selling code, on the
   REBU margin scheme.

## Non-goals (this slice)

Refurbishment pipeline — stages, parts, labour, technician (the mockup's "Used unit" flow) ·
police-register export · per-model/grade buy-price rate table · on-screen signature pad ·
partial credit redemption (modelled, disabled) · **any** online IMEI or blacklist lookup ·
enforcement of the 15-day resale hold (date captured, setting present, default off) ·
warranty tracking on used sales.

## Personas

| | Cashier (**Cajero**) | Owner (**Responsable**) |
|---|---|---|
| Buys a device | Yes — this is counter work | Yes |
| Sets the buy price | Yes, at the agreed figure | Yes |
| Overrides a suggested price | Needs approval | Yes |
| Sends to inventory + sets selling price | **Yes** — the client wants this at the counter | Yes |
| Sees the seller's ID data | No by default; grantable | Yes |
| Voids a voucher | No | Yes |

## User stories

- As a cashier, a customer offers me their iPhone; I fill one screen, the till stops me
  until I have confirmed the IMEI is clean and the phone is reset, and I print a document
  they sign.
- As a cashier, I pay in store credit and hand the customer a slip; when they come back on
  Saturday I scan it and it pays for their new phone.
- As a cashier, I put a phone on hold because we are not sure about it, and it does not
  turn up in the sale search by accident.
- As an owner, I can see every device we have bought, what we paid, who sold it to us, and
  what happened to it since.
- As an owner, I can see that Ana bought a phone for 80 € when the agreed price was 85 €,
  and that I approved it.

---

## Acceptance criteria

### U. Data and migration

- [x] **U1** `used_purchases` (1:1 with a `purchase` document): device brand, model,
      storage, colour, grade, battery %, IMEI, accessories flags; seller name, phone, ID
      type, ID number, nullable address; `acquisition_channel`; buy price; payout method;
      `refurb_cost_cents`; `needs_review`; `purchased_at`; barcode.
- [x] **U2** `purchase_photos`: purchase id, **relative** path, kind
      (`front`/`back`/`extra`/`seller_id`). No blobs anywhere.
- [x] **U3** `store_credit_vouchers`: amount, `remaining_cents`, status
      (`issued`/`redeemed`/`void`), purchase id, redeeming document id, void reason.
- [x] **U4** `units` gains nullable `purchase_id`, `sale_price_cents`, `grade`,
      `battery_pct`. Existing rows are untouched and keep working (NULL price = inherit
      the product's).
- [x] **U4b** A used device is filed under a **found-or-create product per brand + model +
      storage + colour**, named `… (usado)` — not one product per physical phone. Grade,
      battery and selling price live on the unit, which is why they are nullable columns
      there and not on the product.
- [ ] **U4c** Those products are hidden from the **Catálogo management list only**. They
      remain fully findable on the **Sale screen** — by barcode/IMEI scan and by model
      search — and every result carries a used marker with the grade, so a cashier can
      tell the new iPhone 11 from the second-hand one at a glance.
- [x] **U5** Enums gain `units.status += 'held'` and `documents.doc_type += 'purchase'` as
      TypeScript-only changes — no CHECK constraint exists, so no data migration.
- [x] **U6** A `purchase` number series is created per till with prefix `C-`, allocated
      gap-free inside the finalising transaction (ADR-0008).
- [ ] **U7** Migration runs on a **populated v0.10.0 database**: row counts unchanged,
      every existing unit still sells, `db:audit --verify` green.

### V. IMEI gate

- [x] **V1** 15 digits, Luhn-checked by the **same** `isValidImei` serialized entry uses.
- [x] **V2** Duplicate check spans **all** existing units *and* all open purchases —
      a device cannot be bought twice, nor bought while an earlier purchase of it is on
      hold.
- [x] **V3** A cashier confirmation checkbox: activation lock removed and device factory
      reset, physically verified. **Only this unblocks price and payout.**
- [x] **V4** Price, payout and both log actions are refused **in main**, not merely
      disabled in the UI, until the gate has passed.
- [x] **V5** Gate outcomes — pass and fail, with the reason — are oplogged with the actor.
- [x] **V6** No network call exists anywhere in this path. Verified by the absence of any
      fetch in the used-device code and stated on screen: the check is physical.

### W. Buy used screen

- [x] **W1** Device section: brand, model, storage, colour, grade (A/B/C), battery %,
      IMEI, accessory toggles (charger / box / cable / case), photos.
- [x] **W2** Seller section: name, phone, ID type + number, ID photo. **No signature pad**
      — the signature line is on the printed document.
- [x] **W3** Right rail: IMEI check, then price + payout, blocked until V3 passes.
- [x] **W4** Photo slots — front, back, two free, plus seller ID — each offering **Upload**
      and **Capture** side by side.
- [x] **W5** Capture uses `getUserMedia` with media permission granted in the Electron
      session permission handler; a device picker appears when more than one camera exists;
      "no camera detected" is a calm state that leaves Upload fully usable.
- [x] **W6** Photos are written as JPEG, longest edge ≤1600px, under
      `photos/purchases/<purchase-id>/`.
- [x] **W7** Barcode: scan an existing code or **Generate** via the catalogue's
      `generateInternalEan13`, duplicate-checked against products, product codes and
      purchases.
- [x] **W8** Buy price is entered manually. The suggested-price seam exists and is
      obvious in the code, awaiting the client's rate table.
- [ ] **W9** Overriding a suggested/agreed price requires a reason **and** the approval
      modal, through `usedDevices.priceOverride`.
- [x] **W10** Payout: **cash** (posts a drawer movement), **transfer** (reference
      recorded), **store credit** (creates a voucher).

### X. Logging a purchase

- [x] **X1** **Enviar a inventario**: creates the used unit, posts one `tradein_in`
      movement at buy cost **+ refurb cost if present**, prompts for a selling price
      prefilled from buy price + the margin % setting, and leaves the unit sellable with
      `REBU` as its default regime.
- [x] **X2** **Dejar en espera**: purchase and unit recorded, **no** stock movement, unit
      `status = 'held'`, not sellable, absent from Sale search.
- [x] **X3** Both actions print the purchase document (thermal, PDF fallback): shop header,
      purchase number, date, device + IMEI, accessories, buy price, payout method, seller
      name + ID number + phone, and a signature line.
- [x] **X3b** That print needs **`usedDevices.create` only, not `viewSeller`**. The cashier
      typed the seller's details thirty seconds earlier; withholding the printout they must
      hand over to be signed would gate data they just entered. `viewSeller` governs
      reading those details **back** later — see Y3b.
- [x] **X4** Both actions print a shelf label: barcode, model, grade.
- [x] **X5** Everything lands in one transaction with one oplog envelope; the actor is the
      session (ADR-0012).
- [ ] **X6** A held device scanned on the Sale screen reports the near-miss
      (`unavailableUnit`) rather than "unknown code".

### Y. Used devices screen

- [x] **Y1** One list of every purchased device whatever its state, with status chips
      **En espera** / **Requiere revisión** / **En stock** / **Vendido** and a counts strip.
- [x] **Y2** Filters by status; search by IMEI, model, purchase number, or barcode scan.
- [x] **Y3** Detail: photo gallery, device data, seller block **gated on
      `usedDevices.viewSeller`**, buy price + payout, refurb cost, and a timeline built
      from the oplog.
- [x] **Y3b** `usedDevices.viewSeller` gates three things and only these three: the seller
      block, the ID photo in the gallery, and **reprinting the purchase document from the
      detail view**. A reprint after the fact is a way to read the seller's data off a
      till that will not show it on screen, so it is gated with the data it reveals.
- [x] **Y4** Actions on a held device: toggle *Requiere revisión*, edit refurb cost, and
      *Enviar a inventario* (selling price set at that moment).
- [x] **Y5** Refurb cost is editable only while held; once in stock it is frozen, because
      it has already been folded into the unit's cost.
- [x] **Y6** A sold device links to the sale that sold it.
- [x] **Y7** Without `viewSeller`, the handler omits the seller fields from the payload —
      the UI does not merely hide them.

### Z. Store credit

- [x] **Z1** Payout = store credit creates an `issued` voucher for the buy price, linked to
      the purchase.
- [ ] **Z2** *Flow A* — after logging, **Continuar a la venta** opens Sale with the credit
      already applied as a tender chip showing the purchase number and amount.
- [ ] **Z3** *Flow B* — a **Saldo a favor** tender on any sale opens a finder: scan the
      purchase slip barcode, or search by number/name.
- [ ] **Z4** Redemption flips the voucher to `redeemed` **inside the sale's completion
      transaction**, guarded by a conditional update, so a double redemption is impossible
      rather than merely unlikely.
- [ ] **Z5** A voucher already `redeemed` or `void` is not offered by the finder and is
      refused by the handler.
- [ ] **Z6** Credit never appears as a document line. Sale totals remain the value of the
      goods.
- [ ] **Z7** Void: only from `issued`, only with `users.manage`, only with a reason,
      oplogged.
- [ ] **Z8** A voucher larger than the sale total is refused with a clear message rather
      than silently part-consumed — partial redemption is modelled and disabled
      (see open decisions).

### P. Permissions

- [ ] **P1** New registry keys with these defaults:

| Key | Module | Cashier | Approvable |
|---|---|---|---|
| `usedDevices.create` | usedDevices | ✅ | — |
| `usedDevices.priceOverride` | usedDevices | ❌ | ✅ |
| `usedDevices.sendToInventory` | usedDevices | ✅ | — |
| `usedDevices.editRefurbCost` | usedDevices | ✅ | — |
| `usedDevices.viewSeller` | usedDevices | ❌ (grantable) | — |
| `usedDevices.redeemCredit` | usedDevices | ✅ | — |
| `usedDevices.voidCredit` | usedDevices | ❌ | — |

- [ ] **P2** Every new channel is registered through `guarded()`; the registry test that
      walks `IPC_CHANNELS` still passes.
- [ ] **P3** The Users screen picks up all seven keys with **zero changes to that file** —
      the claim ADR-0012 Rule 2 made, now actually exercised by a second module.
- [ ] **P4** Each key has `perm.<key>` in both dictionaries; the label-coherence test
      covers them.

### B. Backup

- [ ] **B1** The nightly and on-close backup includes `photos/` alongside the database.
- [ ] **B2** Backup verification notices a photo folder that failed to copy.
- [ ] **B3** DEPLOYMENT.md's restore procedure restores **both**, and says why taking only
      the database is a silent partial restore.

---

## Test plan (Vitest)

| Area | Test |
|---|---|
| IMEI | Luhn accept/reject; duplicate against units; duplicate against an open purchase |
| Gate | price/payout/log refused in main until confirmed; pass and fail both oplogged |
| Logging | purchase + unit + oplog written with the session actor, in one transaction |
| Hold | held unit has no movement, on-hand 0, absent from `resolveScan` in-stock results |
| Invariant | **a held unit has zero stock movements, an in-stock unit has exactly one stock-in** — status and ledger produced by one function so they cannot disagree |
| Catalogue | a used product is absent from the Catálogo list and present in Sale search and scan, with its grade |
| Seller gate | logging prints the document without `viewSeller`; reprinting from the detail view requires it |
| Send to inventory | posts one `tradein_in` at buy + refurb cost; sets sale price; status flips |
| Refurb | cost folds into unit cost; frozen once in stock |
| Voucher | issue → redeem → second redeem refused; void from issued only; void of redeemed refused |
| Sale | totals with a credit tender; credit never creates a line; over-total voucher refused |
| Permissions | denial for each of the seven keys; approval path for the override |
| Photos | relative paths stored; backup includes the folder |
| Migration | populated v0.10.0 DB: counts unchanged, existing units still sell, `--verify` green |

## Decisions taken at the Stage A review

1. **Oversized voucher: refused, not part-consumed.** Shop rule — credit applies to a
   purchase of equal or greater value, otherwise the seller is paid cash. Partial
   redemption stays modelled (`remaining_cents`) and disabled.
2. **Found-or-create used product**, hidden from Catálogo management, visible in Sale
   search and scan with a used/grade marker (U4b, U4c).
3. **`units.sale_price_cents` nullable**, NULL = inherit the product's price.
4. **The seller gate is split** (X3b, Y3b): logging a purchase includes printing its
   document; `viewSeller` covers the seller block, the ID photo and later reprints.
5. **Nav renames applied** and both items unlocked.
6. **Margin setting ships at 25%.**
7. **Refurb cost freezes** when the device is sent to inventory.

## Still open for the client

1. **The rate table** — buy price by model and grade. Manual entry until it arrives; the
   seam is marked in code.
2. **The 15-day hold** — captured as a date with a settings flag, default off. Whether it
   should warn or block is the client's call.
3. **Acquisition channel** wording on the printed document, if their gestor wants specific
   REBU phrasing.
