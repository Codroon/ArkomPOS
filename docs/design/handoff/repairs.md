# Handoff — Repairs (Reparaciones · Ficha · Taller · Piezas por pedir · Cobro)

Follows [`00-foundations.md`](00-foundations.md): brand tokens only, no raw hex, **one blue
element per surface** (the primary action), **white-on-blue banned**, blue body text on Bone
banned. All strings through the typed dictionary (ADR-0011); printed documents render fixed
Spanish and ignore the UI locale.

The wireframe's *Reparación* and *Taller / Agenda* screens are layout inspiration only. Its
**ten-status pipeline** and its **half-hour slot calendar with a walk-in bench** are not
built — where it and this file disagree, this file wins (ADR-0014).

**Nav changes:** `06 Reparación` becomes **`06 Reparaciones`** (list + intake + ficha) and
`07 Taller / Agenda` becomes **`07 Taller`** (the board). Both lose their LOCK badge;
`06` gates on `repair.view`, `07` on `workshop.view`.

---

## 0. The seven statuses, and their chips

One vocabulary everywhere — list, board, ficha, print.

| Status | Chip | Variant |
|---|---|---|
| Recibido | `RECIBIDO` | neutral |
| Presupuestado | `PRESUPUESTADO` | info |
| Esperando pieza | `ESPERANDO PIEZA` | warning |
| En reparación | `EN REPARACIÓN` | neutral (inverted — it is the working state) |
| Listo | `LISTO` | success |
| Entregado | `ENTREGADO` | neutral, subdued |
| No reparado | `NO REPARADO` | danger |

**Nothing in this module offers a status picker.** Every status shown is derived
(ADR-0014 §1). Where a status would change, the UI offers the *action that records the
fact* — "Registrar aprobación", "Marcar listo" — never the destination.

---

## 1. Reparaciones (nav 06)

Two tabs in the header: **Fichas** and **Piezas por pedir** (§4).

**Header:** title · counts strip · search · **`+ Nueva reparación`** (`PrimaryButton`,
graphite — the blue on this screen belongs to the intake form's submit).

**Counts strip:** one `Chip` per status doubling as a filter, plus `Todas`, exactly as
Dispositivos usados does it — and with the same rule: **the counts are over everything
regardless of the active filter**, so the strip never becomes a maze. A second row of
filters holds the technician `SelectInput` (including *Sin asignar*) and an
`Solo vencidas` toggle.

**Search** is a ScanInput: scanning an IMEI jumps to the ticket. It matches ticket number,
customer name, phone, IMEI and device text.

**Table:** Nº (`R-000042`, Mono) · Cliente · Dispositivo · Avería (one line, truncated) ·
Estado (chip) · Técnico · Prometido · Días.

- **Overdue** — promised in the past and not Listo/Entregado/No reparado — puts the
  promised cell in the `warning` pair and adds a small `VENCIDA` chip. Overdue is a fact
  about a date, so it is shown wherever the date is, not as a separate column.
- Entregado and No reparado rows render `subtle`.
- *Sin asignar* renders as the word in `muted` italic, never as an empty cell: a blank
  reads as a rendering bug, and "nobody has picked this up" is information.

Row click opens the ficha in place (the same pattern as the used-device detail).

---

## 2. Nueva reparación — intake

A single scrolling form, three cards, one submit. The order is counter order: who, what,
what is wrong, what we agreed.

### Cliente

`SectionLabel` **CLIENTE**. One ScanInput-style search on **teléfono o nombre** with a live
result list underneath. Choosing a result fills the block; typing a new number and pressing
`Nuevo cliente` reveals name + note fields.

Once chosen: name, phone and note render as an inline-editable row with a small `Editar`
ghost link — the shop corrects a misheard number at the counter, and making them leave the
screen to do it is how numbers stay wrong.

> The dedupe is on the number, not the name (ADR-0014 §11). If the number matches, the
> screen says so — *"Ya existe: Joan Puig · 3 reparaciones"* — rather than silently making
> a second customer.

### Dispositivo

Two-column `Field` grid: Dispositivo (free text, required) · IMEI (ScanInput, **optional**,
validated only when non-empty) · Avería declarada (textarea, required) · Estado al recibir
(textarea).

**Marcas de daño** — four `Switch`es in a row: `Pantalla rota` · `Trasera rota` ·
`Golpes/abolladuras` · `Testigo de humedad`. Plus a free-text line. This is what protects
the shop when a customer says the dent was not there before, so it sits *above* the fold,
not in an "advanced" section.

**Accesorios** — free text ("funda, cargador"), because what arrives with a phone is not
enumerable.

**Código / patrón** — a `TextInput` with `type="password"` and a `Ver` toggle. Under it, in
`subtle`: *"No se imprime en ningún documento."* That sentence is not decoration — it is
the promise ADR-0014 §10 makes, said where the person typing it can read it.

**Fotos** — the used-slice component unchanged: five slots, each offering **Subir** and
**Capturar** side by side, "no camera" a calm state.

### Acuerdo

`SectionLabel` **ACUERDO**.

- **Prometido para** — a date input plus a `Segmented` **Mañana · Tarde**. Optional, and
  the hint says so: *"Opcional. Sin fecha, la ficha nunca aparece como vencida."*
- **Depósito** — money input, prefilled from the setting when non-zero. A note states it
  goes into the drawer and comes off the final bill.
- **Autorización hasta** — shown only when the cap setting is on. A money input plus the
  sentence *"El cliente autoriza reparar hasta este importe sin volver a preguntar."*
- **Tarifa de diagnóstico** — read-only, from the setting, shown **only when non-zero**,
  with *"Se imprime en el resguardo. Solo se puede cobrar si aparece ahí."*

### Footer

Right-aligned: `Cancelar` (ghost) and **`Crear ficha e imprimir resguardo`**
(`AccentButton` — **the screen's one blue element**). One button, because a ticket without
its receipt is the thing this slice exists to stop.

On success: the ficha opens, and the print toast reports the receipt or the saved PDF with
*Abrir* — the v0.11.0 lesson applies here from the first line of code, not after the shop
finds it missing.

---

## 3. Ficha de reparación

**Header:** `← Volver` · `R-000042` (Mono, bold) · customer · device · the status chip ·
`VENCIDA` when overdue.

Under it, a **status strip**: the seven statuses in order, the current one filled, the
passed ones ticked, the rest muted. It is a read-out, not a control — nothing in it is
clickable. Under the current status, in small type, **the fact that put it there**:
*"Aprobado por el cliente · 79,00 € · 09/08 16:20 · Ana"*. When a status is blocked, the
strip is where the reason lives: *"Falta la aprobación del cliente."*

Two columns.

### Left — what it is

**Intake** — customer, device, IMEI, fault, condition, damage marks as chips, accessories,
photos (thumbnails, click to enlarge), and the passcode masked with a `Ver` toggle.

**Presupuesto** — a table: Concepto · Coste · Cargo · Margen. Rows are the quote lines;
labor has no cost; an ordered part shows its expected cost and an `PEDIDA` chip. Footer
row: ticket total and **margin in € and %**, because the number that tells the owner
whether the job was worth doing should not need a calculator.

Actions above the table: `Añadir pieza del inventario` (opens the scan/search picker used
by stock entry) · `Añadir mano de obra` · `Añadir pieza por pedir`.

> Adding an inventory part posts its stock movement immediately, and the row says so:
> *"Descontada del inventario"* in `subtle`. Removing the row warns that a reversal will be
> posted — not that the row will be deleted, because it will not be (ADR-0004).

**Aprobaciones** — every approval, newest first: total, method, actor, timestamp. Two rows
when a quote rose and was re-approved. This is the dispute-settling block, so it is a list,
never a single line.

**Avisos al cliente** — the notified log: method, note, actor, timestamp. Repeatable.

**Historial** — the oplog for the ticket and its document, the same shape as the
used-device timeline.

### Right — what can be done

**Gestión** card: técnico (`SelectInput`, any active user, *Sin asignar* first), depósito,
garantía (months, from the snapshot), recibido, prometido.

**Acciones** card. Only the actions the facts allow are rendered; the rest are absent, and
underneath, one line says what is missing. The primary action is the ficha's single blue
element and changes with the status:

| Status | Primary (blue) | Others |
|---|---|---|
| Recibido | `Añadir al presupuesto` | Imprimir resguardo |
| Presupuestado | `Registrar aprobación` | Imprimir presupuesto · Cliente rechaza |
| En reparación | `Marcar listo` | — |
| Esperando pieza | `Recibir pieza` | — |
| Listo | `Cobrar y entregar` | Avisar al cliente · Imprimir presupuesto |
| Entregado | — | Reimprimir recibo |
| No reparado | — | Reimprimir documento de devolución |

`Marcar no reparado` sits apart, at the bottom, in the `danger` pair — terminal actions do
not sit next to routine ones.

**Registrar aprobación** opens a small dialog: `Segmented` **En persona · Por teléfono**,
the total being approved shown large and read-only, and a confirm. The total is read-only
because approving *an amount* is the whole point; a typo there is a dispute later.

---

## 4. Piezas por pedir (tab on nav 06)

The owner's morning list. One table, every open ordered line across every ticket:

Pieza · Ficha (`R-000042`, links) · Cliente · Prometido · Coste previsto · Proveedor ·
Días esperando.

Sorted by days waiting, descending — the oldest is the one costing the shop a customer.
Rows past their promised date carry the same `VENCIDA` treatment as the list.

Each row has one action: **`Recibida`**, which opens the goods-received dialog — the real
cost (prefilled with the expected), quantity, and a confirm. On confirm it runs the normal
stock-entry flow and converts the line, and the toast says both halves happened:
*"Entrada de stock registrada y pieza descontada para R-000042."*

Empty state: *"No hay piezas pendientes de pedir."* — a good morning, and the screen should
say so rather than showing an empty grid.

---

## 5. Taller (nav 07) — the board

**Header:** title · counts (`14 fichas abiertas`) · a technician filter · a toggle for the
terminal columns.

**Columns:** the seven statuses in order. **Entregado** and **No reparado** are collapsed by
default behind the toggle — a board of finished work is not a board.

**Cards** carry: `R-000042` (Mono, bold) · device · fault, one truncated line · technician
(or *Sin asignar*) · days in the current status · promised slot. The left border encodes
age in the current status: `line` → `warning-ink` → `danger-ink`. Overdue cards show
`VENCIDA`.

**Drag** between columns attempts the transition. It runs **the same guard as the buttons**
— there is no second code path, which is the whole reason the guard lives in the domain and
not in the screen. A refused drop returns the card to its column and shows the reason in a
toast: *"Falta la aprobación del cliente."* Never a silent snap-back.

A drop that needs more than a fact — dragging to *Entregado*, which requires payment —
opens the corresponding dialog instead of refusing. The board is a shortcut to the actions,
not a parallel set of them.

**No calendar.** Promised is a date and a half-day; that is what the shop needs and all the
board shows.

---

## 6. Cobro y entrega — the collection dialog

Opened by *Cobrar y entregar*. It reuses the Sale screen's payment components verbatim —
tender tiles, amount inputs, running Pendiente/Cambio, the same change rules.

```
Cobro · R-000042 · Joan Puig
────────────────────────────────
Pantalla iPhone 11 (compat.)     64,00 €
Mano de obra                     15,00 €
────────────────────────────────
TOTAL                            79,00 €
Depósito                       − 20,00 €     ← a tender, applied automatically
Pendiente                        59,00 €
────────────────────────────────
[ Efectivo ][ Tarjeta ][ Bizum ][ Transf. ][ Saldo ]
```

- The deposit appears as a tender chip labelled `Depósito · 20,00 €`, present from the
  moment the dialog opens and not removable. It is **not** a discount line: the total is
  the value of the work (ADR-0014 §7).
- A **zero** Pendiente — deposit covers it, or nothing is chargeable — enables the confirm
  with no tender at all, and says *"Nada que cobrar."*
- Confirm creates the collection document, prints the final receipt, and moves the ticket
  to Entregado. The print toast behaves like every other print.

### Marcar no reparado

A dialog, not a button. In order:

1. **Reason** — `Segmented`: *Cliente rechaza* · *Irreparable* · *Abandonado*.
2. **Consumed parts** — if any inventory part was consumed, each one is listed with a
   required choice: **Devolver al inventario** (posts the reversal) or **Cobrar igualmente**
   (it went into the device and is not coming back). The confirm stays disabled until every
   line is resolved. This is the one place the UI blocks on bookkeeping, and it does so
   because the alternative is a part that has silently vanished from the shelf.
3. **Diagnosis fee** — offered only when the intake snapshot is non-zero, and the dialog
   says why when it is absent: *"No se anunció en el resguardo."*
4. **Deposit** — *Devolver* (drawer movement out) or *Aplicar a la tarifa*.

Confirm prints the return document.

---

## 7. Prints

All fixed Spanish (ADR-0011), all through the shared op-model in `print-ops.ts`, so the
thermal and PDF paths cannot drift. **None of them contains the passcode.**

### Resguardo de depósito (intake) — `renderIntakeReceipt`

```
              A R K O M
   E L E C T R O N I C S · P H O N E S
       {shop legal name}
       NIF {nif} · {address}
------------------------------------------
RESGUARDO DE DEPÓSITO
R-000042               09/08/2026 16:05
Caja 1 · Atendido por Ana
------------------------------------------
CLIENTE
Joan Puig · +34 671 220 918
------------------------------------------
DISPOSITIVO
Apple iPhone 11 64GB
IMEI 356938104420030
Avería: pantalla rota, táctil intermitente
Estado: marcas de uso, trasera correcta
Daños: pantalla rota
Accesorios: ninguno
------------------------------------------
Depósito entregado            20,00 €
Autorizado a reparar hasta   100,00 €
Tarifa de diagnóstico          15,00 €
------------------------------------------
La reparación tiene 3 meses de garantía
en piezas y mano de obra.

No se realizará ningún trabajo con cargo
sin la aprobación previa del cliente,
salvo el importe autorizado arriba.


Firma del cliente


X ________________________________
------------------------------------------
        Gracias por su visita
```

The cap line, the deposit line and the diagnosis-fee line each print **only when set**. The
declaration and the signature are the point of the document, and the signature box is at
least three blank lines so a pen fits — the same rule the purchase document follows.

### Presupuesto — `renderQuoteDoc`

Header, ticket number, device, then the lines with charges and the total, then:
*"Autorizo la reparación por el importe indicado."* and a signature rule. For the customer
who wants to sign rather than say yes on the phone.

### Recibo final — `renderRepairReceipt`

The collection document's own ticket **plus** a repair block: work performed, parts, device
+ IMEI, warranty end date (`Garantía hasta 09/11/2026`), and the payments including the
deposit. Printed from the collection, so it carries the `T1-` number as its document number
and quotes `R-000042` as a reference.

### Documento de devolución — `renderReturnDoc`

For Not repaired: device returned, the reason in words, the diagnosis fee if it was
announced, what happened to the deposit, and a signature line for the customer taking the
device back.

---

## Accessibility / focus order

- Intake: customer search → device → IMEI → fault → condition → damage → passcode →
  photos → agreement → submit. The IMEI field keeps scanner focus like every other
  ScanInput.
- Ficha: the primary action is the first tab stop in the actions card.
- Board: cards are focusable and support keyboard move (`Enter` to pick up, arrows to
  choose a column, `Enter` to drop, `Esc` to cancel) — a board that only works with a mouse
  is a board a busy workshop stops using.
- Every dialog traps focus and closes on `Esc`, except while a collection is submitting.
- The passcode reveal is a `button` with `aria-pressed`, and the field's label says the
  value is hidden.
