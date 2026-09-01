# ADR-0015: Shifts derived from facts, and one place the drawer's truth lives

**Status:** Proposed · **Date:** 2026-09-01 · **Deciders:** Zothix (Codroon)
**Supersedes nothing.** Fills the `shift_id` column ADR-0010 reserved on day one.

## Context

The till has taken money since v0.9.0 and has never been counted. Cash arrives from sales,
leaves as change, leaves again to pay for a used phone, arrives as a repair deposit and may
have to go back. Every one of those events is already recorded somewhere. What does not
exist is the sentence the shop actually needs at 21:00: *this is what should be in the
drawer, this is what is in it, and this is the difference.*

Requirement 21 asks for shifts with a counted float and a Z report. ADR-0010 deferred them
and left `documents.shift_id` nullable so that landing them later would be additive.
ADR-0014 drew the line this ADR now stands on: `cash_movements` holds non-sale cash only,
"and when Caja lands, it opens the float and reconciles by reading tenders AND this table,
rather than a third ledger written later."

This slice is that. It is also the first slice where the shop can be *wrong* and the
software has to say so out loud rather than average the difference away.

---

## 1. A shift is a per-till record, and its status is a fact, not a column

A shift belongs to the **till**, not to a person. Two cashiers work one afternoon; the
drawer does not change hands when they do. Open and close each record who was there, and
that is the whole of the attribution a drawer needs.

**Open means `closed_at IS NULL`.** There is no `status` column, no `open` boolean, and no
channel that accepts a status — the same discipline ADR-0014 §1 applied to repairs, for the
same reason: a status column is a cache, a cache can disagree with the facts, and a drawer
that disagrees with itself is worse than one nobody counted.

**At most one open shift per till, enforced by the database:**

```sql
CREATE UNIQUE INDEX ux_shift_open_per_terminal ON shifts(terminal_id) WHERE closed_at IS NULL;
```

A partial unique index, not a check in code. Code checks lose races — two windows, a double
click, a retry after a slow write — and the failure mode is the worst one available: two
open shifts, each computing an expected cash from an overlapping set of rows, both wrong,
neither obviously wrong. SQLite has had partial indexes since 3.8 and drizzle emits them;
the guarantee costs one line and cannot be bypassed by a code path added later.

Closing sets `closed_at`. The index then permits the next shift and not before.

## 2. The Z number is a gap-free per-till series, and the date is decoration

Shift numbering goes through the machinery ADR-0008 already built: a `number_series` row per
till with `doc_type = 'shift'`, prefix `Z1-`, allocated by `allocateNumber()` **inside the
close transaction**. `DOC_TYPES` carries no CHECK constraint (drizzle's SQLite text enums
emit none), so adding `'shift'` is a TypeScript edit, not a migration.

The mockup shows `#S-0810-1` — a date-derived number. Rejected: a per-day counter produces
gaps across days, resets, and two shifts numbered `-1`, and it makes "show me Z 47" a
question about the calendar. The number is `Z1-000001`, monotonic for the life of the till;
the date is printed beside it because humans navigate by dates, and it carries no meaning
the number does not already have.

A shift is not a document and gets no `documents` row. It borrows the series table because
a second numbering mechanism is a second thing that can produce gaps.

## 3. One fact, one place: sale cash is never copied into `cash_movements`

**`cash_movements` holds non-sale cash only.** Sale takings and change stay where they
already are — `document_tenders` rows against a completed document — and are *read* by the
shift computation, never mirrored.

The argument is not tidiness. Reconciliation is the act of comparing two **independent**
records: what the books say against what the notes in the drawer say. Copy the takings into
a second table and the till gains a third record which is neither independent nor a count —
it is a transcript. Compare the transcript against the books and you have proved that the
copier ran. Compare it against the drawer and you are auditing the copier, not the shop.

And a copy is a promise that every future path that completes a document will also write the
mirror row. The paths that complete a document today are three (`sale:complete`,
`used:log`, `repair:collect`) and there will be more. The first one that forgets produces a
till whose two answers to "what did we take today" differ by exactly one sale, with nothing
in the data to say which is right. A ledger that can be *partially* maintained is worse than
one that is derived, because it looks maintained.

So: **the expected-cash computation reads tenders and `cash_movements` and nothing else.**

## 4. Expected cash, exactly

```
expected =  opening_float_cents
          + Σ over the shift's completed documents:  cashTendered(doc) − change(doc)
          + Σ over the shift's cash movements whose reason moves notes:  amount_cents
```

where, for one document,

```
cashTendered(doc) = Σ tenders where method = 'cash'
change(doc)       = max(0, Σ all tenders − doc.total_cents)
```

**Change is derived and must stay derived.** It is not stored today — no column on
`documents`, none on `document_tenders` — and adding one would be exactly the second store
§3 forbids. It does not need to be stored, because `validateCompletion()` refuses any
completion in which a tender that cannot give change exceeds the total (`TENDER_MISMATCH`).
Therefore any excess over the total was handed back in notes, and `Σ tenders − total` is the
amount. Core gets one pure function, `documentCashDelta({ totalCents, tenders })`, and both
the X preview and the close call it.

Worked through the cases that matter:

| Situation | Tenders | Total | cash − change | Drawer |
|---|---|---|---|---|
| Cash sale with change | cash 20,00 | 10,00 | 20,00 − 10,00 | **+10,00** |
| Card only | card 10,00 | 10,00 | 0 − 0 | **0** |
| Split | card 6,00 + cash 5,00 | 10,00 | 5,00 − 1,00 | **+4,00** |
| Voucher exceeds the ticket | store_credit 15,00 | 10,00 | 0 − 5,00 | **−5,00** |
| Repair collection | deposit 20,00 + cash 59,00 | 79,00 | 59,00 − 0 | **+59,00** |

The fourth row is the one that justifies the shape of the formula. A voucher larger than the
ticket is settled by handing the customer cash (ADR-0013 §4, extended 2026-08-30): cash
tendered is zero and change is positive, so the drawer *loses* five euros on a sale. A
formula written as "sum the cash tenders" would miss it and the shift would come up five
euros short with no explanation. Written as *tendered minus change* it falls out for free.

Card, Bizum, transfer, store credit and `deposit` never touch the drawer.

## 5. `repair_deposit_applied` is bookkeeping, not a drawer event

ADR-0014 §7 posts a negative `repair_deposit_applied` movement when a deposit is applied at
collection, so that a ticket's cash rows net to zero and the same €20 is not counted twice.
Under §4 there is no double count to cancel: the collection's **cash** tender is €59, not
€79, because the deposit is a `deposit` tender. Subtracting the movement as well would
understate that shift's drawer by exactly the deposit.

The row is right and stays. What it is not is a movement of notes — nothing physical happens
at collection; what changed is whose money it is. So `cash_movements` rows are classified by
reason, once, in core:

| Reason | Moves notes? | Why |
|---|---|---|
| `repair_deposit` | **yes**, in | The customer handed over cash at intake |
| `repair_deposit_applied` | **no** | Ownership changed, the notes did not move |
| `repair_deposit_refund` | **yes**, out | Handed back |
| `used_purchase_payout` | **yes**, out | Paid the seller from the drawer |
| `paid_in` (new) | **yes**, in | Manual |
| `paid_out` (new) | **yes**, out | Manual |

A `DRAWER_EFFECT: Record<CashMovementReason, boolean>` total map, with a test asserting every
reason in the enum appears in it. A new reason added without a decision about the drawer is
then a compile error, which is the only reliable way to keep a classification honest.

## 6. A used-device payout must be written where it happens

Today a cash payout for a used phone gets its `cash_movements` row from an idempotent
**startup fix-up** (`packages/db/src/fixups.ts`), which was the right way to give history a
home when the ledger arrived after the purchases did. It is the wrong way to record the
future, for three reasons that all bite this slice:

1. The shift's expected cash is wrong from the moment of the payout until the app is next
   restarted — which on a shop till is tomorrow.
2. The row is then created **after** the shift closed, with a `created_at` inside it. The
   audit check in §11 recomputes a closed shift and compares it against the frozen snapshot;
   it would fail on a shop that did nothing wrong. A check that cries wolf gets switched off.
3. It cannot carry a `shift_id`. At fix-up time there is no session, no open shift and no
   honest answer to "which shift did this belong to".

**Decision:** `used:log` writes the payout row inside its own transaction, like the repair
deposit already does. The fix-up stays for historic rows and stays idempotent — it skips any
purchase that already has a payout row, so the new writer and the old backfill cannot
double-post — and its counter should read zero for every purchase made from v0.13.0 on.

## 7. Close is one transaction that freezes an immutable snapshot

Closing reads the facts, computes the totals, allocates the Z number, stamps `closed_at`,
the counter, the expected figure, the variance, its reason and any approver, writes the
**frozen Z snapshot as JSON**, and oplogs — all in one SQLite transaction, like every other
write in this codebase.

**Why freeze rather than recompute on reprint.** A Z report is the shop's statement about a
day, printed, signed and filed. If reprinting recomputed, then any later change to the
underlying data — a voucher voided next week, a correction, a settings edit, a bug fixed —
would silently rewrite a document the owner already signed. That is the same relationship
ADR-0007 established between a line's snapshotted tax rate and the current one: what was
true then is the record; what is true now is a different question.

**Reprint always renders the snapshot. Never a recomputation.** The recomputation exists, in
`db:audit`, where a divergence is *reported* rather than silently applied.

## 8. No reopening. A correction is a movement in a later shift

A closed shift cannot be reopened, edited, or deleted. A miscount discovered tomorrow is a
`paid_in`/`paid_out` movement in tomorrow's shift, with a concept naming the Z it corrects.

Same reasoning as ADR-0004 for stock and ADR-0008 for numbers: correcting by editing the
record destroys the evidence that there was anything to correct, and the evidence is the
point. Yesterday's Z keeps its variance. That is not a defect — the Z says what was counted,
and it was counted wrong.

## 9. What requires an open shift, and what does not

The rule, stated once: **an open shift is required by any action that creates a fiscal
document or moves notes in the drawer.** Everything else may happen without one, and stamps
the shift if one is open.

| Requires an open shift | Does not |
|---|---|
| `sale:complete` | catalogue work |
| `used:log` | `stock:add` (receiving a delivery) |
| `repair:collect` | `repair:create` **without** a deposit |
| `repair:create` **with** a deposit | quotes, parts, assignment, marking ready |
| `repair:markNotRepaired` **when it refunds or applies a deposit** | `repair:markNotRepaired` on a ticket with no deposit |
| `cash:paidIn` / `cash:paidOut` | reading anything |

Two layers, because the rule has two shapes. Channels that *always* move money declare it and
are refused in the handler. The two conditional ones (`repair:create`,
`repair:markNotRepaired`) call `requireOpenShift()` on the branch that moves cash, inside the
transaction, where the branch is known. A registry test pins the list, the way
`ipc-guard.test.ts` pins permissions, so a new money channel cannot quietly skip it.

Refusal is a typed code, **`SHIFT_REQUIRED`**. The Sale screen catches that specific code and
offers to open a shift inline rather than sending the cashier to another screen with a
customer waiting. Blocking a sale to teach someone about process is how a till gets
bypassed with a paper notebook.

**Receiving stock deliberately does not require a shift.** A delivery is unpacked before the
shop opens, involves no drawer, and requiring a shift for it would mean opening the till to
count boxes.

## 10. Variance: signed, always explained, sometimes approved

```
variance = counted − expected
```

Negative is **short**, positive is **over**. The sign convention is stated on the Z in words
as well as in figures, because a bare "−4,60 €" is ambiguous to everyone who did not write
it.

- **Any non-zero variance requires a reason.** Not just a large one: a shop that writes
  "cuadra" for every 40-cent difference is a shop where the reason field means nothing, and a
  40-cent difference every day is a pattern worth a sentence.
- **|variance| above the tolerance setting (default 3,00 €) requires approval** — the
  existing modal, an owner's PIN, `cash.close_over_tolerance` marked `approvable`. No new
  mechanism (ADR-0012 §5). Both `user_id` and `authorized_by_user_id` land on the entry and
  on the Z.

The counted figure comes from the payload — it is what the cashier typed, and nothing else
could supply it. That is not a hole in the gate: sending a false count does not dodge the
approval, it records a lie under the sender's name, and a *lower* count makes the variance
larger, not smaller.

## 11. Denominations are evidence attached to a count, stored as JSON

Euro denominations are a constant in core (500 € down to 0,01 €, notes and coins). A count may
carry a breakdown; quantities are stored keyed by value in cents:
`{"2000": 4, "1000": 6, "500": 8, "100": 20}`.

JSON, not a table. A breakdown is a note attached to exactly one count: never queried across
shifts, never joined, never aggregated. Fifteen rows per count to store a number that must
equal the total anyway would be a table whose only purpose is to be summed back into the
figure beside it.

**The total is the stored authority; the breakdown is evidence.** They may never disagree: if
a breakdown is present, the domain refuses the write unless its computed total equals the
stored total. Two numbers that can drift is precisely what §3 rejects, and refusing at the
boundary is cheaper than auditing for it later.

The 500 € note stays in the constant even though the shop refuses them — a zero costs nothing
and its absence would be a question every time.

## 12. X is the same computation, uncommitted

One core function, `computeShiftTotals(facts) → ShiftTotals`. The X preview calls it and the
close calls it. The X print is the same renderer with a different heading and no Z number.

The guarantee this buys is worth stating plainly: **what X shows is exactly what a close
right now would freeze**, because it is literally the same function over the same rows. An
X that ran its own arithmetic would be a second implementation of the day's takings, and it
would be the one nobody tested.

X consumes no number, writes no shift row, and changes nothing. It does write an oplog
`shift.preview` entry, because "someone took an X at 19:40" is exactly the fact that matters
later when the count is short.

## 13. Parked sales are counted and flagged, never blocking

A parked ticket carries no tenders, no number and no money. It cannot affect a drawer, so it
cannot block a close. The Z prints the count so the next shift knows they are there, and the
close panel says so before the button is pressed.

## 14. Where this leaves Reports

A Z snapshot is the shop's own summary of a period, frozen and numbered. That makes it the
natural source for the Reports screen (nav 10), which is out of scope here. **Seam, not
built:** the snapshot carries a `snapshotVersion` so a future reader can tell which fields it
may rely on, and nothing else is designed for it now.

---

## Options considered

**A status column on shifts** — rejected for the reason ADR-0014 rejected it for repairs: a
cache that can disagree with the facts, needing an audit check to catch what a derivation
makes impossible.

**One open shift enforced in code only** — rejected. Loses races; the failure is silent and
compounding.

**Mirroring sale cash into `cash_movements`** — rejected in §3. It reads as the simpler
design and is the one that produces two numbers.

**A `change_cents` column** — rejected. Derivable from rows already stored, and the moment it
exists it can be wrong.

**Recomputing the Z on reprint** — rejected in §7. Silently rewrites a signed document.

**Reopening a shift to fix a miscount** — rejected in §8. Destroys the evidence.

**Per-day Z numbering (the mockup's `#S-0810-1`)** — rejected in §2.

**A `shift_denominations` table** — rejected in §11.

## Consequences

**Easier.** The drawer has exactly one derivation, and it is a pure function tested against
hand-computed scenarios. Reconciliation compares a count against the books rather than the
books against a copy of themselves. The Z is a frozen artefact, so a reprint is a file read.
A new money-moving channel that forgets the shift gate fails a registry test.

**Harder.** Every path that completes a document must now pass a shift precondition, and the
two conditional ones carry a branch. The used-purchase payout moves from a startup fix-up
into the purchase transaction — a behaviour change on an existing path, covered by tests.
`repair_deposit_applied` becomes a row the drawer computation deliberately skips, which is a
subtlety that lives in one map and must stay documented where it is used.

**Accepted.** After the upgrade the till has no open shift, so the first cash action of the
day is refused until somebody opens one. That is the feature. Every pre-v0.13.0 document and
movement keeps `shift_id = NULL`, meaning "before shifts"; nothing is backfilled, because
inventing which shift a row from July belonged to would be fiction, and the audit check is
written to apply only from this version forward.
