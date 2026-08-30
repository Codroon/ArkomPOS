# Arkom POS — Repairs slice (Reparaciones · Taller · Técnico)

Status: **Stage B — building** · Target: **v0.12.0** · Owner: Zothix (Codroon)
Companions: [`ADR-0014`](../adr/0014-repair-tickets-status-from-facts-and-parts-before-revenue.md)
(decisions) · [`system-design.md`](../design/system-design.md) (schema + IPC) ·
[`handoff/repairs.md`](../design/handoff/repairs.md) (screens).
This spec defines **what "done" means**.

## Problem statement

Repairs are the shop's most profitable work and its least recorded. A device arrives, a
docket is written by hand, a price is agreed out loud, a screen comes off the shelf that
inventory never hears about, and three days later somebody tries to remember what was
promised and for how much. Four consequences: the count is wrong from the first repair of
the day, the margin on a job is unknowable, a customer dispute is one person's memory
against another's, and the paperwork Spanish law requires — a receipt on intake, an
approved estimate before chargeable work, a warranty — does not exist in any retrievable
form.

This slice makes a repair something the till performs: a numbered ticket with a printed
intake receipt, a quote the customer approves, parts that move stock when they move, a
board the workshop can work from, and a collection that charges through the same machinery
as every other sale.

## Goals

1. A device is taken in in under three minutes, ending with a printed receipt the customer
   keeps and a photo record of what it looked like.
2. **No status can be claimed without the fact that entails it.** The board reflects
   reality or refuses the move, and says which fact is missing.
3. The shelf is right the moment a part is taken, and every consumed part traces back to
   the ticket that consumed it.
4. Nothing is booked as income until someone pays; a ticket never collected leaves costs
   recorded and revenue absent.
5. A technician can work the board and nothing else, with no change to the Users screen.
6. Every price the customer was told, and every approval they gave, is on the record with
   who took it and when.

## Non-goals (this slice)

Appointment/slot calendar and walk-in bench · WhatsApp or any online notification (the log
is shaped for a Phase 2 sender; nothing leaves the till) · supplier module · warranty-claim
tracking · technician commissions · serialized parts · abandoned-device disposal (the
reason is captured, the process is not) · customer management screen · linking used-purchase
sellers to customers · shifts, float and the Z report that will read `cash_movements`.

## Personas

| | Cashier (**Cajero**) | Technician (**Técnico**) | Owner (**Responsable**) |
|---|---|---|---|
| Takes a device in | Yes — counter work | No | Yes |
| Sets/edits the quote | Yes | Yes | Yes |
| Records the customer's approval | Yes | No | Yes |
| Adds and removes parts | Yes | Yes | Yes |
| Receives an ordered part (stock-in) | Yes | **No** | Yes |
| Assigns a technician | Yes | No | Yes |
| Marks ready | Yes | Yes | Yes |
| Takes the collection payment | Yes | No | Yes |
| Marks Not repaired | Needs approval | No | Yes |
| Sees the board | Yes | Yes | Yes |

## User stories

- As a cashier, a customer leaves a cracked iPhone; I fill one screen, take a 20 € deposit,
  and hand them a receipt that says what I took, what state it was in, and what we will do.
- As a technician, I open the board, see what is mine and what is overdue, and take a
  screen from the drawer — the count drops as I do it.
- As a cashier, the customer approves 79 € on the phone; I record that, and the ticket
  moves itself to *En reparación*.
- As a technician, the part I need is not here; I add it as an ordered part and the ticket
  moves itself to *Esperando pieza* without me choosing anything.
- As an owner, I open Parts-to-order every morning and see exactly what to buy, for whom,
  and how long each one has been waiting.
- As a cashier, the customer collects; the deposit comes off automatically and they pay the
  rest by card, and they get a normal ticket with the warranty date on it.
- As an owner, the phone could not be fixed; the till makes me resolve the screen I already
  consumed before it will let me close the ticket.

---

## Acceptance criteria

### R. Data and migration

- [ ] **R1** `customers`: name, phone, `phone_normalized`, note, timestamps. Find-or-create
      at intake, deduped on `phone_normalized` (digits only, national prefix stripped).
- [ ] **R2** `repair_tickets` (1:1 with a `repair` document): customer, device description,
      IMEI (nullable), reported fault, condition at intake, damage flags (screen cracked /
      back cracked / dents / water indicator) + free text, **passcode**, accessories,
      promised date + half (`morning`/`afternoon`), assigned user, deposit, authorized cap,
      `diagnosis_fee_cents` snapshot, warranty months snapshot, `ready_at`,
      `not_repaired_at` + reason, `collection_document_id`, cached `status`.
- [ ] **R3** `repair_lines`: kind (`inventory_part` / `labor` / `part_on_order`), product
      ref (nullable), description, qty, cost snapshot, charge, and for ordered parts:
      supplier text, expected cost, ordered date, received-at.
- [ ] **R4** `repair_approvals`: method (`in_person`/`by_phone`), approved total, actor,
      timestamp. **Rows, not a flag** — a re-approval keeps both.
- [ ] **R5** `repair_notifications`: method (`phone`/`in_person`/`other`), note, actor,
      timestamp. Repeatable. Nothing is sent.
- [ ] **R6** `cash_movements`: signed amount, reason (`repair_deposit`/`repair_refund`),
      document and ticket refs, actor, timestamp.
- [ ] **R7** Enums gain `documents.doc_type += 'repair'` and
      `document_tenders.method += 'deposit'` as TypeScript-only changes (no CHECK
      constraint exists). `MOVEMENT_TYPES.repair_part_out` and `LINE_TYPES.repair` are
      already parked and are now used.
- [ ] **R8** A `repair` number series per till, prefix `R-`, allocated gap-free inside the
      finalising transaction (ADR-0008), created on demand like the `C-` series.
- [ ] **R9** Migration runs on a **populated v0.11.0 database**: row counts unchanged,
      existing sales/purchases/vouchers untouched, `db:audit --verify` green.

### S. The status machine

- [ ] **S1** `repairStatus()` is a pure function in core returning one of: Recibido,
      Presupuestado, Esperando pieza, En reparación, Listo, Entregado, No reparado.
- [ ] **S2** **No handler accepts a status.** Every transition is a consequence of
      recording a fact.
- [ ] **S3** Presupuestado requires ≥ 1 quote line.
- [ ] **S4** En reparación requires work authorized: a recorded approval whose total ≥ the
      quote total, **or** an intake cap ≥ the quote total.
- [ ] **S5** Esperando pieza whenever ≥ 1 `part_on_order` line is open and work is
      authorized; it returns to En reparación when the last one is received or removed —
      **derived, never toggled**.
- [ ] **S6** A quote increase above the approved total (or above the cap) drops the ticket
      back to Presupuestado; both approvals remain on the record.
- [ ] **S7** Listo requires `ready_at`; Entregado requires a collection document;
      No reparado requires a timestamp **and** a reason.
- [ ] **S8** The stored `status` column equals the derived value for every ticket, written
      in the same transaction as the fact that moved it, and **`db:audit` checks it**.
- [ ] **S9** Board drag and the detail buttons go through the same guard; a refused drag
      shows the missing fact in words, and the card returns to its column.

### T. Intake

- [ ] **T1** Customer find-or-create with phone dedupe; editable inline.
- [ ] **T2** Device description, IMEI (same `isValidImei`, **empty allowed** — not every
      device has one), reported fault, condition, damage checklist + free text, accessories.
- [ ] **T3** Photos through the used-slice component (upload **and** capture), stored under
      `photos/repairs/<ticket-id>/`; the backup's photos root already covers it —
      **verified, not assumed**.
- [ ] **T4** Optional deposit: posts a `cash_movements` row and is recorded on the ticket.
- [ ] **T5** Optional signed repair-up-to-cap authorization with an amount.
- [ ] **T6** Intake prints the deposit/intake receipt: shop header, `R-` number, customer,
      device + IMEI, fault, condition + damage marks, accessories, deposit, cap if
      authorized, diagnosis fee **only if the snapshot is non-zero**, warranty statement,
      signature line.
- [ ] **T7** With no printer configured the receipt is saved as a PDF with an *Abrir*
      button, never silently lost (the v0.11.0 lesson).

### Q. Quote, approval, parts

- [ ] **Q1** Quote lines: inventory part, labor, part on order. Charge editable per line;
      cost snapshotted; per-line and ticket margin shown.
- [ ] **Q2** Recording an approval captures method, timestamp, actor and **the approved
      total**.
- [ ] **Q3** A printable quote document exists for an in-person signature.
- [ ] **Q4** Declining → No reparado (customer declined). The diagnosis fee may be charged
      at hand-back **only if it was announced** (R2 snapshot non-zero).
- [ ] **Q5** Adding an inventory part posts **exactly one** `repair_part_out` movement
      immediately, carrying the repair document's id.
- [ ] **Q6** Removing that line posts the **exact reversal** — a second movement, never a
      deletion (ADR-0004).
- [ ] **Q7** A `part_on_order` line has **zero** stock effect until received.
- [ ] **Q8** *Received* runs the existing stock-entry flow (find-or-create product,
      stock-in at the real cost), then converts the line to an inventory part and posts its
      consumption. Net effect: one stock-in, one consumption.
- [ ] **Q9** Parts-to-order view aggregates every open ordered line across tickets: part,
      ticket, customer, promised date, expected cost, days waiting.
- [ ] **Q10** Serialized parts are refused with a clear message — quantity parts only.

### W. Screens

- [ ] **W1** Repairs list: number, customer, device, status chip, technician, promised,
      days open; filters by status and technician; search by ticket number, customer,
      phone, IMEI or device.
- [ ] **W2** Ticket detail: intake block (passcode masked, tap to reveal), photos, quote
      with margins, parts, approvals history, notifications log, management block
      (technician, deposit, warranty, promised), and the actions the facts allow.
- [ ] **W3** Workshop board: seven columns (terminal ones collapsible), cards showing
      number, device, fault one-liner, technician, days in status, promised; header counts.
- [ ] **W4** Overdue (promised in the past and not Listo/Entregado/No reparado) is visibly
      flagged on both list and board.
- [ ] **W5** Unassigned is a visible state, not a blank.
- [ ] **W6** Parts-to-order is a tab on Repairs.
- [ ] **W7** Both nav entries unlock: `06 Reparaciones`, `07 Taller`.

### H. Hand-back

- [ ] **H1** On Listo, a *customer notified* action records method + optional note with the
      actor; repeatable; every entry visible on the ticket.
- [ ] **H2** Collection dialog reuses the existing tender components; **the deposit is
      applied automatically as a `deposit` tender**, not as a discount.
- [ ] **H3** The remainder is payable by cash / card / Bizum / transfer / store credit with
      the existing change rules; a zero remainder completes with no further tender.
- [ ] **H4** Collection produces the fiscal document: `doc_type = "ticket"` in the till's
      existing series, IVA21-snapshotted lines for parts and labor **as charged**.
- [ ] **H5** The final receipt prints: work performed, parts, device + IMEI, warranty end
      date, and the payments including the deposit.
- [ ] **H6** No reparado requires **every consumed inventory part to be resolved first** —
      each line either removed (reversal posted) or kept-and-charged.
- [ ] **H7** The return document prints: device returned, reason, and the diagnosis fee
      only if it was announced.
- [ ] **H8** The deposit is either refunded (a `cash_movements` row out) or absorbed into
      the fee, and which one happened is on the document and in the oplog.

### P. Permissions

- [ ] **P1** New registry keys with these defaults (thirteen — `repair.price_override` was added by the Stage B call that replaced `release_without_payment`):

| Key | Module | Cashier | Technician | Approvable |
|---|---|---|---|---|
| `repair.view` | repair | ✅ | ✅ | — |
| `repair.create` | repair | ✅ | ❌ | — |
| `repair.edit` | repair | ✅ | ✅ | — |
| `repair.quote.set` | repair | ✅ | ✅ | — |
| `repair.quote.approve` | repair | ✅ | ❌ | — |
| `repair.parts.manage` | repair | ✅ | ✅ | — |
| `repair.parts.receive` | repair | ✅ | **❌** | — |
| `repair.assign` | repair | ✅ | ❌ | — |
| `repair.markReady` | repair | ✅ | ✅ | — |
| `repair.collect` | repair | ✅ | ❌ | — |
| `repair.price_override` | repair | ❌ | ❌ | ✅ |
| `repair.markNotRepaired` | repair | ❌ | ❌ | ✅ |
| `workshop.view` | workshop | ✅ | ✅ | — |

- [ ] **P2** `technician` is added to `ROLES` with its default set, and the Users screen
      picks up the role **and** all twelve keys with **zero changes to that file**. The
      Stage B report states plainly whether that held.
- [ ] **P3** Every new channel is registered through `guarded()`; the registry test passes.
- [ ] **P4** Each key has `perm.<key>` in both dictionaries and `role.technician` in both;
      the label-coherence test covers them and asserts the two locales differ.

### V. Privacy

- [ ] **V1** The passcode appears in **no** print payload — intake, quote, final receipt or
      return document.
- [ ] **V2** The passcode appears in **no** oplog payload. Ticket changes record it as
      present/absent only.
- [ ] **V3** The passcode appears in **no** log line.
- [ ] **V4** A grep-style test asserts V1–V3 over real rendered output and real oplog rows,
      in the shape of the used-slice photo test.
- [ ] **V5** The UI masks it by default and reveals on tap.

### B. Settings and backup

- [ ] **B1** Owner-editable settings, all landing as data: warranty months (default 3),
      diagnosis fee (default 0 = none), default deposit suggestion (default 0), repair-cap
      authorization enabled (default on).
- [ ] **B2** Warranty months and diagnosis fee are **snapshotted onto the ticket at
      intake**; changing the setting never reaches back.
- [ ] **B3** Backup needs **no change** — `photos/repairs/…` sits under the photos root the
      backup already copies. **Verified with a repair photo present**, and DEPLOYMENT.md
      says so explicitly rather than leaving it to be assumed.

---

## Test plan (Vitest)

| Area | Test |
|---|---|
| Status | every transition's facts enforced; no handler accepts a status |
| Status | approval-total path AND cap path both authorize En reparación |
| Status | quote rise above the approved total falls back to Presupuestado; both approvals kept |
| Status | Esperando pieza appears and clears from open ordered lines alone |
| Status | stored status == derived status, asserted by `db:audit` |
| Ledger | one inventory part line ↔ exactly one `repair_part_out`, carrying the repair document |
| Ledger | removing the line posts the exact reversal; the row is not deleted |
| Ledger | a `part_on_order` line posts nothing until received |
| Ledger | *Received* posts stock-in then consumption — net one of each |
| Ledger | No reparado is impossible with an unresolved consumed part |
| Money | deposit posts a `cash_movements` row in; refund posts one out |
| Money | collection: deposit tender + mixed tenders + change; zero remainder completes |
| Money | IVA21 snapshots on the collection document; gap-free `T1-` numbering |
| Money | diagnosis fee chargeable only when the intake snapshot is non-zero |
| Privacy | passcode absent from every print payload, oplog row and log line |
| Customers | dedupe by normalized phone; two spellings of one number are one customer |
| Permissions | denial per new key; Technician defaults; registry covers all new channels |
| Migration | populated v0.11.0 DB: counts unchanged, `--verify` green |

## Open decisions — recommended defaults

1. **`cash_movements` introduced now** (ADR-0014 §7). *Recommended: yes.* A deposit and a
   refund are drawer events; the alternative is leaving real cash unrecorded until the Caja
   slice. Risk: Caja may later want a different shape and would migrate a populated table.
2. **Collection in the existing `T1-` series** (§5). *Recommended: yes* — a repair
   collection is a sale. The alternative gives the shop two ticket books per till.
3. **`deposit` as a tender method.** *Recommended: yes*, mirroring store credit. The
   alternative (negative line) corrupts the taxable base.
4. **`repair.markNotRepaired` owner-only + approvable.** *Recommended: yes* — it is
   terminal, refunds money and may charge a fee, and approvable means a cashier can still
   do it with the owner's PIN rather than fetching them to the till.
5. **`repair.parts.receive` withheld from technicians.** *Recommended: yes*, per ADR-0012's
   own reasoning about writing off parts.
6. **`repair.release_without_payment`** (sketched in ADR-0012, not in this prompt).
   *Recommended: not built.* Collected requires a collection document; a zero-value
   collection already covers warranty rework and "nothing was wrong". Handing a device back
   unpaid on credit is a business decision the shop has not asked for.
7. **Logging passcode reveals** (who tapped to reveal). *Recommended: yes* — an oplog entry
   naming the actor and no value. Cheap, and it makes the mask meaningful rather than
   decorative.
8. **Quote lines vs collection lines.** *Recommended:* the collection document copies the
   ticket's charged lines at collection time and snapshots them there, rather than pointing
   at `repair_lines`. Editing a ticket afterwards must never change a fiscal document.
9. **Promised is optional.** *Recommended: yes* — a device with no promise is not overdue,
   and forcing a date at intake produces fiction.
10. **Labor as a line kind, not a product.** *Recommended: yes* — labor has no stock and no
    catalogue identity; making it a product would put it in Catálogo and in stock counts.

## Still open for the client

1. **Warranty months** — 3 assumed. Their answer lands as a setting, not a code change.
2. **Diagnosis fee** — 0 (none) assumed. If they charge one, it must be announced on the
   intake receipt to be chargeable.
3. **Default deposit suggestion** — 0 assumed.
4. **Whether the cap authorization is used at all** — enabled by default; if they never use
   it, the intake screen's cap field can be hidden by the setting.
5. **Warranty wording** for the printed receipt — a placeholder sentence ships; their
   gestor may want specific phrasing.
