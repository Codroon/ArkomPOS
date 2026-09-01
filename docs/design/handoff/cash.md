# Handoff — Cash (Caja · turno · movimientos · X · Z)

Follows [`00-foundations.md`](00-foundations.md): brand tokens only, no raw hex, **one blue
element per surface** (the primary action), **white-on-blue banned**, blue body text on Bone
banned. All strings through the typed dictionary (ADR-0011); printed documents render fixed
Spanish and ignore the UI locale.

The wireframe's *Cash* screen is layout inspiration only. Its **agency / Western Union**
panels — "Log transfer", "Daily WU reconciliation", the *WU principal (mov.)* and *Agency
commission* lines on the Z — are **not built**. Its `#S-0810-1` shift number is replaced by
the gap-free `Z1-000001` series (ADR-0015 §2). Where the wireframe and this file disagree,
this file wins.

**Nav change:** `09 Caja` loses its LOCK badge and gates on `cash.view`.

---

## 0. The two states of this screen

Everything below has exactly two shapes, and the screen never shows a third.

| | No open shift | Shift open |
|---|---|---|
| Header | `SIN TURNO` chip, danger variant | `Z1-000007 · abierto 08:32` |
| Body | One centred panel: *Abrir turno* | Three panels: Turno · Movimientos · Cierre (X) |
| Primary (blue) | **Abrir turno** | **Cerrar turno** |

There is no "loading" third state worth designing for: the shift query is one indexed row on
a local SQLite file.

---

## 1. Top-bar shift chip

Sits between the locale toggle and the Till chip, restoring the slot the wireframe drew and
ADR-0010 removed. It is a `button` — the whole chip clicks through to nav 09.

| State | Renders | Tone |
|---|---|---|
| Open | ● `Turno abierto · 08:32` | dot `success-ink`, text `inverse-ink` |
| Open > 20 h | ▲ `Turno abierto · 08:32 (ayer)` | `warning-bg` chip, `warning-ink` text |
| None | ▲ `Sin turno` | `danger-bg` chip, `danger-ink` text |
| No permission | not rendered | — |

The 20-hour state is a **warning, not a block**: the shop closes when it closes, and a till
that refuses to sell because someone forgot to press a button at midnight is a till that gets
worked around. The chip is the nag; the shop decides.

The topbar is Graphite, so these two chips are the one place a coloured surface sits on it —
justified because "no shift open" has to be visible from across the counter, and a muted
label would be read as decoration.

---

## 2. Caja (nav 09) — the screen

Header: title **Caja** · shift chip (`Z1-000007 · abierto 08:32 · Ahmer`) · spacer ·
`Historial` (`GhostButton`, only with `cash.history`).

Body is a two-column grid on the 1280 canvas: left rail 380 px holds **Turno** and
**Cierre**, the remaining width holds **Movimientos**.

### 2a. Turno (left, top)

A `card` panel, read-only. `SectionLabel` **TURNO**.

| Row | Value |
|---|---|
| Fondo inicial | `MoneyText` |
| Contado por | user name |
| Hora | `dd/mm/yyyy hh:mm` |
| Desglose | `4×20 · 6×10 · 8×5 · 20×1`, Mono 11px `muted`, one line, omitted when there is none |

The breakdown line is the wireframe's, kept verbatim in shape because it is genuinely the
right density: it is evidence, not data, and it belongs on one line under the figure it
explains.

### 2b. Cierre (left, bottom) — the X preview, always live

`SectionLabel` **CIERRE** with a `PREVIEW` `Chip` beside it while the shift is open.

```
Efectivo esperado        742,60 €      ← MoneyText, bold
Efectivo contado         [ 738,00 ]    ← money input + "Contar…" GhostButton
Descuadre               −4,60 €        ← MoneyText, danger-ink when negative,
                                          warning-ink when positive, muted when 0
                        FALTA 4,60 €   ← the sign in words, 11px, beside the figure
Motivo del descuadre    [___________]  ← appears only when descuadre ≠ 0, required
```

Below it, a collapsed **Ver detalle Z** disclosure showing the full Z figures (§5) — the same
numbers a close would freeze, live. Then `Imprimir X` (`GhostButton`) and the screen's one
blue element, **`Cerrar turno`** (`AccentButton`).

Under the button, a hint line that changes with the figures and is never a surprise:

- `El descuadre supera los 3,00 € — hará falta la aprobación de un responsable.`
- `2 tickets aparcados. No impiden el cierre.` (both may show)

**Why expected is shown before counted is typed.** The alternative — hide it until they
commit a number — is the classic anti-collusion design, and it is wrong for a two-person
shop where the owner is one of the two people. Hiding it would mean the cashier cannot
notice a 400 € discrepancy before counting three times. The control here is the approval and
the immutable record, not blind counting.

### 2c. Movimientos (right)

`SectionLabel` **MOVIMIENTOS DE EFECTIVO (NO VENTAS)** — the parenthesis matters, because the
first question every user asks is why today's sales are not in this list. Under it, 11px
`muted`: *Las ventas no aparecen aquí: se leen de los tickets.*

`DataTable`: Hora · Tipo (`Chip`) · Concepto · Usuario · Documento · Importe (`MoneyText`,
right, negative in `danger-ink`).

| Reason | Chip | Concept column shows |
|---|---|---|
| `repair_deposit` | `DEPÓSITO` | ticket number + customer |
| `repair_deposit_applied` | `APLICADO` | ticket number — **row is muted**, see below |
| `repair_deposit_refund` | `DEVOLUCIÓN` | ticket number + customer |
| `used_purchase_payout` | `COMPRA` | purchase number + device |
| `paid_in` | `ENTRADA` | the typed concept |
| `paid_out` | `SALIDA` | the typed concept |

`APLICADO` rows render at `subtle` with the amount struck through and a `°` marker footnoted
*No mueve efectivo — el depósito ya estaba en caja.* They are shown rather than hidden because
they exist in the ledger and a list that silently omits rows teaches people not to trust it;
they are muted because they are the one row here that does not change the drawer (ADR-0015 §5).

Clicking any automatic row opens the existing peek modal for its document. Nothing in this
panel is editable — automatic rows have no edit affordance at all, not a disabled one.

Footer strip (`surface-2`): `Entradas +120,00 €` · `Salidas −340,00 €` · `Neto −220,00 €`.

Header of the panel carries two `GhostButton`s: **`Entrada`** and **`Salida`**. Both hidden
without `cash.movement`.

---

## 3. Dialogs

### 3a. Abrir turno

Reached three ways: the blue button on an empty Caja, the top-bar chip, and **inline from the
Sale screen** when a charge is refused with `SHIFT_REQUIRED`.

```
ABRIR TURNO
Fondo inicial   [ 200,00 ]  ← prefilled from settings, focused, selected
                [ Contar… ]  ← opens the denomination helper
Desglose        4×20 · 6×10 · 8×5 · 20×1        (only after counting)
                                    [ Cancelar ]  [ Abrir turno ]
```

Enter submits. The whole dialog is one field and one button; ten seconds is the target and
anything else on it is a reason to miss.

**Inline from Sale.** The dialog is the same component, opened over the Sale screen with a
one-line preamble — *Para cobrar hace falta un turno abierto.* On success it closes and
**the charge the cashier already pressed runs automatically**. Making them press Cobrar again
after solving the problem the app raised is the kind of small rudeness that gets a till
blamed for being slow.

### 3b. The denomination helper

A modal, shared by open and close, so the two counts are never counted differently.

Two columns — **Billetes** (500, 200, 100, 50, 20, 10, 5) and **Monedas** (2, 1, 0,50, 0,20,
0,10, 0,05, 0,02, 0,01). Each row: the value (Mono, right), a `×`, a quantity input, and the
row subtotal (`MoneyText`, `muted` when zero). Quantity inputs are integer-only and empty
means zero — never a forced `0` to delete.

A sticky footer holds the running **TOTAL** (`font-display`, the same treatment the Sale
screen gives its total) and `Usar este total` (`AccentButton` — this modal is its own surface).

Tab moves down a column, then to the next. The first note quantity is focused on open.

### 3c. Entrada / Salida de efectivo

```
SALIDA DE EFECTIVO
Importe     [ 200,00 ]
Concepto    [ A la caja fuerte / banco          ]
            [ A la caja fuerte / banco ] [ Proveedor ] [ Gastos ] [ Cambio ]
                                              ← preset Chips from settings, one tap fills
                                    [ Cancelar ]  [ Registrar salida ]
```

Identical for Entrada with the sign reversed in the copy. Both refuse an empty concept.
Above the threshold setting the button carries the standard approval affordance and the
existing modal appears on submit — no new mechanism (ADR-0012 §5).

Amounts are always entered **positive**; the direction is the dialog, never a minus sign the
user types. A cashier typing `-200` in a field labelled *Salida* is a bug waiting to happen.

### 3d. Cerrar turno

Opened by the blue button, and it is a confirmation rather than a form — everything was
already typed in the Cierre panel, and re-typing it would be the third place a count is
entered.

```
CERRAR TURNO
Esperado    742,60 €
Contado     738,00 €
Descuadre  −4,60 €   FALTA
Motivo      Se dio mal el cambio por la tarde
⚠ El descuadre supera la tolerancia. Un responsable debe autorizarlo.
                          [ Cancelar ]  [ Cerrar e imprimir Z ]
```

On success the panel becomes a result state — *Turno Z1-000007 cerrado* — with
`Reimprimir Z`, `Abrir nuevo turno`, and the print toast's PDF fallback, matching the shape
the repairs intake and the used purchase already use.

---

## 4. Historial (with `cash.history`)

A plain table behind the header button, not a fourth panel: Nº Z · Abierto · Cerrado ·
Abierto por · Cerrado por · Esperado · Contado · Descuadre · Aprobó. Rows open a read-only
detail rendering **the stored snapshot**, with `Reimprimir Z`. Nothing on this screen can be
edited, and there is no affordance suggesting otherwise.

---

## 5. Prints

Both render through the existing op model (`packages/core/src/print-ops.ts`), thermal with the
PDF fallback, fixed Spanish, `COPIA` on a reprint.

### Informe Z — `renderZReport`

```
            ARKOM ELECTRONICS
            <legal block from settings>
       ------------------------------
              INFORME Z
            Z1-000007
        Caja 1 · 01/09/2026
       ------------------------------
  Abierto   01/09 08:32  Ahmer
  Cerrado   01/09 21:04  Ana
       ------------------------------
  DOCUMENTOS
  Tickets      42   T1-000318 → T1-000359
  Compras       3   C-000041  → C-000043
  Reparaciones  5   R-000018  → R-000022
       ------------------------------
  VENTAS
  Base imponible          1.204,30 €
  IVA 21%                   252,90 €
  Usado (REBU, sin IVA)     240,00 €
  TOTAL VENTAS            1.697,20 €
       ------------------------------
  COBROS
  Efectivo                  538,00 €
  Tarjeta                   662,40 €
  Bizum                      96,00 €
  Transferencia               0,00 €
  Saldo a favor              81,00 €
  Depósito aplicado         319,80 €
  TOTAL COBRADO           1.697,20 €
       ------------------------------
  MOVIMIENTOS (NO VENTAS)
  Depósitos          2       +80,00 €
  Devoluciones       1       −20,00 €
  Compras de usado   3      −240,00 €
  Entradas           1      +100,00 €
  Salidas            2      −200,00 €
       ------------------------------
  Compras de usado registradas      3
  Reparaciones entregadas           5
  Tickets aparcados al cierre       2
       ------------------------------
  Fondo inicial             200,00 €
  Efectivo esperado         742,60 €
  Efectivo contado          738,00 €
  DESCUADRE                  −4,60 €
  FALTAN 4,60 €
  Motivo: Se dio mal el cambio por la tarde
  Autorizado por: Ahmer
       ------------------------------
     Informe generado por el TPV
```

Rules the renderer must hold:

- **TOTAL COBROS equals TOTAL VENTAS.** If it does not, the till has a bug and the report says
  so rather than printing two numbers and letting the reader find it: a `⚠ DESCUADRE INTERNO`
  line renders between them. This should never print. That is why it exists.
- **Used-device sales are their own line with no VAT** — the margin scheme prints none
  (ADR-0007), and folding them into the taxable base would misstate the return.
- A tender or movement kind with **zero activity prints as zero**; a kind that does not exist
  in this phase (refunds, voids, agency) does not print at all. A zero says "none today"; an
  absent line says "not a thing here", and printing `Devoluciones 0,00 €` on every Z for a
  feature that does not exist would be a lie of implication.
- **The variance sign is named in words** (`FALTAN` / `SOBRAN`) under the figure.
- The reason and approver lines are omitted entirely when the variance is zero.

### Vista X — same renderer

Heading `VISTA X (PROVISIONAL)`, `PREVIEW` where the Z number goes, no counted / variance /
reason / approver block, and a closing line *No es un cierre. No consume número.*

---

## Accessibility / focus order

Caja: shift chip → Contar (open) or Contado (close) → Motivo → Cerrar turno → movements table.
Dialogs trap focus, `Esc` cancels, `Enter` submits the primary action, and the denomination
helper returns focus to the field it filled. Every money figure is Mono 700 `tabular-nums`
(foundations); every quantity input is Mono 500.
