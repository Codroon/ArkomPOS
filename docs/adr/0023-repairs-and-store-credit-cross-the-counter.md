# ADR-0023: A repair and a voucher follow the customer, not the till

**Status:** Accepted · **Date:** 2026-10-06 · **Deciders:** Zothix (Codroon)

## Context

ADR-0022 gave a shop one catalogue and one stock ledger across its tills, and listed what it
deliberately left behind:

> Repairs and used purchases stay per-till. The phone is physically at one counter, and both
> carry data — passcodes, ID photographs — that ADR-0013 and ADR-0014 §10 keep local.

> `store_credit_voucher` — a voucher is a TENDER. Replicating one without a lock lets the same
> credit be spent at two counters, which is a loss, not a discrepancy.

Both of those are now reopened, on purpose, before the product is sold to anyone else. The
reasoning is not that the original worry was wrong — it was right — but that the thing it
protects is worth less than the thing it costs:

- A customer leaves a phone at the counter on the left and comes back on Thursday to the
  counter on the right. "You'll have to wait for the other till" is not a technical
  limitation to a shop, it is the software being stupid in front of a customer.
- A customer sells an old phone at one counter, takes store credit, and walks four feet to
  buy a case. Being told the credit only works at the other counter is worse than not
  offering credit at all.

Neither is hypothetical. A shop with two counters a metre apart has customers who do not know
which one they used last time, and will not be asked to remember.

### What is actually in the way

Not policy. Two foreign keys and one mutable number.

1. **`repair_tickets.document_id` is `NOT NULL REFERENCES documents(id)`.** Every ticket
   points at its `R-` custody receipt, and ADR-0022 §8 keeps documents per-till. So a ticket
   cannot land on a sibling till at all: SQLite refuses it, which is exactly what the inbox
   reported when this was tried.
2. **`store_credit_vouchers.purchase_id REFERENCES used_purchases(id)`.** A voucher from a
   used-device purchase points at a purchase that ADR-0022 §1 does not replicate — and will
   not, because it carries the seller's identity document.
3. **`store_credit_vouchers.remaining_cents` is a mutable balance.** ADR-0022 §7 resolves
   concurrent edits by last-writer-wins per field. Applied to a balance, that is not a
   conflict resolution, it is a money loss: two tills each redeem €20 of a €30 voucher, both
   write their own `remaining_cents`, and whichever arrives second is the shop's answer. The
   other €20 is simply gone from the record.

## Decision

### 1. A document id is a reference, not a foreign key

`repair_tickets.document_id` drops its constraint and keeps its value and its `NOT NULL`.
The id is always known; the ROW may live on another till.

This is not a new idea in this schema, it is the oldest one in it. `stock_movements.document_id`
has been a bare text column since ADR-0004 — "the sale that caused it, if any" — and that
decision, made four ADRs before anybody needed it, is the single reason stock replication was
nearly free in ADR-0022. `repair_tickets.collection_document_id` is already FK-less in the
same table, two columns down. So the rule being written down properly:

> **A document id on a non-document row is a reference, never a constraint.** Documents are
> per-till (ADR-0008, ADR-0015). Any row that points at one and is not itself a document must
> be able to exist on a till that does not hold it.

`store_credit_vouchers.purchase_id` drops its constraint for the same reason.

What is lost: SQLite no longer guarantees the pointed-at row exists. What is gained: the rows
can travel. `db:audit` picks up the slack — it already asserts stored state equals derived
state in four places, and gains one more for a dangling reference on the till that *should*
hold it.

### 2. A repair's facts replicate; its paperwork and its secrets do not

Added to `SHARED_ENTITIES`, in dependency order after `customer`:

| Entity | Why |
| --- | --- |
| `repair_ticket` | the device, the fault, the quote, the promise, the deposit |
| `repair_line` | parts and labour — already references shared products and suppliers |
| `repair_approval` | what the customer agreed to, and for how much |
| `repair_notification` | that somebody was called on Tuesday, so nobody calls twice |

Still not replicated, each for a reason that survives this ADR:

- **`repair_photo`** — files, not rows (ADR-0020 §3). The receiving till shows *"6 photographs,
  held at Till 1"*. Moving image files between tills is a different mechanism and is not
  smuggled in here.
- **`device_passcode`** — stripped by `redactForSync()` before the batch is queued, and it
  stays stripped (ADR-0014 §10). A customer's unlock code is theirs; it exists on the machine
  where they said it out loud and nowhere else. The receiving till's ficha says where it is.
- **the `R-` custody document** — per-till, by §1 above and ADR-0022 §8. A customer wanting
  a copy of their intake receipt gets it from the till that printed it.

**Status stays derived.** ADR-0014 §1 forbids assigning a repair's status, and nothing here
changes that: after a batch is absorbed, the receiving till recomputes `repairStatus()` from
the facts it now holds, exactly as it recomputes the stock cache from the movements. A status
on the wire would be the same mistake as a cached total on the wire.

### 3. Collection happens where the customer is, and the money lands there

A ticket taken in at till 1 can be collected at till 2. The `T1-` invoice is numbered from
**till 2's** series, inside **till 2's** shift, and the revenue is till 2's takings. That
follows ADR-0022 §8 without amendment and is the correct answer rather than a compromise:
the person who handed the phone over and took the money is at till 2, and their drawer should
balance.

**The deposit stays where it was paid.** A €20 deposit taken at till 1 is in till 1's drawer
and counted by till 1's Z. Till 2 collects the BALANCE, and the collection screen says so in
words rather than quietly subtracting. Each till's drawer is right, each Z is right, and the
shop's combined figures on the dashboard are right. Moving the cash would mean inventing a
transfer between two drawers that never happened.

### 4. A voucher's redemption is a ledger, not a balance

This is the substantive change, and it is ADR-0004 applied to money instead of stock.

`remaining_cents` stops being the truth and becomes a **cache**. The truth is a new
insert-only table:

```
voucher_redemptions(id, tenant_id, voucher_id, document_id, amount_cents,
                    terminal_id, user_id, created_at)
```

One row per time a voucher pays for something. It replicates. `remaining_cents` is recomputed
on every till as `amount_cents − sum(redemptions)`, in the same transaction, and `db:audit`
asserts the two agree — the same assertion it already makes about `product_stock`, for the
same reason, caught by the same command.

Why this and not the alternatives:

- **Asking the cloud before accepting** would mean a customer cannot spend their own credit
  when the shop's internet is down. That trades the one guarantee this product is built on
  for a rare event. Rejected.
- **Only redeemable at the issuing till** is the current behaviour and is the thing being
  fixed.
- **Replicating the mutable balance** loses money silently, per §3 of the Context.

A ledger makes a double redemption **arithmetically visible**: the sum exceeds the face value,
and that is a number, not a suspicion. Core rejects a redemption that would overdraw a voucher
it can see — the same guard, in the same place, as a negative on-hand (ADR-0004) — so this can
only happen when two tills act inside the replication window.

### 5. A double redemption is reported, not prevented

Deliberately symmetric with ADR-0022 §11 on overselling the last phone, and for the same
reason: preventing it needs a lock the counter would wait on.

What happens when it does: both sales stand, both customers leave with their goods, and the
voucher shows as overdrawn on the dashboard and in `db:audit`. The shop is out the
difference — bounded by the face value of one voucher, and visible the same day.

What makes this acceptable rather than lazy: a voucher is a piece of paper in one person's
hand. For this to happen that person must be served at two counters within a few seconds of
each other. Compare the alternative, which is every customer at every counter waiting on a
network round-trip before their credit is accepted.

**This is a decision about a bounded, visible, rare loss versus an unbounded, invisible,
constant cost.** It is the same trade the stock ledger already makes, and it should be
revisited together with that one or not at all.

## Consequences

**Good.** A customer collects their phone at either counter and spends their credit at either
counter, which is what a shop with two counters means by having two counters. Repair parts
already worked, because stock became shared in ADR-0022. The voucher ledger makes store credit
auditable for the first time — "where did this €30 go" has an answer with a date and a till on
it, which the mutable balance never had.

**Bad, and accepted.** Two foreign keys are gone and `db:audit` carries what they used to.
The photographs and the passcode stay on the intake till, so a technician working at the other
counter cannot see either — stated on screen rather than left to be discovered. A double
redemption is possible and bounded. The deposit sitting in one drawer while the balance lands
in another is correct but needs explaining to staff once.

**Not reopened.** Used purchases still do not replicate: the seller's identity document and
photographs are the point of that record, and an exported police register is a per-shop
obligation, not a per-till one. Documents still do not replicate. Shifts, series, drawers,
settings and PINs still do not.

## Compliance

- `SHARED_ENTITIES` gains the four repair entities in dependency order, and the test that
  pins the list is updated deliberately rather than relaxed.
- A test asserts a replicated ticket arrives with **no** `devicePasscode` key at all, and that
  the ficha on the receiving till says where it is held.
- `db:audit` gains: `remaining_cents` equals face value minus the redemption ledger; no
  voucher is overdrawn; no repair ticket on its OWN till points at a missing document.
- Two-till integration tests: a repair taken in at one till and collected at the other with
  the deposit deducted once; a voucher issued at one and spent at the other; and a voucher
  spent at both, asserting the overdraft is visible rather than silent.
- `pnpm db:truth && pnpm cloud:reconcile` covers vouchers and repair tickets.

## Supersedes

ADR-0022 §1's exclusion of repairs and store credit, and the parts of ADR-0013 and ADR-0014
that assumed a repair or a voucher belongs to one terminal. ADR-0014 §10 stands in full — the
passcode still never leaves the shop, and now also never leaves the till. ADR-0004's
insert-only ledger is not amended; it is extended to a second kind of value.
