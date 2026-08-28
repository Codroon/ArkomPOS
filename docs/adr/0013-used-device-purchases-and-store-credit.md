# ADR-0013: Used-device purchases — one inventory, a purchase document, and credit as a tender

**Status:** Accepted · **Date:** 2026-08-27 · **Deciders:** Zothix (Codroon)
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
it; the handler withholds the fields rather than the UI hiding them (ADR-0012 §5). The
purchase document print includes the seller — printing is the act that requires the
permission, and the printed slip is the legally required record.

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

**A purchase as a bespoke table with no document.** Simpler by one join, and it gives up
gap-free numbering, the oplog envelope and the reprint path, all of which a legally
required register needs.

**Auto-creating a catalogue product per physical device.** Rejected: it would put a
one-off row in the catalogue for every phone ever bought. Instead one `used_device` product
per brand+model+storage+colour is found-or-created, and the individual price, grade and
battery live on the unit. See the open decision on catalogue noise.

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
