# ADR-0013: Used-device purchases — one inventory, a purchase document, and credit as a tender

**Status:** Accepted · **Date:** 2026-08-27 · **Deciders:** Zothix (Codroon)
**Amended:** 2026-09-02 (v0.14.1) — see §A1 and §A2 at the end.
**Builds on:** [0004](0004-stock-as-insert-only-movement-ledger.md) (movement ledger) ·
[0007](0007-tax-snapshot-on-lines.md) (REBU) · [0008](0008-document-numbering-per-till-series.md)
(numbering) · [0012](0012-local-pin-auth-and-permission-registry.md) (permissions).
Nothing here supersedes anything.

## Context

The shop buys phones over the counter, refurbishes some of them, and resells them. Today
that happens on paper. Three things make it more than "another product type":

- **A bought phone is not stock yet.** It sits in a drawer while the shop decides, tests
  it, or waits out the resale hold. It must be recorded, findable and auditable — and it
  must not appear on the Sale screen.
- **Spain regulates it.** Second-hand dealing requires a register of purchases with the
  seller's identity, and resale of used goods bought from private individuals uses the
  **REBU** margin scheme rather than standard IVA (ADR-0007).
- **Payment is often not money.** The shop pays in store credit as readily as cash, and
  the customer comes back a week later to spend it.

The mockup shows a five-stage refurbishment pipeline with per-part costs and a technician.
That is not being built (see *Out of scope*); what follows is the model underneath it.

## Decision

### 1. Used devices are serialized units. There is no second inventory.

A purchased phone becomes a row in `units` — the same table, the same IMEI uniqueness, the
same sale path as a new phone. It is `item_type = 'used_device'` on its product and carries
its own `sale_price_cents`, because every used phone is priced individually.

**"On hold" is the absence of a stock movement, not a second inventory.** ADR-0004 already
says the only truth about quantity is the insert-only movement ledger, and on-hand is the
sum of its rows. So:

| State | `units` row | `tradein_in` movement | On-hand | Visible to Sale |
|---|---|---|---|---|
| On hold | yes, `status = 'held'` | **none** | 0 | no |
| In stock | yes, `status = 'in_stock'` | one, at cost | 1 | yes |
| Sold | yes, `status = 'sold'` | plus `sale_out` | 0 | no |

Sending to inventory posts the movement and flips the status, in one transaction. Nothing
else changes. This is why there is no parallel table: a held device is *already*
represented correctly by a ledger that has no entry for it, and inventing a
`purchased_devices` table with its own quantity would create a second thing to reconcile —
the exact failure ADR-0004 exists to prevent.

The two enums this needs — `units.status += 'held'` and `documents.doc_type += 'purchase'`
— are **TypeScript-only**: drizzle's SQLite text enums emit no CHECK constraint, which the
generated DDL confirms. Adding them is an edit to `schema.ts` and a Zod union, not a data
migration. (`units` does gain real columns; see §7.)

**Held devices are invisible, not filtered.** The Sale screen resolves scans through
`resolveScan`, which already only offers **in-stock** units. A held device is not in stock,
so it disappears from selling with no change to sale code — and, importantly, scanning its
IMEI reports the existing `unavailableUnit` near-miss rather than "unknown code", so the
cashier is told *why* rather than left thinking the phone was never logged.

### 2. The purchase is a document, with its own gap-free series

A purchase is a `documents` row with `doc_type = 'purchase'` and its own `number_series`
(`C-000001` by default — *compra*). ADR-0008's allocator is reused unchanged: the number is
stamped inside the same transaction that finalises the purchase, so purchase numbering is
gap-free per till exactly as ticket numbering is.

This matters beyond tidiness. The second-hand register is a **numbered sequence of
purchases** that a public authority may ask to see; a purchase that could be recorded
without a number, or with a gap, is a purchase that cannot be defended. Making it a
document rather than a bespoke table also means it inherits the oplog, the actor stamping,
and the reprint path for free.

Device and seller details live in a companion `used_purchases` row (1:1 with the document)
rather than in `document_lines`. A purchase has exactly one device and a seller; modelling
that as a line would mean inventing line semantics for a personal-identity block, and the
seller data needs to be permission-gated as a unit (§6).

**The register's field set is captured now**: purchase number, date/time, seller full name,
ID document type and number, address-capable (nullable, unused today), phone, device make,
model, IMEI, and the amount paid. A weekly export is out of scope, but adding it later must
not require a schema change or a re-interview of the shop's customers — so the columns
exist from this slice.

### 3. Photos are files on disk. The database stores paths.

Under `userData/photos/purchases/<purchase-id>/`, saved as JPEG with the longest edge
clamped to 1600px. The database stores a relative path and a `kind` (`front`, `back`,
`extra`, `seller_id`).

Never blobs. A phone photo is 200–500KB; a shop doing five purchases a day reaches a
gigabyte inside a year. SQLite can hold that, but every backup would then copy the entire
photo archive on every run (§ the online-backup API copies pages, not deltas), the 14
rotating backups would multiply it by fourteen, and the WAL would churn. Paths keep the
database in the low megabytes, where the whole backup-and-verify design assumes it lives.

**The backup must therefore cover two things instead of one.** The nightly and on-close
backup gains the photos folder alongside the database file, and restore is documented as
restoring both. A backup that silently omitted the seller-ID photos would be worse than no
backup, because it would look complete.

Paths are stored **relative** to the photos root so the whole folder can be moved or
restored under a different user profile without rewriting rows.

### 4. Store credit is a voucher, redeemed as a tender — never a negative line

A `store_credit_vouchers` row: amount, status (`issued` | `redeemed` | `void`), the purchase
that created it, and the sale that consumed it. `TENDER_METHODS` already contains
`store_credit`; this slice activates it.

Rejected: `LINE_TYPES.tradein_credit`, a negative line on the sale. It is in the enum and it
stays unused, because a negative line corrupts everything downstream — it would change the
document's taxable base, make the IVA breakdown on a printed ticket wrong, and give the
sale a total that is not the value of the goods sold. A voucher is *money the shop already
owes*, which is precisely what a tender is. Sale totals stay the value of the goods; the
tender line says how they were paid for.

**Redemption is once, in full, and it must be impossible twice.** The voucher's status flips
to `redeemed` inside the same transaction that completes the sale, guarded by a conditional
update on the current status — so two tills, or two clicks, cannot both win. Partial
redemption is *modelled* (`remaining_cents` exists) and disabled, so enabling it later is a
behaviour change rather than a migration.

**Void rules.** A voucher can be voided only while `issued`, only by `users.manage`
(the owner), and only with a reason, which is oplogged. A `redeemed` voucher is never
voided — that would rewrite a completed sale's payment. Voiding does not reverse the
purchase: the shop bought the phone, and if the credit is being cancelled the money is
settled some other way, which is a conversation and not a button.

### 5. The acquisition channel is recorded at intake, and it decides the resale regime

`used_purchases.acquisition_channel` is `private_individual` | `business` (default the
former; it is the shop's normal case). REBU applies to goods bought from a private person
who could not deduct VAT — so the regime a phone is resold under is decided by *how it was
acquired*, months before it is sold.

Recording it at intake and defaulting the unit's product to `REBU` for private purchases
means the resale line inherits the right regime from the snapshot mechanism ADR-0007 already
built. Nothing about the sale path changes. Getting this wrong is not a display bug — it is
charging VAT on the wrong base and filing it.

### 6. Seller identity is personal data and is gated separately

`usedDevices.viewSeller` is its own permission, owner-only by default and grantable to a
cashier. The list and the device detail render without the seller block for anyone lacking
it; the handler withholds the fields rather than the UI hiding them (ADR-0012 §5).

**Amended at the Stage A review (2026-08-28), before any of this shipped.** The draft made
*every* print of the purchase document require `viewSeller`. That is wrong at the counter:
the cashier types the seller's name and ID number into the form, and then could not print
the slip the seller has to sign — gating data they had just entered, and blocking the one
action that makes the purchase a legal record. The gate is therefore split by *when*:

| | Permission |
|---|---|
| Print the document for the purchase being logged | `usedDevices.create` |
| Seller block on the device detail | `usedDevices.viewSeller` |
| Seller-ID photo in the gallery | `usedDevices.viewSeller` |
| Reprint the document afterwards | `usedDevices.viewSeller` |

The distinction is data the cashier already has in front of them versus reading it back off
the till later. A reprint is the loophole that would otherwise make the on-screen gate
decorative, so it is gated with what it reveals.

**Amended again after two days of live use (2026-08-30), at the shop's request.**
Reprinting now needs `usedDevices.create` — whoever may buy a device may print
its paperwork. At the counter the tighter rule meant a cashier who had just
bought a phone could not reprint the slip when the seller lost it, and had to
fetch the owner for a piece of paper they had typed themselves an hour earlier.

The shop was told the consequence and accepted it: **a cashier can now read any
seller's details by printing the document**, so the on-screen block is a courtesy
rather than a control. What remains is the record — every print is oplogged with
who asked for it, so the question "who looked at this seller's data" still has an
answer. Anyone wanting the original control back tightens one string in
`ipc.ts`; nothing else depends on it.

### 7. Schema summary

**New tables:** `used_purchases` (1:1 with the purchase document; device attributes, seller
block, payout, refurb cost, review flag, acquisition channel, hold date),
`purchase_photos` (path + kind), `store_credit_vouchers`.

**`units` gains:** `purchase_id` (nullable — new phones have none), `sale_price_cents`
(nullable; NULL means "inherit the product price", which is every existing row),
`grade`, `battery_pct`. All nullable, so the migration adds columns and touches no data.

**Enums gain** (TypeScript only): `units.status += 'held'`, `documents.doc_type +=
'purchase'`.

## Options considered

**A parallel purchases inventory** with its own quantity column. Rejected in §1: two
sources of truth for "do we have this phone", reconcilable only by a job nobody would
write.

**Photos in the database as blobs.** Rejected in §3 — it defeats the backup design.

**Store credit as a negative sale line.** Rejected in §4 — it corrupts the taxable base and
the printed IVA breakdown.

**Refusing a voucher worth more than the ticket.** Shipped that way and reversed
after two days of live use (2026-08-30). The original rule — credit applies to a
purchase of equal or greater value, otherwise pay cash — was defensible on paper:
silently consuming 80 € of credit against a 50 € sale takes 30 € from the
customer. It was wrong at the counter. Someone who sold a phone for 50 € and
wants a 10 € protector is owed the protector, and the till refused to serve them.

The answer to "silently" was never "refuse", it was **ask**. When a voucher
exceeds the ticket the cashier now chooses: leave the difference on the voucher
(the default, and the reason a shop offers credit at all), or spend it whole and
pay the difference from the drawer. `remaining_cents` was in the schema from the
first day for exactly this, disabled rather than missing, so enabling it changed
no tables.

The consequence worth naming: store credit joins cash as a tender that may exceed
the total and produce change. Card, Bizum and transfer still may not — change
against a card is a cash advance. A voucher is money the shop already owes, so
handing back the difference settles a debt rather than advancing anything.

**A purchase as a bespoke table with no document.** Simpler by one join, and it gives up
gap-free numbering, the oplog envelope and the reprint path, all of which a legally
required register needs.

**Auto-creating a catalogue product per physical device.** Rejected: it would put a
one-off row in the catalogue for every phone ever bought. Instead one `used_device` product
per brand+model+storage+colour is found-or-created, and the individual price, grade and
battery live on the unit.

The catalogue-noise question this left open was settled at the same review: those products
are hidden from the **Catálogo management list only**. They stay ordinary sellable products
on the Sale screen — findable by scan and by model search — carrying a used marker and the
unit's grade. Hiding them from selling as well would make a bought phone unsellable, which
is the opposite of the point; hiding them from the maintenance list keeps the owner's
catalogue the set of things they actually maintain.

## Consequences

**Easier:** selling a used phone is selling a serialized unit — no new sale code, no new
stock code, no new print path for the ticket. Held devices vanish from selling by
construction rather than by a filter someone can forget.

**Harder:** backup now has two artefacts to keep consistent, and a restore that takes the
database without the photos folder is a silent partial restore. Documented, and the backup
verification is extended to notice.

**Accepted risk:** the IMEI gate is entirely offline and rests on a cashier ticking a box to
say they checked the device is unlocked and reset. It stops honest mistakes and records who
made the call; it does not stop a determined cashier. An online GSMA lookup is the real
control and it requires connectivity the till does not assume. The mockup shows one; we are
shipping a confirmation instead, and the ADR says so plainly rather than letting the screen
imply more than it does.

**Revisit:** the per-model/grade rate table (buy price is manual until the client supplies
it), partial redemption, the 15-day hold moving from a captured date to an enforced block,
and the police-register export.

## Out of scope, and why it is safe to defer

The refurbishment pipeline (stages, parts, labour, technician) is not built. One optional
`refurb_cost_cents` folds into the unit's cost at send-to-inventory, which is the only part
of it that changes a number anyone relies on. When the pipeline arrives it adds rows that
break down a total this slice already records — an elaboration, not a correction.

The police-register export is not built, but §2 fixes its field set now, because the
expensive part of that feature is not the CSV: it is asking a shop to re-contact sixty
customers for an ID number nobody captured.

---

## A1. Amendment (v0.14.1) — "needs review" is a gate, not a note

**Was:** sending a flagged device to inventory cleared the flag as a side effect —
"shelving it IS the resolution".

**Is:** a flagged device refuses with `REVIEW_REQUIRED`, and the UI answers with a
confirmation naming what was flagged. Confirming clears the flag **and records
who confirmed**, in the same transaction and the same oplog entry as the shelving
itself (`used_purchase.review_confirmed`).

The old rule made the flag's only consequence its own disappearance: a device
somebody marked for a second look could reach the shop floor without anyone
taking that look, and nothing afterwards could say whether one had happened.

**Deliberately not a hard block.** The person who flags a device and the person
shelving it are usually the same person ten minutes later, and a block they
cannot clear teaches them to stop flagging — which loses the signal entirely.
An unflagged device is untouched and shelves in one click, exactly as before.

## A2. Amendment (v0.14.1) — a used product carries the `used_device` item type

This ADR and core's documentation have described used devices as `used_device`
products since v0.11.0. The writer said `serialized`, and everything that needed
to tell a used phone from a new one matched the "(usado)" suffix in the product
NAME — which the shop can change, at which point a report silently changes its
mind about what it is counting.

Used products now carry `used_device`. `isSerializedItem()` covers both, so they
behave identically everywhere it matters — picked by IMEI at the till, valued at
the unit's own cost, refused as a repair part. The one place the two differ is
Stock muerto, which is about goods the shop can reorder.

An idempotent startup fix-up re-types existing rows, keyed **structurally** — a
product is a used product exactly when one of its units came from a purchase —
rather than on the name it is replacing.
