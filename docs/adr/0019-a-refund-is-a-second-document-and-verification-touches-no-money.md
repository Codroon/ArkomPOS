# ADR-0019 — A refund is a second document, and verification touches no money

**Status:** Accepted (v0.16.0)

## Context

Two features that look unrelated and share one principle: **a record of what happened is not a
thing you edit.**

The shop has been giving refunds on paper since it opened. And the WU counter (ADR-0018) now
logs transfers the till cannot verify against WU's own terminal, so somebody has to say "I
checked this one" in a way the future CSV import can build on.

## Decision

### 1. A refund is its own document, and the original is never touched

New doc type `refund`, its own gap-free series with prefix **`D1-`** — *devolución*, the word the
shop uses, and free: `T`, `R`, `C` and `Z` are tickets, repairs, purchases and shifts.

The refund carries **negative lines** referencing the original's, and points at the original
through `documents.refunds_document_id`. The sale stays exactly as recorded. It is the fiscal
record of something that genuinely happened, and a till that can rewrite yesterday has no record
at all (ADR-0007).

### 2. Tax reverses at the ORIGINAL line's snapshot

Not today's rate. Not the product's current regime. IVA21 reverses at 21%; **REBU reverses at
zero**, because the margin scheme never carried VAT the customer could deduct, so there is none
to give back — even if the same model is bought new and sold at 21% today.

Line money is **apportioned from the line's own totals**, not recomputed from a rate: a line of
3 at 9,90 € carries rounding only its own figures know about, and 21% of a third of it can miss
by a cent. The last unit takes the remainder, so however a line is split across partial refunds
it closes to exactly what was charged.

### 3. Double refunds are prevented on the line, by a column

`document_lines.refunded_qty` on the **original** line, updated inside the refund's transaction.
It lives there because that is the only place "you cannot refund more than you sold" can be
answered by reading one row — and summing the refund history instead is how two tills refund the
same item at once. The check runs inside the transaction, on a re-read, because the peek the
operator is looking at may be a minute old.

The refusal is at the **line**: "that one is already back" is a different problem from "this
ticket is spent", and only the first tells the shop which item to look at.

### 4. Returned serialized goods go to review, never to the shelf

A quantity line restocks with a `return_in` movement — insert-only, like every stock fact
(ADR-0004) — and the checkbox defaults on, because an unopened box goes back on the shelf.

A **serialized or used unit does not.** Its status goes to `held` and its purchase is flagged
`needs_review`: it left the shop, it has been in somebody's pocket, and nobody has looked at it
since. That is the same reasoning that puts a bought used device on hold (ADR-0013 §1), and
`held` means on-hand stays 0 so the Sale screen cannot offer it.

### 5. The money reuses the machinery that exists

A **negative tender** on the refund document, so the drawer's existing per-document formula
carries it without knowing what a refund is (ADR-0015 §3). Cash therefore needs an open shift;
so does everything else, because every completed document is stamped with one. Store credit
issues a voucher through the same table the buy screen uses, linked to the refund. There is no
change to compute — a refund is exact by construction.

Refunding is **approvable**, not owner-only: the customer is at the counter and a cashier
presses the button while an owner's PIN completes it.

### 6. Reports and the Z net refunds without subtracting anywhere

The sales window includes `refund` documents alongside `ticket`. Their totals are negative, so
every figure on every grouping is net of refunds with no subtraction written down. The **ticket
count still counts tickets** — a refund is not a sale, and an average over both is a number
nobody could reproduce from the drawer.

The Z gains a refunds block: count, total, by method. Sold 900 and gave 120 back is **two facts**,
and 780 alone lets a shop check neither. The block is optional in `ShiftTotals`, exactly as
`transfers` is, so a snapshot frozen before this release prints what it printed then
(ADR-0015 §7).

### 7. WU verification is inert by construction

`unverified` (default) / `verified` / `flagged`, independent of `sent`/`paid`/`cancelled`, and
**it moves no money at all**. A verified transfer and an unverified one do identical things to
the drawer. If verification could move cash it would be a second way to change the till's
figures without a document, which is the thing ADR-0015 exists to prevent.

A flag **requires a note**: a red row nobody can explain is a mystery rather than a signal. Bulk
verify takes **IDs, never a filter** — "everything matching" would tick rows that arrived between
the list rendering and the button being pressed, and verification is a person saying they looked.
It also skips flagged rows, because a bulk tick must not quietly answer a question somebody
raised.

Editing an MTCN is its own owner permission and re-checks uniqueness, because the MTCN is the key
the reconciliation import will join on: changing it re-points the row at a different WU
transaction.

## Consequences

**Easier.** Refunds are a normal document, so printing, the drawer, the Z, the reports and the
oplog all handle them with code that already existed. Verification gives the import somewhere to
land.

**Harder.** `refunded_qty` is a denormalised running total. It is written in the same transaction
as the refund line that moves it, and `db:audit` should learn to assert the two agree.

**Accepted, and out of scope:** refunding a refund, exchanges as a single flow, refunds against
used-device purchase documents, and a formal A4 rectificative invoice. The `D1-` document is a
receipt, not a *factura rectificativa*; a shop that needs one needs the invoice slice first.

## A1. Amendment (v0.16.1) — finding the ticket, and printing its number as bars

§1 gave a refund its own document and left unsaid how the shop reaches the sale it reverses. In
practice that is the whole flow: a customer returns three weeks later holding a receipt.

**Find ticket** on the Sale screen takes a document number typed or scanned, and resolves three
shapes to the same ticket: `T1-000482` (scanned or typed in full), `t1-482`, and `482`. The bare
number matches on `documents.number` rather than by rebuilding a string, because the prefix and
the padding belong to the SERIES — a till with two of them would otherwise find the wrong
ticket, and where a number is ambiguous across series it returns nothing rather than guessing.

It is deliberately **unbounded by date and by shift**. The receipt in the customer's hand is the
only filter that matters.

It opens the ordinary document peek, where **Refund already lives**. There is no refund screen,
because a refund is something you do to a ticket you are looking at.

**The ticket footer now carries its own number as a Code128 barcode**, so tomorrow's refund is
scan → peek → Refund. Code128 rather than EAN-13 because it takes the letters and the dash
without a second thought. The human-readable number prints under the bars, so a torn receipt is
still usable by somebody typing it in.

The **PDF fallback prints the number and no bars**, and that is a decision rather than an
omission: the PDF exists for when there is no printer, so it is read on a screen or emailed —
where a picture of Code128 is scanned by nobody, and drawing one properly means shipping the
encoding tables for a surface that cannot use them.
