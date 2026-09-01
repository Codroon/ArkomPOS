# Arkom POS — Cash slice (Caja · turnos · arqueo · informe Z)

Status: **Stage A — design** · Target: **v0.13.0** · Owner: Zothix (Codroon)
Companions: [`ADR-0015`](../adr/0015-cash-shifts-derived-status-and-one-drawer-truth.md)
(decisions) · [`system-design.md`](../design/system-design.md) (schema + IPC) ·
[`handoff/cash.md`](../design/handoff/cash.md) (screens).
This spec defines **what "done" means**.

## Problem statement

The till records every euro and counts none of them. A sale writes its tenders, a used phone
writes its payout, a repair deposit writes a movement — and at closing time the owner opens
the drawer, looks at a pile of notes, and has no number to compare it against. The shop's
current answer is a mental estimate and a shrug.

Four consequences, all of them things the client has actually said out loud:

1. **Shrinkage is invisible.** A twenty that walks out of the drawer looks exactly like a
   twenty that was never there. Without an expected figure there is no difference between a
   mistake, a theft and a normal day.
2. **Mistakes are found weeks later or never.** Wrong change given at 11:00 is discoverable
   at 21:00 for the price of one count. A month later it is archaeology.
3. **Nobody is accountable for the drawer**, because the drawer was never handed over. There
   is no moment where one person says "this is what I counted."
4. **There is no daily statement.** No Z, so no per-day record of takings by tender, no proof
   the numbering ran without gaps, nothing to hand an accountant that the till itself
   produced.

This slice makes the drawer a thing the till knows about: a shift you open with a counted
float, a live expected figure you can check at any moment, and a close that freezes a
numbered Z report saying what was taken, how, what should be there, what is, and why they
differ.

## Goals

1. Opening the till takes **under ten seconds**, and the float is counted, not guessed.
2. There is **exactly one** expected-cash figure, derived by one function, visible live and
   frozen at close. X and Z can never disagree.
3. A close is **impossible to fudge quietly**: any difference needs a sentence, a real
   difference needs an owner.
4. A closed shift is **evidence**: immutable, numbered without gaps, reprintable exactly as
   it was printed.
5. Money cannot move on a till nobody opened — and the refusal offers the fix rather than
   the door.
6. The upgrade is invisible until the shop wants it: v0.12.0 data keeps working, old rows are
   honestly marked as pre-shift, nothing is invented.

## Non-goals (this slice)

Agency / money-transfer lines and the WU reconciliation panel in the mockup · bank-deposit
tracking beyond a "a la caja fuerte / banco" paid-out concept · reopening or editing a closed
shift · multi-till consolidation (each till closes its own drawer) · the Reports screen
(nav 10 — Z snapshots are its future source; the seam is documented, nothing is built) ·
refunds and voids (their lines are **omitted** from the Z rather than printed as zeros) ·
counting anything but cash (card totals are reported, never reconciled against a terminal) ·
shift handover between cashiers without closing.

## Personas

| | Cashier (**Cajero**) | Technician (**Técnico**) | Owner (**Responsable**) |
|---|---|---|---|
| Opens a shift | Yes | No | Yes |
| Sees the Cash screen and the X preview | Yes | No | Yes |
| Records a paid-in / paid-out | Yes, up to the threshold | No | Yes |
| Records one above the threshold | Needs approval | No | Yes |
| Closes within tolerance | Yes | No | Yes |
| Closes over tolerance | Needs approval | No | Yes |
| Sees past shifts and reprints a Z | No (grantable) | No | Yes |

A technician holds none of these. They do not sell and they do not touch the drawer; a repair
they collect payment for is already gated by `repair.collect`, which needs an open shift the
same as any other collection.

---

## Acceptance criteria

Numbered Z1…Z28. Each is a thing that can be demonstrated on the running app or asserted in a
test; several are both.

### The shift record

**Z1 — A shift is open when it has no `closed_at`.** No status column exists. `shiftStatus()`
derives `open` / `closed` from the row's own facts, and no IPC channel accepts a status.

**Z2 — At most one open shift per till, enforced by the database.** A partial unique index on
`(terminal_id) WHERE closed_at IS NULL`. Two concurrent opens produce one shift and one
refusal, and the refusal is a typed error, not a constraint stack trace.

**Z3 — A shift belongs to the till, not the user.** Any cashier may sell into an open shift
regardless of who opened it. `opened_by_user_id` and `closed_by_user_id` record who counted;
neither restricts who may work.

**Z4 — Z numbers are gap-free per till.** Allocated by `allocateNumber()` from a
`number_series` row with `doc_type = 'shift'`, prefix `Z1-`, inside the close transaction.
The date shown beside the number is display only and carries no meaning.

### Opening

**Z5 — Opening prefills the default float from settings** and stores the counted figure.

**Z6 — The denomination helper computes, it does not merely record.** Quantities × values
show a live total; using the helper sets the float. A stored breakdown whose total does not
equal the stored float is refused at the domain boundary, so the two can never disagree in
the database.

**Z7 — A float of zero is legal** and needs no explanation. A shop that keeps its change in
the safe overnight starts at zero.

### Expected cash

**Z8 — One formula, one implementation.**

```
expected = opening_float
         + Σ documents in the shift: (Σ cash tenders) − max(0, Σ all tenders − total)
         + Σ cash movements in the shift whose reason moves notes
```

Both the X preview and the close call the same core function over the same rows.

**Z9 — Hand-computed scenarios agree with it**, each as its own test: float only · a cash sale
with change · a card-only sale (no effect) · a split card + cash sale · a store-credit voucher
larger than the ticket (drawer goes **down** by the change) · a repair deposit taken · that
deposit applied at collection (**no effect**) · a used-device cash payout · a used-device
payout by transfer (no effect) · a manual paid-in · a manual paid-out · all of the above in
one shift.

**Z10 — Non-cash tenders never move the drawer.** Card, Bizum, transfer, store credit used
*within* the ticket, and `deposit` contribute exactly zero.

**Z11 — `repair_deposit_applied` contributes zero.** It is bookkeeping (ADR-0015 §5). The
`DRAWER_EFFECT` map is total over `CASH_MOVEMENT_REASONS`, and a test asserts every reason
appears in it.

**Z12 — Sale cash is never written into `cash_movements`.** A test asserts that completing a
sale, a used purchase and a repair collection adds **no** row whose reason is a sale, and that
the reasons present after a full day are drawn only from the enum's non-sale set.

### Movements

**Z13 — Automatic rows are read-only here and linked to their document.** Used payouts, repair
deposits and refunds appear in the panel with a document link that opens the existing peek.
The Cash screen offers no way to edit or delete them.

**Z14 — A used-device cash payout is written inside the purchase transaction**, not by the
startup fix-up (ADR-0015 §6). The fix-up remains for historic rows, remains idempotent, and
reports zero for purchases made from v0.13.0 on.

**Z15 — Manual paid-in / paid-out require a concept.** Free text, with preset concepts from
settings offered as one-tap chips. Amount and concept both required.

**Z16 — A manual movement above the threshold setting runs the approval modal**, choosing the
permission per call from the payload amount — the same dynamic-permission shape
`repair:setLineCharge` already uses. Both actor and approver land on the oplog entry.

### X preview

**Z17 — X shows exactly what a close now would freeze**, because it is the same function.
Available at any time, commits nothing, allocates no number.

**Z18 — X is printable**, with the same renderer as the Z under a different heading and no Z
number, and prints `PREVIEW` where the Z prints its number.

**Z19 — Taking an X writes an oplog entry** naming who took it and when, with no shift row
written.

### Closing

**Z20 — Any non-zero variance requires a reason.** Empty or whitespace is refused with a
typed error against the field.

**Z21 — |variance| above tolerance requires approval.** Default tolerance 3,00 €. Refusal is
`APPROVAL_REQUIRED` naming `cash.close_over_tolerance`; the retry with an owner's PIN
completes in one call and stamps both people.

**Z22 — Close is one transaction.** Snapshot frozen, Z number allocated, `closed_at` stamped,
oplog written — all or nothing. A print failure afterwards never rolls it back.

**Z23 — Recompute equals the snapshot.** Immediately after a close, recomputing expected cash
from the rows produces the number in the snapshot.

**Z24 — A reprint renders the snapshot, not a recomputation.** A test changes underlying data
after the close (voids a voucher) and asserts the reprint is byte-identical apart from the
`COPIA` stamp.

**Z25 — Parked sales are counted and flagged, never blocking.** The close panel and the Z both
state the count; the button stays enabled.

**Z26 — A closed shift is immutable.** No channel reopens, edits or deletes one. The next cash
action requires a new shift.

### Enforcement and the Z report

**Z27 — Money needs an open shift, and the refusal is useful.** `sale:complete`, `used:log`,
`repair:collect`, `repair:create` *with a deposit*, `repair:markNotRepaired` *when it moves a
deposit*, `cash:paidIn` and `cash:paidOut` all fail with `SHIFT_REQUIRED` when none is open.
`stock:add`, catalogue work and a depositless repair intake all succeed, and stamp the shift
when one is open. A registry test pins the list.

**Z28 — The Z report says everything the shop needs and nothing it does not.** Shift number,
till, opened/closed by and when; per document series a count and first-to-last number (the
gap-free proof); net sales and VAT 21%; **used-device sales on their own line, with no VAT**,
because the margin scheme prints none (ADR-0007); tenders by type summing to gross;
non-sale movements summarised by kind with count and total; counts of used purchases and
repairs collected; float, expected, counted, variance with its sign named in words, reason and
approver. Refund and void lines are **absent**, not zero.

---

## Definition of done

1. Domain logic in `packages/core` with Vitest cases — `shiftStatus`, `documentCashDelta`,
   `computeShiftTotals`, `DRAWER_EFFECT`, the denomination constant and its total check.
2. IPC channels match `system-design.md` §4.4, every one through `guarded()`, registry test
   extended for both the permission and the shift precondition.
3. Oplog entries for open, close, both manual movement kinds, the X preview and every print.
4. Screens match `handoff/cash.md`, Spanish labels through `useT()`, one blue element per
   surface.
5. `pnpm test` green, `pnpm db:audit --verify` green with its four new checks, each proven to
   fail on deliberately tampered data.
6. Migration applied to a populated v0.12.0 database: old rows keep `shift_id = NULL`, the
   audit passes, the app boots and sells.
7. `pnpm build:win` produces an installer that launches.

## Risks and how this slice answers them

| Risk | Answer |
|---|---|
| The shop refuses to open a shift and the till becomes unusable | The refusal is a typed code the Sale screen turns into an inline "open one now" — one dialog, ten seconds, no screen change |
| A cashier closes with a big variance and a meaningless reason | The reason is required but cannot be validated for honesty. What the design guarantees instead: an owner's PIN above tolerance, and the reason on a printed, numbered, immutable document |
| Expected cash is wrong and nobody can tell | The formula is one tested function, and `db:audit` recomputes every closed shift against its snapshot on demand |
| The upgrade breaks a live till | Additive migration only; no backfill; old rows are honestly NULL; verified against a copy of the client's populated database before release |
| A long shift spans two days and the Z becomes meaningless | Non-blocking warning on the top-bar chip past 20 hours. The shop closes when it closes; the till nags, it does not decide |
