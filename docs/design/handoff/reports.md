# Handoff — Informes (hub · Ventas · Reparaciones · Usados · Valoración · Stock muerto)

Follows [`00-foundations.md`](00-foundations.md): brand tokens only, no raw hex,
**one blue element per surface**, **white-on-blue banned**, blue body text on Bone
banned. All strings through the typed dictionary (ADR-0011).

The wireframe's *Reports* screen lists **ten** cards. Five are built. Not built,
and deliberately absent rather than greyed out: *Margin by used device*
(RPT-03 — a real report needing its own design; seam noted in ADR-0016 §9),
*Western Union commission* (RPT-06 — agency is out of Phase 1), *Cash variance by
user* (RPT-09) and *Discounts and overrides by user* (RPT-10). Where the wireframe
and this file disagree, this file wins.

**Nav change:** `10 Informes` loses its LOCK badge and gates on `reports.view`.

---

## 0. Two shapes of report, and the rule that follows

| | Period reports | Position reports |
|---|---|---|
| Which | Ventas · Reparaciones (Cerradas) | Valoración · Usados · Stock muerto · Reparaciones (Abiertas) |
| Header says | the selected range | **Ahora** |
| Filter bar has | date presets + custom | no dates at all |

**There is no period selector in the Informes header.** Three of the five reports
answer "right now", and a global range would either grey out unpredictably or
imply that valuation as of last Tuesday exists. It does not (ADR-0016 §5).

Each report keeps its filters **for the session**: drill into a ticket and come
back and last month is still selected. Reopen the app tomorrow and it is the
default again, because a report silently showing a stale month is how a shop
reads the wrong figures and believes them.

---

## 1. The hub (nav 10)

Header: **Informes** · spacer. No filters — the hub has nothing to filter.

Body: a 3-column grid of cards on the canvas, `card` surface, 1px `line-strong`,
each 100px tall. A card a caller cannot open **is not rendered** — not greyed.

```
┌──────────────────────────┐
│ VENTAS                   │  ← SectionLabel, 10px 700 .1em muted
│ 4.182,50 €               │  ← font-display 20px, ink
│ Neto · este mes          │  ← 11px muted: the window, on the card
└──────────────────────────┘
```

| Card | Headline | Window label |
|---|---|---|
| Ventas | net sales | *Neto · este mes* |
| Reparaciones | `14 abiertas · 3 vencidas` | *Ahora* |
| Dispositivos usados | `11 uds · 3.240,00 €` | *Coste inmovilizado · ahora* |
| Valoración de inventario | total at cost | *A coste · ahora* |
| Stock muerto | `37 artículos` | *Sin venta en 90 días · ahora* |

The overdue half of the Repairs headline is `danger-ink` when non-zero and
`muted` when zero — the one place a number changes colour on this screen.

**The hub is one channel and five aggregates**, and it runs on every open, so it
stays cheap by construction rather than by caching.

---

## 2. The shape every report shares

```
┌ header ─────────────────────────────────────────────────────┐
│ ← Informes │ Ventas │ <window>                    [Exportar] │
├ filter bar ─────────────────────────────────────────────────┤
│ [Hoy][Ayer][Semana][Mes][Mes pasado][Personalizado] │ Turno ▾│
├ summary strip ──────────────────────────────────────────────┤
│ TICKETS 42 │ NETO 3.457,80 │ IVA 726,14 │ BRUTO 4.183,94 …  │
├ table ──────────────────────────────────────────────────────┤
│ …                                                            │
└──────────────────────────────────────────────────────────────┘
```

- **Back** is a GhostButton reading `← Informes`, always first.
- **Exportar** is a GhostButton, top right. It is **not** the blue element —
  exporting is not what anybody came to this screen to do. Most report screens
  have no blue element at all, which foundations permits: the rule is *at most*
  one, and a read-only screen has no primary action.
- **Summary strip** is `surface-2`, one row, each figure a label above a
  `MoneyText` or a Mono count. It never scrolls with the table.
- **Table** is the standard DataTable: sticky header, `surface-2`, 10px 700
  uppercase; money right-aligned Mono 700 tabular; rows 28px.
- **The estimated caption** sits directly under the summary strip whenever a
  cost figure on screen used an estimate:
  > ⚠ *37 de 412 líneas son anteriores a v0.14.0 y usan el coste actual del
  > artículo. El margen es aproximado.*
  `warning-bg` strip, `warning-ink` text, 11px. It is never a tooltip and never
  omitted.

**Empty states** are a centred 12px `muted` line that names the filter that
emptied it — *No hay ventas entre el 01/08 y el 31/08* — not a bare "Sin datos".

---

## 3. Ventas

**Filter bar:** the six presets as a segmented control, plus two date inputs when
*Personalizado* is chosen (typed `dd/mm/yyyy`, the `parseDayInput` field from
v0.12.0 — never a native picker), plus a **Turno** select listing closed shifts
by Z number and date. Picking a shift replaces the range and says so.

**Agrupar por:** a second segmented control — Día · Grupo · Artículo · Usuario ·
Medio de pago.

**Summary strip:** Tickets · Neto · IVA 21% · Bruto · Ticket medio · **Usado
(REBU, sin IVA)** — the last on its own, because margin-scheme sales carry no VAT
and adding them to the taxable base would misstate the return.

**Table**, by grouping:

| Grouping | Columns |
|---|---|
| Día | Fecha · Tickets · Neto · IVA · Bruto |
| Grupo | Grupo · Uds · Neto · IVA · Bruto |
| Artículo | Artículo · Grupo · Uds · Ingresos · **Coste** · **Margen €** · **Margen %** |
| Usuario | Usuario · Tickets · Neto · IVA · Bruto |
| Medio de pago | Medio · Operaciones · Importe |

The three bold columns exist only with `reports.costs` — **absent from the
response**, so the table renders five columns rather than eight (ADR-0016 §7).

Margin % is `danger-ink` below zero, plain otherwise. No colour scale: a
red-to-green gradient across a margin column is decoration that makes a 3 %
difference look like a crisis.

**Repair collections** appear under Grupo as **Reparaciones**, and under Artículo
as their labour and part descriptions. A `T1-` created at hand-back is an invoice
like any other and belongs in the same total.

**Drill-down:** a Día or Usuario row opens a list of that day's tickets, each
opening the existing `TicketPeekModal`. An Artículo row opens its lines with the
ticket each came from. Grupo and Medio de pago rows do not drill — there is no
useful single thing behind them.

---

## 4. Reparaciones

Two tabs in the header: **Abiertas** and **Cerradas en el periodo**.

### Abiertas (a position)

**Filters:** status chips (the seven from handoff/repairs.md, reused verbatim) and
a technician select including *Sin asignar*.

**Summary:** Abiertas · **Vencidas** (danger when non-zero) · **Presupuestadas ·
esperando al cliente** (highlighted `warning-bg`, because a quoted ticket is the
shop waiting on somebody else and the pile grows silently) · La más antigua
(`R-000042 · 23 días`).

**Table:** Nº · Cliente · Dispositivo · Estado (chip) · Días en estado · Días
desde entrada · Técnico · Prometido · (overdue marker).

Rows open the repair page. The **Taller board stays the live working view**; this
tab is the same facts sorted for a different question — what is late, and what is
waiting on somebody.

### Cerradas en el periodo (a period, behind `reports.costs`)

**Filters:** the same date presets, plus an optional **Agrupar por técnico**.

**Summary:** Entregadas · Ingresos · Coste de piezas · Mano de obra · Margen ·
Tiempo medio (entrada → entrega) · No reparadas.

**Table:** ungrouped, one row per collected ticket — Nº · Cliente · Dispositivo ·
Entrada · Entrega · Días · Ingresos · Piezas · Margen · Técnico. Grouped, one row
per technician with the same money columns and a count.

**Not repaired** is a small second table under the first: reason, count — because
three abandoned devices and three unrepairable ones are different problems.

---

## 5. Dispositivos usados (position, behind `reports.costs`)

**Summary:** three status figures — En depósito · Pendiente de revisión · En
stock — each *count · cost*, plus **Saldo a favor pendiente** (`3 vales ·
180,00 €`) as a fourth. Store credit is money the shop owes and belongs beside
money the shop is holding.

**Filters:** status chips and a grade select (A · B · C · todos).

**Table, oldest first** — because the oldest held device is the question this
report exists to answer: Nº compra · Modelo · Grado · Estado · Coste (compra +
reacondicionamiento) · PVP (or `—` when unpriced) · **Días retenido**.

Days held is `warning-ink` past 60 days and `danger-ink` past 120 — the only
thresholds on this screen, and they are about cash, not about the device.

Rows open the used device detail.

---

## 6. Valoración de inventario (position, behind `reports.costs`)

**Summary:** one figure — **Total a coste** — in `font-display`, the largest
number on any report screen, because it is the whole point of the page.

**Filter:** group select.

**Two tables**, stacked: by group (Grupo · Uds · Valor), then per product
(Artículo · Grupo · Existencias · Coste unitario · Valor).

Serialized rows show their unit-cost column as `—` and their value as the sum of
their in-stock units' own costs, because five identical phones bought at three
different prices have no single unit cost. A used device in stock is valued at
buy + refurb, which is the same number, because that is what the unit carries.

**This total must equal the Inventario header, to the cent.** If it ever does
not, one of the two screens is lying and the shop cannot tell which.

---

## 7. Stock muerto (position, behind `reports.costs`)

**Filter:** group select. The threshold is **not** a filter — it is
`Ajustes → Informes → Días sin venta`, default 90, and the header states it:
*Sin venta en 90 días · ahora*. A threshold in the filter bar invites fishing for
a number that looks better.

**Table, sorted by cost tied up descending** — the money is the point, not the
count: Artículo · Grupo · Existencias · **Coste inmovilizado** · Última venta
(`dd/mm/yyyy` or *nunca*) · Días.

*Nunca* is `muted` italic and sorts as the oldest, because a product that has
never sold is the strongest case on the page.

Used devices are absent by design — §5 covers them, and a used phone that has not
sold in 90 days is a different conversation from 40 unsold cases.

---

## 8. Exportar

Every report. A save dialog opens at the shop's documents folder with
`<informe>-<yyyy-mm-dd>.csv` filled in. The file is the **current filtered view**,
re-run server-side, so what the accountant opens is what the shop looked at.

The success toast names the file and offers **Abrir** and **Ver carpeta** — the
same shape the print toast uses, for the same reason: the folder is somewhere
nobody navigates to by hand.

The estimated caption, when it applies, becomes a first line in the file above
the header row, so the warning cannot be lost by exporting.

---

## Accessibility / focus order

Hub: cards are buttons in reading order. Report: back → filters → grouping →
export → table. `Esc` on a report returns to the hub, and on a peek closes the
peek only. Money is Mono 700 `tabular-nums` everywhere (foundations); counts are
Mono 500.
