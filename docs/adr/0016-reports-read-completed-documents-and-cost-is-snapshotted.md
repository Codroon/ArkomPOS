# ADR-0016: Reports read completed documents, and cost is snapshotted at sale

**Status:** Accepted · **Date:** 2026-09-02 · **Amended:** 2026-09-02 (v0.14.1) · **Deciders:** Zothix (Codroon)
**Extends ADR-0007** — the same reasoning, applied to cost instead of tax.

## Context

The till has recorded everything for five versions and reported nothing. The
shop's questions are ordinary and it cannot answer any of them: what did we take
this month, which products actually make money, how long is a repair taking, how
much cash is asleep on the shelf, what has not sold since spring.

Everything needed is already in the database. What does not exist is a way to ask
— and one thing that is genuinely missing, which this ADR settles before the
first report is written: **the till does not record what a product cost at the
moment it was sold.**

---

## 1. Reports read completed documents, dated by when the money moved

**Only `status = 'completed'`.** A draft is a ticket somebody is still building
and a parked sale is one nobody has paid for; counting either as revenue would
report money the shop does not have. There is no report anywhere in this slice
whose `WHERE` clause omits the status.

**Dated by `completed_at`, never `created_at`.** A draft can be opened before a
shift and charged after it — that is the inline-open flow ADR-0015 §9 built
deliberately — and a ticket parked on Monday and collected on Thursday is
Thursday's takings. `created_at` answers "when did someone start typing", which
is a question nobody asks about money. The audit check ADR-0015 added had to
learn this the hard way; the reports start with it.

**Reports never write.** The only writes this slice adds are the cost snapshot
below, on the existing sale path, and one setting. A report that mutated
anything would be a report that could not be run twice.

## 2. Cost is snapshotted on the line, exactly as tax is

`document_lines` today carries `tax_regime`, `tax_rate_bp`, `base_cents`,
`tax_cents` and `total_cents` — every input to the tax figure, frozen at the
moment of sale (ADR-0007). It carries **no cost at all**.

So today the only way to compute margin is to join the line back to
`products.cost_cents`, which is the *current* cost — the one that moved the last
time the shop received a delivery at a different price. A phone bought at 300 €
and sold at 380 € shows a 20 % margin until the next batch arrives at 340 €, at
which point the same historical sale silently reports 10 %. Last month's margin
changes because of something that happened this month. That is precisely the
failure ADR-0007 rejected for tax, and the answer is the same one.

**Decision: `document_lines.unit_cost_cents`, nullable, additive, written from
v0.14.0 on.**

Per unit, mirroring `unit_price_cents` beside it: a line's cost is
`unit_cost_cents × qty`, exactly as its revenue is `unit_price_cents × qty`. The
extended figure would have to be re-derived every time the stepper changes the
quantity, and recovering a per-unit cost by division is lossy.

Where the figure comes from, at the moment the line is created:

| Line | Cost |
|---|---|
| A serialized unit (new or used) | `units.cost_cents` — for a used device that is buy + refurb, already computed at intake (ADR-0013) |
| A stocked product | `products.cost_cents`, the last known cost |
| A repair collection's part line | the part's own `unit_cost_cents`, itself already a snapshot (ADR-0014) |
| A repair collection's labour line | zero — the shop's own time is not a cost this till tracks |

**Nullable, and NULL means something.** A `NOT NULL DEFAULT 0` column would make
every sale before v0.14.0 look like pure profit, which is worse than useless —
it is a plausible wrong number. NULL means "this line was written before the
till recorded cost", and the report says so:

> **Historical rows report the product's current cost, explicitly flagged as
> estimated. Never silently.**

**Amended v0.14.1 — they report nothing at all instead.** A row containing any
unsnapshotted line shows `—` for cost, margin and margin %, and contributes to
no total. The original rule produced a figure that was part measurement and part
guess, and margin figures get acted on: a shop repricing a line because it shows
−66,9 % would be reacting to last week's purchase invoice, not to the sale. The
count is still on the response and the caption still names it, so the gap is
visible rather than silent — which was always the point. Revenue is unaffected;
only the cost side declines to answer.

Backfilling remains wrong for the same reason it always was: it would write
today's cost into yesterday's line and destroy the distinction entirely.

## 3. Aggregation is SQL in main, and the renderer receives shaped rows

Every report is a SQL aggregate — `GROUP BY`, `SUM`, `COUNT` — executed in the
main process, returning rows already in the shape the table renders.

The alternative is shipping the underlying documents over IPC and summing them
in the renderer. Rejected on three counts, in order of how much they matter:

1. **It would be a second implementation of the money.** Totals computed in the
   renderer would drift from the ones computed for the Z, the ticket and the
   audit, and the drift would be invisible.
2. It would send thousands of rows across the bridge to display twenty.
3. It puts business arithmetic in the layer `system-design.md` §2 says must not
   contain it.

SQLite does this work in single-digit milliseconds on a shop's volume. The
performance criterion is a generated set of 10,000 completed documents with every
report under one second, and the indexes to make that true are part of this
slice, not a later optimisation.

## 4. One guarded channel per report, plus one export

`reports:hub` · `reports:sales` · `reports:repairs` · `reports:used` ·
`reports:valuation` · `reports:deadStock` · `reports:export`.

Not one `reports:run` channel with a discriminated union: each report has its own
filters, its own row shape and — the deciding reason — its own permission. A
single channel would resolve the permission from the payload, which is the
pattern the registry test exists to prevent.

**Export takes the same filters and re-runs the same query**, rather than
receiving rows from the renderer to write out. A renderer that supplies the rows
could supply different ones from those on screen, and the file the accountant
opens must be the report the shop looked at.

## 5. No global period. Each report owns its filters

A period selector in the header is the obvious design and it is wrong here: three
of the five reports are **positions, not periods**. Inventory valuation, used
device holding and dead stock all answer "right now", and a date range on the
header would either grey out unpredictably or, worse, imply that valuation as of
last Tuesday is available. It is not (out of scope, deliberately).

So the two period reports carry their own range with presets, and the three
position reports state *now* on the card and in the header.

**Filters are remembered for the session, in the renderer, and not persisted.**
An owner who sets Sales to last month, drills into a ticket and comes back should
find last month still selected. Tomorrow they should find the default, because a
report that silently opens on a stale period is how a shop reads the wrong month
and believes it.

## 6. CSV is written for the accountant's Excel, not for a parser

Semicolon separator · decimal comma · dates `dd/mm/yyyy` · **UTF-8 with a BOM** ·
CRLF line endings.

Every one of those is for the same reason: the file has to open correctly when
somebody double-clicks it on a Spanish Windows. A comma separator makes Excel put
the whole row in column A; a decimal point makes it read 1234,56 as text; no BOM
makes it mangle every accent in the shop's own product names. This is not the
standard the RFC describes and it is the standard the recipient uses.

A save dialog, so the file lands where the person putting it in an email expects
it, defaulting to `<informe>-<yyyy-mm-dd>.csv`.

## 7. Permissions: seeing the shop, and seeing what it costs

Two keys, both owner-only by default and both grantable:

- **`reports.view`** — the hub, the Sales report without its cost columns, and
  the Repairs *Open* tab. This is the operational view: what sold, what is on the
  bench, what is late.
- **`reports.costs`** — margin columns, inventory valuation, used-device holding
  cost, dead stock, and the Repairs *Closed* tab. This is the shop's buying
  position and its profit, which is a different thing to know.

A cashier and a technician hold neither. The split is not paranoia about staff:
it is that "how many repairs are late" is a question a senior technician should
be able to answer for themselves, and "what margin do we make on screens" is not
a question the shop needs to answer to anybody.

**The gate is the handler.** A Sales response for a caller without
`reports.costs` omits the cost, margin and margin-percent fields entirely rather
than sending them for the UI to hide, and the export refuses the same columns.

## 8. Reports must agree with the figures the shop already trusts

A report that disagrees with the screen beside it is worse than no report,
because it makes both suspect. Four cross-checks, each a test:

| Report | Must equal |
|---|---|
| Sales, filtered to one closed shift | that shift's frozen Z snapshot (ADR-0015 §7) |
| Inventory valuation total | the Inventory screen's header total, to the cent |
| Repairs closed revenue | Σ of the repair collection documents in the period |
| Used holding cost | Σ of the held units' own costs |

And one structural check per report: **every grouping's total equals the
ungrouped total.** A group-by that loses a row is the most common reporting bug
there is, and the only one that looks completely plausible on screen.

## 9. What is deliberately not here

**Margin on sold used devices** is a genuine report and it is not in this slice:
it needs the purchase, the refurbishment and the sale joined across three
modules, and it deserves its own design rather than a sixth card written in a
hurry. **Seam, not built** — `document_lines.cost_cents` on a used unit's sale
line is exactly the figure it will need, and this slice puts it there.

Also out: agency and commission reporting, cash variance by user, overrides by
user, charts, printing a report, valuation as of a past date, and anything
scheduled or emailed (Phase 2).

---

## Options considered

**Joining live product cost at report time** — rejected in §2. It makes last
month's margin depend on this month's purchasing.

**Backfilling `unit_cost_cents` from current cost** — rejected in §2. It writes a
guess as though it were a fact and destroys the flag that says so.

**`NOT NULL DEFAULT 0`** — rejected. Reports every historical sale as pure profit.

**Aggregating in the renderer** — rejected in §3. A second implementation of the
money.

**One `reports:run` channel** — rejected in §4. Resolves permission from payload.

**A global period selector** — rejected in §5. Three of five reports are
positions.

**Standard RFC-4180 CSV** — rejected in §6. Correct, and unopenable by the person
it is for.

## Consequences

**Easier.** Every report is one query with one test that ties it to a figure the
shop already believes. Margin becomes a real number rather than one that changes
retroactively. The used-device margin report gets its hardest input for free.

**Harder.** The sale, used-device and repair-collection paths each gain a cost
lookup — three call sites, all covered. Cost-bearing responses have to omit
fields rather than blank them, so the row types are permission-dependent.

**Accepted.** For some months the shop's margin figures will be part estimate,
and the reports will say so on every screen and in every export. That is the
honest state of a till that started recording cost in September, and pretending
otherwise was the alternative.
