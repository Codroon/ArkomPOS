# ADR-0018 — Transfers are a shadow log, and the principal is never revenue

**Status:** Accepted (v0.15.0)

## Context

Ahmer runs a Western Union counter beside the till, on WU's own terminal. There is no API and
no prospect of one. WU is the system of record; this app cannot be, and must not pretend to be.

But the money is real and it is in the same drawer as the shop's takings. A €900 send makes the
till €900 heavy for reasons no sales figure explains, and at closing time somebody has to be
able to say why. So the till keeps a **shadow log**: what the WU terminal did, recorded here so
the drawer, the Z and next round's reconciliation import have something to agree with.

## Decision

### 1. The principal is pass-through, and everything follows from that

Money taken for a send is not the shop's money — it is WU's, held for a few seconds. So a
transfer:

- issues **no document**. No `T1-`, no series, no number consumed.
- carries **no VAT**. There is no taxable base, because there is no supply.
- appears in **no sales figure**. Not gross, not net, not a report's revenue column.

The shop's actual income from the counter is WU's commission settlement, which arrives monthly
and is not visible from here. The **fee** is recorded because the customer paid it and it
entered the drawer, not because it is revenue this app can recognise.

### 2. The drawer contract

Through `cash_movements` and the same `DRAWER_EFFECT` map every other non-sale cash event uses
(ADR-0015 §3) — so expected cash needs no special case to stay right.

| Event | Notes | Reason |
|---|---|---|
| Cash send | **in**, principal **+ fee** | `transfer_send` |
| Card send | **no movement row at all** | — |
| Payout | **out**, principal only | `transfer_payout` |
| Cancel | the exact reversal, signed | `transfer_cancel` |

A card send writes nothing, rather than a row worth zero: a zero-value row in the drawer ledger
is a row every later query has to remember to skip. It is still recorded in `transfers`, so the
Z reports it and the card statement can be ticked off.

A payout gives the principal only. WU's fee was charged at the sending end, in another country.

### 3. Cancel returns the full amount, in today's shift

WU refunds **everything** on a cancel, fee included. A shop that kept the fee would be short at
the count with no way to explain it.

The reversal is posted in the **current** shift, never the original's. A closed shift is frozen
and its Z is evidence (ADR-0015 §8) — the money genuinely did come in yesterday. Today gives it
back, and the row records both: `shift_id` for the original, `cancel_shift_id` for the reversal.

A second cancel is impossible: the status guard refuses it, because paying the refund twice is
the failure this exists to prevent. Cancel is **approvable** — it is the one transfer action
that hands back money already out of the drawer.

### 4. The MTCN is the shared key, and it is unique

Ten digits, unique per tenant by index. It is the only identifier this app and WU's export both
hold, which is what will let an imported cancellation find the send it cancels without inventing
a second key.

A duplicate is not an argument to be won: it is how a double-entry happens at a busy counter, so
the answer names **the record that already exists** rather than being a constraint violation.
MTCNs normalise at the contract boundary — WU prints them in groups, so an operator copying one
types spaces or dashes, and `987-654 3210` logged beside `9876543210` is one transfer logged
twice.

### 5. A payout bigger than the drawer warns; it does not refuse

The customer is at the counter with ID and WU has already authorised the payment; the shop may
have a second cash box the till knows nothing about. So the till says what it knows — expected
cash, and the amount asked for — and lets a human decide. Going ahead writes an oplog entry,
because that is exactly the entry somebody wants when the count comes up odd.

### 6. Built for the import, and no further

Next round reads WU's reconciliation CSV. Built for it **only** this far: MTCN unique, the three
statuses `sent` / `paid` / `cancelled`, and a cancellation reachable from its original. Nothing
else is speculative — no partner tables, no settlement model, no fee schedule.

## Consequences

**Easier.** The drawer is right without knowing what a transfer is. The Z explains a heavy till
in a block of its own. Reconciliation has a key to join on.

**Harder.** A second place records money, and it is not the system of record — a discrepancy
with WU's export means the log is wrong, not the money. That is what next round's import is for.

**Accepted.** The Z's transfers block is optional in `ShiftTotals`, so a snapshot frozen before
v0.15.0 carries no such key and prints exactly what it printed then. Snapshot v2 is additive;
there is no migration of frozen Z reports and there must never be one.
