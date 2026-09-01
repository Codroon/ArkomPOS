# Arkom POS — Reports slice (Informes)

Status: **Stage B — building** · Target: **v0.14.0** · Owner: Zothix (Codroon)
Companions: [`ADR-0016`](../adr/0016-reports-read-completed-documents-and-cost-is-snapshotted.md)
(decisions) · [`system-design.md`](../design/system-design.md) (schema + IPC) ·
[`handoff/reports.md`](../design/handoff/reports.md) (screens).
This spec defines **what "done" means**.

## Problem statement

The till has recorded every sale, purchase, repair and euro for five versions and
can answer no question about any of them. The owner's questions are ordinary:

1. **What did we take this month, and how much of it is tax?** Today the answer
   is a stack of Z reports and a calculator, or a guess.
2. **Which products actually make money?** Unanswerable, because the till has
   never recorded what a product cost at the moment it was sold — only what it
   costs now.
3. **How long are repairs taking, and how much did they earn?** The board shows
   what is on the bench today and forgets everything that leaves it.
4. **How much cash is asleep?** Phones bought and not yet shelved, stock valued
   at cost, and products that have not sold since spring are all invisible.

The consequence is a shop run on the feeling of a good week. This slice makes the
data the till already holds answerable, and fixes the one thing genuinely missing
— cost at the time of sale — before the first margin figure is ever printed.

## Goals

1. Five questions answered in one click each, from the data already recorded.
2. **Margin that does not change retroactively**, and says so wherever it is
   still an estimate.
3. Every report **agrees to the cent** with the figure the shop already trusts —
   the Z, the Inventory header, the collection documents.
4. Any report leaves the till as a CSV the accountant can double-click.
5. Cost is a permission, not a screen: the operational view and the money view
   are different things to be allowed to see.
6. Nothing here writes, so any report can be run twice.

## Non-goals (this slice)

Margin on **sold** used devices — a real report, needing purchase + refurb + sale
joined across three modules; **seam, not built**, and `cost_cents` on the sale
line is the input it will want · agency / Western Union commission · cash
variance by user · discounts and overrides by user · charts of any kind · PDF or
thermal printing of a report · valuation as of a past date · scheduled or emailed
reports (Phase 2 cloud) · a global period selector (ADR-0016 §5).

## Personas

| | Cashier | Technician | Owner |
|---|---|---|---|
| Sees the Informes menu item | No (grantable) | No (grantable) | Yes |
| Sales without cost columns | With `reports.view` | With `reports.view` | Yes |
| Repairs · Open tab | With `reports.view` | With `reports.view` | Yes |
| Margin, valuation, holding cost, dead stock, Repairs · Closed | With `reports.costs` | With `reports.costs` | Yes |
| Exports a report | Whatever they can see | Whatever they can see | Yes |

---

## Acceptance criteria

### Foundations

**RP1 — Completed documents only.** No report counts a draft or a parked sale.
A parked ticket worth 500 € changes no figure on any screen in this slice.

**RP2 — Dated by `completed_at`.** A draft started before a period and charged
inside it belongs to the period it was charged in, and vice versa.

**RP3 — Cost is snapshotted on every new sale line.** `document_lines.cost_cents`
is written at completion from the unit, the product or the repair part, for
ordinary sales, used-device sales and repair collections alike.

**RP4 — Historical rows are estimated, and never silently.** A line with
`cost_cents IS NULL` reports the product's **current** cost, is flagged in the
row, counted in the response, captioned on screen and marked in the CSV.

**RP5 — Aggregation happens in SQL.** No report ships rows for the renderer to
sum. A test asserts each response is already aggregated.

**RP6 — One guarded channel per report.** Registered through `guarded()`, pinned
by the registry test, each with its own permission.

**RP7 — Cost fields are omitted, not hidden.** A caller without `reports.costs`
receives responses with no cost, margin or margin-percent fields at all, and an
export that contains no such columns.

**RP8 — Reports never write.** Running every report twice changes no row and adds
no oplog entry.

### The hub

**RP9 — Five cards, five headline numbers, each with its window on the card.**
Sales (net, this month) · Repairs (open now · overdue) · Used holding (units ·
cost, now) · Valuation (at cost, now) · Dead stock (products, now).

**RP10 — The hub is cheap.** One channel, five aggregates, under one second on
the 10,000-document dataset. Cards a caller cannot open are not rendered.

### Sales

**RP11 — Filters:** date range with presets (today, yesterday, this week, this
month, last month, custom) and a shift picker by Z number.

**RP12 — Summary strip:** tickets, net, VAT, gross, average ticket, and
**margin-scheme sales on their own line** because they carry no VAT.

**RP13 — Five groupings:** day, product group, product, user, payment method.
**Every grouping's total equals the ungrouped total.**

**RP14 — Grouping by product adds** quantity, revenue, cost, margin € and margin
%, all behind `reports.costs`.

**RP15 — Repair collections appear as sales**, grouped under their own product
group, because a `T1-` created at hand-back is an invoice like any other.

**RP16 — Every row drills down** — a day or a user to its tickets, a product to
its lines — through the existing peeks.

**RP17 — This is the tax report.** Net, VAT and gross per period, with the margin
scheme separated. There is no second one.

**RP18 — Sales for one closed shift equals that shift's Z snapshot** — tickets,
net, VAT and gross.

### Repairs

**RP19 — Open tab:** every open ticket with number, customer, device, status,
days in status, days since intake, technician, promised slot and an overdue flag;
filters by status and technician.

**RP20 — Open summary:** open count, overdue count, **quoted (waiting on the
customer) count highlighted**, and the oldest ticket.

**RP21 — Closed tab:** date-range presets; collected count, revenue, parts cost,
labour, margin, average turnaround from intake to collection, and the
not-repaired count broken down by reason.

**RP22 — Optional grouping by technician** on the closed tab.

**RP23 — Closed revenue equals Σ of the repair collection documents** in the
period.

**RP24 — Rows drill to the repair page.** The board stays the live view; this is
history and money.

### Used device holding

**RP25 — Now, not a period:** units by status (held, needs review, in stock) with
count and cost tied up (buy + refurb).

**RP26 — Per-unit table** — number, model, grade, status, cost, sale price if
set, days held — **oldest first**; filters by status and grade.

**RP27 — Store credit outstanding** as one summary figure: unredeemed voucher
count and total.

**RP28 — Holding cost equals Σ of the held units' own costs.**

**RP29 — Rows drill to the used device detail.**

### Inventory valuation

**RP30 — Now:** total at cost, a by-group table (quantity, value) and a
per-product table (product, group, on hand, unit cost, value); filter by group.

**RP31 — Serialized units at their own cost**, and used units in stock at buy +
refurb — which is the same figure, because that is what `units.cost_cents` holds.

**RP32 — The total equals the Inventory screen's header total, to the cent.**
A test, not a hope.

### Dead stock

**RP33 — Products with on-hand above zero and no completed sale line in the last
N days**, N a setting defaulting to 90 and owner-editable.

**RP34 — Columns:** product, group, quantity, cost tied up, last sale date or
*nunca*, days since. **Sorted by cost tied up**, descending. Filter by group.

**RP35 — The boundary is inclusive:** a product last sold exactly N days ago is
dead. A test pins both sides of it.

**RP36 — Used units are excluded** — the holding report covers them.

### Export

**RP37 — Every report exports its current filtered view** through a save dialog,
by re-running the same query rather than serialising what the renderer holds.

**RP38 — The bytes are right for Spanish Excel:** UTF-8 BOM, semicolon
separator, decimal comma, `dd/mm/yyyy`, CRLF. Verified as bytes, not as a string.

### Everywhere

**RP39 — An empty state for every report and every filter combination**, saying
which filter produced nothing rather than showing an empty table.

**RP40 — Spanish throughout**, through the typed dictionary, consistent with the
existing screens.

**RP41 — Performance:** on ≥ 10,000 completed documents, the hub and all five
reports each return in under one second.

**RP42 — Migration on a populated v0.13.0 database** applies cleanly, old lines
keep `cost_cents = NULL`, and the audit stays green.

---

## Definition of done

1. Query layer and CSV writer in the right places, with Vitest cases — pure
   formatting and shaping in `packages/core`, SQL in `apps/desktop/main/repos`.
2. IPC channels match `system-design.md` §4.5, every one through `guarded()`,
   registry test extended.
3. No new oplog entries from any read path; the cost snapshot rides on writes
   that already log.
4. Screens match `handoff/reports.md`, Spanish through `useT()`, one blue element
   per surface.
5. `pnpm test` green, `pnpm db:audit --verify` green, the four cross-checks and
   the performance case among the tests.
6. `pnpm build:win` produces an installer that launches.

## Risks and how this slice answers them

| Risk | Answer |
|---|---|
| Margin figures are believed, then found to be estimates | The flag is in the row, the response, the screen caption and the CSV. It is impossible to export a margin without exporting whether it was estimated |
| A report disagrees with the Z or the Inventory header | Four cross-check tests, each tying a report to a figure the shop already trusts |
| A group-by silently loses rows | Every grouping is tested against the ungrouped total |
| The CSV opens as one column in Excel | The bytes are asserted, including the BOM |
| Reports get slow as the shop grows | A 10,000-document dataset is part of the suite, with the indexes to pass it |
