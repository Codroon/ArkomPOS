# ADR-0014: Repair tickets — status entailed by facts, parts before revenue

**Status:** Accepted · **Date:** 2026-08-31 · **Deciders:** Zothix (Codroon)
**Amended:** 2026-09-02 (v0.14.1) — see §A1.
**Builds on:** [0004](0004-stock-as-insert-only-movement-ledger.md) (movement ledger) ·
[0007](0007-tax-snapshot-on-lines.md) (tax snapshot) ·
[0008](0008-document-numbering-per-till-series.md) (numbering) ·
[0010](0010-auth-deferred-nullable-actor-columns.md) (actor columns) ·
[0012](0012-local-pin-auth-and-permission-registry.md) (permissions, the Technician
sketch, the `ctx` parameter) · [0013](0013-used-device-purchases-and-store-credit.md)
(documents that are not sales, photos as files).
Nothing here supersedes anything.

## Context

The shop repairs phones. Today a repair is a paper docket in a drawer, a price agreed out
loud, and a part taken off the shelf that inventory never hears about. Four things make it
more than "a service line on a ticket":

- **The device is the customer's.** It is in the shop's hands for days, and the shop is
  liable for it. It is emphatically not stock — but the *parts* that go into it are, and
  they leave the shelf long before anybody pays.
- **Money and work happen at different times.** A part is consumed on Tuesday; the
  customer pays on Friday; sometimes they never come back. Booking revenue when the part
  moves would put income in the wrong week and in the wrong document.
- **Spain regulates the conversation.** The customer must be given a written record when
  they leave the device; chargeable work may not begin until they have approved an
  estimate, unless they authorized a cap in advance; a diagnosis fee may only be charged
  if it was announced when the device was taken in; the repair carries a warranty.
- **A repair has a state, and the state is a claim about facts.** "In repair" asserts that
  a customer approved a price. "Waiting for part" asserts that something is on order. A
  status somebody typed is a status nobody can trust.

The mockup shows a ten-stage pipeline (Received · Diagnosed · Quoted · Approved · Waiting
for part · In repair · Ready · Collected · Unrepairable · Abandoned) and a half-hour slot
calendar with per-technician columns and a walk-in bench. Neither is being built. What
follows is the model underneath the parts of it the shop actually needs.

## Decision

### 1. Status is derived from facts, never chosen

There is no "set status" action anywhere in this module. `repairStatus()` is a pure
function in `packages/core` that reads the ticket's recorded facts and returns exactly one
of seven values:

| Status | Entailed by |
|---|---|
| **Recibido** | a ticket exists, and nothing below is true |
| **Presupuestado** | ≥ 1 quote line exists |
| **Esperando pieza** | ≥ 1 open `part_on_order` line, and work has been authorized |
| **En reparación** | work authorized (see §2) and no open ordered part |
| **Listo** | `ready_at` is set |
| **Entregado** | a collection document exists |
| **No reparado** | `not_repaired_at` and a reason are set |

The seven are ordered: the later fact wins. A ticket that is Ready and then collected is
Collected; a ticket that is Not repaired stays Not repaired.

**The status column is a cache, not a source.** It is written in the same transaction as
the fact that moved it, exactly as `product_stock` is written in the same transaction as
the movement it summarises (ADR-0004), and for the same reason: the board and the list
need to filter and count without replaying every ticket. `db:audit` gains a check that the
stored status equals the derived one for every ticket, so the cache cannot quietly drift
from the facts the way a hand-set status would.

This is what makes the board honest. Dragging a card does not *set* a column — it attempts
the transition, the guard asks whether the facts entail it, and a refusal explains which
fact is missing. The button and the drag are the same code path; there is no route to a
state whose story is not written down.

### 2. "Work authorized" has two shapes, and both are recorded

Chargeable work may not start on a customer's word alone. Two facts can authorize it:

- **A recorded approval** — a row in `repair_approvals` carrying the method (in person /
  by phone), the timestamp, the actor, and **the total that was approved**.
- **An intake cap** — the customer signed a "repair up to X €" authorization when they
  left the device, stored on the ticket as `authorized_cap_cents`. Work is authorized while
  the quote total is ≤ the cap.

**Approval binds to an amount, not to a ticket.** If the quote later rises above the
approved total (or above the cap), the ticket falls back to *Presupuestado* and needs
re-approval. Approvals are rows rather than a flag precisely so that both the first
approval and the second are on the record, with what each one covered — "the customer
approved 79 € on Monday and 145 € on Wednesday" is the sentence that settles a dispute,
and a boolean cannot say it.

### 3. The customer's device is never inventory. Only parts move.

No unit row, no stock movement, no valuation. The device is described on the ticket
(description, IMEI, condition, photos) and that is all. The shop is holding it, not
owning it.

Parts are the opposite: they are ordinary stock, and consuming one is an ordinary
insert-only movement. `repair_part_out` — already parked in `MOVEMENT_TYPES` — posts
**the moment the part is added to the ticket**, not when the customer pays:

- The shelf is right at all times. A technician takes a screen out of the drawer and the
  count reflects it that minute, which is the only way the count is ever usable.
- Removing the part line posts the exact reversal, a second movement rather than a
  deletion. An insert-only ledger does not un-happen things (ADR-0004).
- The movement carries the repair document's id, the way `tradein_in` carries its purchase
  (amended into ADR-0013 after the same gap showed up there), so the movements drawer in
  Inventario links a consumed part back to the ticket that consumed it.

### 4. Revenue exists only in the collection document

A part leaving the shelf is a *cost* event. Nothing about it is income. The ticket
accumulates what will be charged — parts at their charge price, labor — and none of it is
revenue until the customer pays, at which point a **collection document** is created with
IVA21-snapshotted lines (ADR-0007) and the tenders that paid it.

A ticket that is never collected therefore leaves the books honest by construction: parts
consumed, no income booked, and a device in a drawer. The alternative — booking the charge
when the work is done — puts income in the shop's accounts for money it may never see.

### 5. The collection document is an ordinary ticket in the existing series

**Decision: the collection uses `doc_type = "ticket"` and the till's existing `T1-` series
(ADR-0008), not a series of its own.**

A repair collection *is* a retail sale: goods (parts) and a service (labor) sold to a
customer who pays at the counter, under standard IVA21. It should land in the same stream
as every other sale, so that the day's takings are one number from one series, the
existing tender machinery and change rules apply unchanged, the printer path is the ticket
path, and the shop's gestor gets one ticket book per till rather than two.

The repair ticket keeps its **own** `R-` series for the *work* — the intake document the
customer is handed when they leave the device (§6). The two numbers answer different
questions: `R-000042` is *this repair*, `T1-000913` is *the sale that closed it*. The
collection document references the repair, and the repair stores `collection_document_id`.

This is deliberately the opposite of the used-device decision, and for a reason worth
stating: a purchase (`C-`) needed its own series because it is money going **out** and is
not a sale at all. A repair collection is money coming **in** for goods and services. Same
machinery, opposite direction, different answer.

### 6. The repair ticket is a document, so numbering comes free

The ticket is a `documents` row with `doc_type = "repair"` in a per-till `R-` series, plus
a `repair_tickets` row carrying everything repair-specific — the same 1:1 shape used
devices use for `purchase`. That buys gap-free numbering allocated inside the finalising
transaction (ADR-0008), the oplog envelope, and a document id for the part movements to
point at, all without inventing a second numbering mechanism.

Its `total_cents` stays **zero**, like a purchase document. The repair document is a record
of custody, not of money; the money is in the collection ticket.

### 7. Deposits and refunds need a cash ledger, so this slice starts one

A deposit taken at intake is cash in the drawer that belongs to the customer until the
work is done. It is not revenue, not a tender on a sale that has not happened, and not
something to leave unrecorded — at *Not repaired* it may have to be handed back.

Phase 1 has no cash ledger: shifts, float and the Z report are not built. Rather than
invent a private one, this slice introduces the minimal shared table the Caja module will
later build on: `cash_movements` — signed amount, reason, optional document and ticket
references, actor, timestamp, oplogged like everything else.

Two reasons in one:

1. **In**: the deposit at intake. **Out**: the refund when a device is returned unrepaired.
   Both are drawer events the shop must be able to count.
2. When Caja lands, float, pay-outs and the Z report read *this* table rather than a second
   one written later, which is the mistake that produces two answers to "what is in the
   drawer".

**The boundary, drawn explicitly (decided 2026-08-31).** Three things go in the cash ledger
and one thing deliberately does not:

| Event | In `cash_movements`? |
|---|---|
| Repair deposit taken | **Yes**, in |
| Repair deposit refunded at Not repaired | **Yes**, out |
| Used-device payout in cash | **Yes**, out — from this version, and backfilled |
| Sale takings and change | **No** — until the Cash screen slice |

A sale's cash is already recorded, completely and per-document, as a `document_tenders`
row. Copying it here would create a second place to ask "what did we take today", and the
two would disagree the first time a copy was missed — which is exactly the failure mode
this table exists to prevent. What belongs here is what has **no other home**: money that
moves without a sale.

Used-device payouts do have that shape, so they join from v0.12.0 forward and the historic
ones are backfilled. Everything needed is already on the purchase — amount, method, when,
where, and who took it — so the backfill is a join, not a reconstruction. It is idempotent
(it skips any purchase that already has a payout row) and it lives in TypeScript rather than
SQL, because SQL cannot mint a UUIDv7 and ADR-0006 does not allow a random id in its place.

When Caja arrives it reconciles the drawer by reading tenders **and** this table. That is
one query more than reading a single ledger, and one source of truth fewer than maintaining
a copy.

### 7a. The collection cross-reference is stored both ways

The `R-` number and the `T1-` number answer different questions (§5), so each document
carries the other's:

- the repair ticket stores `collection_document_id` — the sale that closed it;
- the printed collection ticket carries the `R-` number as a reference line.

Neither direction is derivable from the other in one hop otherwise: from a till receipt in a
customer's hand, the repair is one lookup away; from the workshop board, so is the money.

**At collection the deposit is a tender, not a discount.** `TENDER_METHODS` gains
`deposit`: the collection document's total is the full value of the work, and the deposit
appears beside cash or card as one of the things that paid it. Exactly the store-credit
reasoning (ADR-0013 §4) — a negative line would corrupt the taxable base and the printed
IVA breakdown. No second drawer movement is posted at collection: the money went in at
intake and has not moved since.

### 8. The diagnosis fee is chargeable only if it was announced

A fee the customer was never told about is not a fee. The amount is a setting, but what
governs chargeability is the **snapshot taken at intake**: `diagnosis_fee_cents` is copied
onto the ticket when it is created, and the intake receipt prints it only if it is
non-zero. At *Not repaired*, the fee may be charged only if that snapshot is non-zero —
changing the setting afterwards cannot reach back into tickets already taken in, which is
the whole point of snapshotting it.

### 9. Technician is the third role, and it is one edit to the registry

ADR-0012 Rule 1 claimed a new role costs a name and a default permission set: no
migration, no schema change, no UI change. This slice is the test of that claim, and the
Stage B report will say plainly whether it held.

The Technician default set is the sketch from ADR-0012, widened only where this slice's
key names differ: view and work repairs, use the board, and nothing else — no selling, no
catalogue, no stock receiving, no settings. **Receiving an ordered part is deliberately
NOT a technician permission**, for the reason ADR-0012 already gave: a technician who can
receive stock is a technician who can quietly write off a part.

The `ctx` restriction stays **off**. A two-person workshop where one technician cannot
touch the other's ticket is an obstruction, not a control. Switching it on later is a rule
inside `can()` and nothing else:

```ts
// in can(), for the repair.* keys
if (subject.role === "technician" && ctx?.assignedUserId && ctx.assignedUserId !== subject.id) {
  return false;
}
```

Call sites already pass the ticket's `assignedUserId` where they have it, so the change is
one function and a settings flag — not an edit to every guarded handler. That is why the
parameter has been carried unused since v0.10.0.

### 9a. No release without payment. Instead, one control on the charge.

`repair.release_without_payment` is sketched in ADR-0012 and is **not built**. Collected
requires a collection document, and a zero-value collection already covers warranty rework
and "nothing was wrong" — handing a device back on credit is a business decision the shop
has not asked for.

What replaces it is a control on the other end of the same worry. **The collection always
settles at exactly the ticket's charged total**; the payment dialog cannot be told a
different number. So the only way to change what a customer pays is to change what the
ticket charges — and after they have approved a price, lowering a charge:

- requires a **reason**, and
- requires `repair.price_override`, which is **approvable** — the same machinery, modal and
  dual attribution a discount on the Sale screen goes through (ADR-0012 §5).

Raising a charge needs neither, because raising it past the approved total drops the ticket
back to *Presupuestado* by itself (§2) and nothing can be collected until the customer
approves again. The dangerous direction is downward, quietly, at the counter.

Warranty rework never triggers this: it is quoted at zero from the start, so there is no
approved figure to reduce.

### 10. The passcode is written down, and never printed

A repair needs the device's passcode or pattern, and the customer gives it at the counter.
It is not a secret from the shop; it is a secret from everything the shop leaves lying
around. It follows the PIN discipline (ADR-0012):

- **Never printed** — not on the intake receipt, the quote, the final receipt or the return
  document. The customer's own paper is the likeliest thing to be left on a bus.
- **Never in an oplog payload and never in a log line.** Every other ticket field is
  oplogged; this one is recorded as present-or-absent and nothing more.
- **Tap to reveal in the UI**, masked by default, so a screen facing the shop floor does
  not show it to whoever is standing there.

Unlike a PIN it is stored in plaintext, because the technician has to read it back. The
control is where it goes, not how it is stored — and a grep-style test asserts it appears
in no print payload, no oplog row and no log line, the same way the backup test asserts
what a backup contains.

**And it never leaves the till in plain form.** Phase 2 sync (ADR-0005) ships the oplog to
the cloud; `device_passcode` is excluded from it or encrypted at rest before it goes, and
the choice between those two is sync's to make. Recording the intent here rather than
discovering it during sync design is the entire point: by then the field will exist in
thousands of rows, and "we should have thought about that" is an expensive sentence. The
oplog already carries no passcode value, so today the exclusion is nearly free — sync
inherits a field it must handle deliberately rather than a leak it has to chase.

### 11. Customers become a table, with a seam and no migration

`customers` — name, phone, optional note — found-or-created at intake, deduped on a
normalized phone number (digits only, national prefix stripped). Editable inline; no
management screen in this slice.

Used-device sellers are *not* migrated. `used_purchases` keeps its own seller columns, and
the seam is a nullable `customer_id` added there later: a purchase would link to a customer
without losing the identity snapshot it is legally required to keep. Doing it now would
mean a data migration guessing at whether two similar names are one person, which is the
kind of decision a shop should make deliberately and one at a time.

## Options considered

**A `repairs` table with its own numbering.** Rejected: it duplicates the series machinery
ADR-0008 already provides and leaves part movements with nothing to reference. Reusing
`documents` is what makes `repair_part_out` visible in the movements drawer.

**Booking revenue when the work is done.** Rejected in §4. It records income for money the
shop may never collect and puts it in the wrong week when it does.

**Deposit as a negative line on the collection document.** Rejected in §7 — the same
corruption of the taxable base that a negative store-credit line would cause.

**A free-text status field, or a status the user picks.** Rejected in §1. Every status in
this module is a claim about facts; letting someone type it makes the board a decoration.

**The mockup's ten statuses.** *Diagnosed* and *Approved* are not states of a device, they
are facts about a ticket, and both are already recorded (a quote exists; an approval row
exists). Folding them in would give two of the seven columns nothing distinct to hold.
*Abandoned* is captured as a **reason** on Not repaired rather than a status, because what
the shop does with an abandoned device is a disposal process nobody has designed yet.

**The mockup's slot calendar.** Rejected for this slice: half-hour slots per technician
plus a walk-in bench is an appointment system, and the shop's actual need is "promised for
Tuesday afternoon". Promised is a date plus morning/afternoon, and the board shows what is
overdue.

## Consequences

**Easier:** the board cannot lie, because it renders derived state. Collection reuses the
sale path whole — tenders, change, IVA snapshot, numbering, printing — so repairs add no
second way to take money. Parts consumption is visible in Inventario the same day it
happens. A part on order has zero stock effect until it physically arrives, so the count
never includes something that is still at a supplier.

**Harder:** three tables and a status function are more moving parts than a `repairs` table
with a text column, and every transition now needs its facts recorded before the UI will
allow it — which is the point, but it means the intake screen must capture more than a
paper docket did. The `cash_movements` table is a Caja-shaped commitment made early; if
the Caja slice later wants a different shape, it will be migrating a table with real rows
in it.

**Deferred:** shifts, float and the Z report that will read `cash_movements`. Warranty
*claims* (the warranty date is printed and stored; a claim flow is not built). Serialized
parts. Supplier records — the ordered-part line carries free text. Any notification that
leaves the till: the notified log is shaped so a Phase 2 cloud job can send from it, and
sends nothing today.

---

## A1. Amendment (v0.14.1) — one technician picker, fed by one list

Five screens chose a technician from five copies of the same dropdown, each fed
by `auth:users` — which is the LOGIN list. It offered the owner and every cashier
as people to assign a repair to, and once technicians stopped holding PINs
(ADR-0012 §A1) it would have offered nobody at all.

**`users:technicians`** returns active Technician-role users, names and ids and
nothing else, readable by anybody holding `repair.view` — because a picker is not
user administration, and `users:list` stays owner-only since it carries more.

**One `TechnicianPicker` component** is used everywhere: repair intake, the
ticket page, the repairs list filter, the workshop board filter, and the reports
open-repairs filter. A filter offers *todos* and *sin asignar*; an assignment
offers only the second, because assigning work to "everyone" is not a thing.

**The ticket page shows the assignment as a value**, with a Cambiar técnico
button beside it. An unset `<select>` reads as "nobody has decided yet" whether
or not that is true, and it changes on a stray click; assignment is a fact you
read, and changing it is a thing you choose to do.

**Attribution is untouched.** The oplog keeps the logged-in user for every
action, including the assignment itself — a test asserts a cashier assigning a
ticket to a technician records the cashier.
