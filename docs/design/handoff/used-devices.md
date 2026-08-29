# Handoff — Used devices (Comprar usados · Dispositivos usados · Detalle · Saldo en Venta)

Follows [`00-foundations.md`](00-foundations.md): brand tokens only, no raw hex, **one blue
element per surface** (the primary action), **white-on-blue banned**, blue body text on Bone
banned. All strings through the typed dictionary (ADR-0011); printed documents render fixed
Spanish and ignore the UI locale.

Layout follows the wireframe's *Buy used* and *Used unit* screens. The wireframe's
five-stage refurbishment pipeline, per-part costs and technician field are **not built** —
where it and this file disagree, this file wins.

**Nav changes:** `04 Compra usados` becomes **`04 Comprar usados`** (the entry form) and
`05 Unidad usada` becomes **`05 Dispositivos usados`** (the list). Both lose their LOCK
badge and gate on `usedDevices.create` / `usedDevices.create` respectively.

---

## 1. Comprar usados (nav 04)

Three columns on `canvas`: **Device** and **Seller** stacked in the left two-thirds, the
**gate rail** on the right at 340px. Header: "Comprar dispositivo usado" with a `Chip`
reading `Nuevo · #C-1187` — the number is **provisional and marked so**, because it is only
allocated when the purchase is logged (ADR-0008 forbids reserving it early).

### Device

`SectionLabel` **DISPOSITIVO**. Two-column `Field` grid:

| Field | Control | Notes |
|---|---|---|
| Marca | TextInput | free text; datalist of previously used brands |
| Modelo | TextInput | free text |
| Almacenamiento | SelectInput | 32/64/128/256/512 GB, 1 TB, Otro |
| Color | TextInput | |
| Grado | Segmented A · B · C | A = como nuevo, B = buen estado, C = con desgaste — the legend sits under the control, because "B" means nothing to a new cashier |
| Batería | TextInput + `%` suffix | 0–100, Mono |
| IMEI | ScanInput | scanner-first; 15 digits; feeds the gate |
| Accesorios | four Switches | Cargador · Caja · Cable · Funda |

### Photos

`SectionLabel` **FOTOS**. Four slots in a row — **Frontal**, **Trasera**, and two spare —
each a 132×132 `card` tile with a dashed `line-strong` border when empty.

Every empty slot shows **two buttons side by side**: `Subir` and `Capturar`. This is the
whole point of the row: the shop may have a webcam on the counter or may photograph on a
phone and drag the file in, and neither should be the awkward path.

- **Subir** opens the file dialog.
- **Capturar** opens a modal: live preview, a camera `SelectInput` when more than one is
  present, a big **Capturar** button (the modal's one blue element), then **Repetir** /
  **Usar foto**.
- **No camera**: the Capturar button renders disabled with the hint "No se detecta cámara",
  and Subir is unaffected. Not an error state — plenty of shops have no webcam.

A filled slot shows the thumbnail, and on hover a **Quitar** ghost button. Clicking opens
the full image.

### Seller

`SectionLabel` **QUIEN VENDE** with a `warning`-toned one-liner: *"Datos personales — solo
se muestran a quien tenga permiso."*

Nombre · Teléfono · Tipo de documento (Segmented DNI · NIE · Pasaporte) · Número de
documento · **Foto del documento** (a fifth photo slot, same two-source control).

**No signature pad.** A line reads: *"La firma se recoge en el documento impreso."*

### The gate rail (right)

Three stacked cards. Card two and three are visibly inert until card one passes.

**1 · Comprobación del IMEI**
- the IMEI in Mono 700, large;
- validity: 15 digits + check digit, live;
- duplicate result: *"Ya existe en el sistema"* with a link to the existing unit or
  purchase, in the `danger` pair;
- then the confirmation, which is the actual gate:

> ☐ **He verificado físicamente el dispositivo:** el bloqueo de activación está quitado y
> está restaurado de fábrica.

A `warning-bg` note underneath: *"La comprobación es física. Arkom no consulta ninguna base
de datos online."* — the wireframe implied a GSMA lookup and we are not shipping one, so
the screen must not imply it either.

**2 · Precio** — `surface-2`, `subtle` text and the message *"Disponible tras comprobar el
IMEI"* until the gate passes. After:
- a suggested price row, currently showing *"Sin tarifa — introduce el precio"*
  (the rate-table seam);
- **Precio de compra** — a money input, Mono 700, the largest number on the screen;
- when a suggested price exists and is changed: a **Motivo** field appears and the log
  button routes through the approval modal.

**3 · Forma de pago** — Segmented **Efectivo · Transferencia · Saldo a favor**.
Transferencia reveals a reference field. Saldo a favor shows a note: *"Se emitirá un
vale por {importe}."*

**Barcode** sits under the payment card: a ScanInput plus a `Generar` ghost button, showing
the resulting code in Mono.

### Footer actions

Right-aligned, in the rail:

- **Dejar en espera** — `PrimaryButton` (graphite)
- **Enviar a inventario · {precio}** — `AccentButton`, **the screen's one blue element**

Both disabled until the gate passes and the required fields are filled. *Enviar a
inventario* opens the selling-price modal (below) before writing anything.

### Selling-price modal

Opened by *Enviar a inventario*. Shows the cost breakdown — buy price, refurb cost if any,
total cost — then **Precio de venta** prefilled at `cost × (1 + margen%)` rounded to the
nearest 5 cents, with the margin setting named beneath it. Confirm is the modal's one blue
element.

---

## 2. Dispositivos usados (nav 05)

Header: title, counts strip, search. Search is a ScanInput — scanning a shelf label or an
IMEI jumps straight to the device.

**Counts strip:** four `Chip`s doubling as filters —
`En espera {n}` (neutral) · `Requiere revisión {n}` (warning) · `En stock {n}` (success) ·
`Vendido {n}` (neutral, subdued). Selected chip inverts to graphite.

**Table:** Dispositivo (model + storage + colour, with grade as a small chip) · IMEI (Mono) ·
Compra (`C-000123`, Mono) · Fecha · Compra € · Estado · Venta € .

Rows for sold devices render `subtle`; their Estado chip links to the sale.
Row click opens the detail.

---

## 3. Detalle del dispositivo

Two panes: gallery and data left, actions right.

**Gallery** — thumbnails, click to enlarge. The seller-ID photo appears **only** with
`usedDevices.viewSeller`.

**Reimprimir documento de compra** — a ghost button in the actions pane, also behind
`usedDevices.viewSeller`. Printing the document *while logging the purchase* needs no such
permission: the cashier entered those details a moment earlier and has to hand the seller
something to sign. A reprint days later is a way to read the seller's data off a till that
will not show it on screen, so it is gated with the data it reveals. Without the
permission the button is absent and the handler refuses.

**Datos del dispositivo** — marca, modelo, almacenamiento, color, grado, batería, IMEI,
accesorios, código de barras.

**Quien vende** — behind `usedDevices.viewSeller`. Without it the block renders as a single
muted line: *"Datos del vendedor ocultos — requiere permiso."* The fields are absent from
the payload, not hidden with CSS.

**Compra** — precio de compra, forma de pago, vale emitido (linking to the voucher and its
status), **coste de reacondicionamiento** (editable while held, frozen and explained once in
stock), coste total, fecha de compra, and — when the hold setting is on — *"En espera hasta
{fecha}"*.

**Historial** — the oplog for this purchase and unit, newest first, each line naming the
actor and, where present, the approver. Same shape as the audit trail elsewhere.

**Actions**, only while held:
- `Requiere revisión` Switch
- `Editar coste de reacondicionamiento`
- **Enviar a inventario** — `AccentButton`, the pane's one blue element, opening the
  selling-price modal

Once in stock the actions collapse to a line stating when it entered stock and at what
price, with a link to the catalogue product.

---

## 4. Sale-screen changes

Three additions, no restructuring.

**Used devices appear in the ordinary search.** A purchase files its device under a
found-or-create product named `Apple iPhone SE 2020 64GB Blanco (usado)`; that product is
hidden from the **Catálogo** management list — it is bookkeeping, not something the owner
maintains — but it is a normal sellable product on this screen. Scanning the shelf label or
the IMEI finds it, and so does typing the model.

Every used result carries a marker so the two are never confused when the shop stocks a
model both new and second-hand:

> `Apple iPhone SE 2020 64GB` · `Usado` chip (neutral) + `Grado B` chip · `189,00 €`

The grade chip reads from the **unit**, not the product, because two phones of the same
model are rarely in the same condition. A held device is not offered at all — scanning one
reports the near-miss (*"Dispositivo en espera — todavía no está a la venta"*) rather than
"unknown code", so a cashier is told why rather than left doubting the scanner.

**A new tender: `Saldo a favor`.** It joins Efectivo · Tarjeta · Bizum · Transferencia in
the payment panel. Pressing it opens the **voucher finder** rather than an amount field,
because the amount is the voucher's, not the cashier's:

> **Buscar saldo a favor**
> ScanInput — "Escanea el resguardo o busca por número"
> results: `C-000123 · 80,00 € · Imran K. · 12/08` with an `Emitido` chip

**The seller's name in that row is shown only with `usedDevices.viewSeller`.** As
drawn, the finder would have been a way to read the second-hand register from the
payment panel — type a few letters, collect names. The purchase number printed on
the slip is the identification, and it is what the customer is holding; the name is
a courtesy for staff already allowed to see it. Without the permission the row
reads `C-000123 · 80,00 € · 12/08`.

A voucher that cannot pay for this ticket is **listed and greyed with its reason**
(*Ya usado*, *Mayor que el total*), never hidden. A cashier who cannot see why is
a cashier arguing with a customer about a slip the till appears not to know.

Selecting one adds a tender chip reading `Saldo C-000123 · 80,00 €`. It cannot be edited to
a different amount — a voucher redeems in full — and the ✕ removes it, releasing nothing
because nothing is committed until Cobrar.

If the voucher exceeds the ticket total the finder refuses it with: *"El vale es mayor que
el total. Añade artículos o usa otra forma de pago."*

**Continue-to-sale.** After logging a purchase paid in store credit, the confirmation shows
**Continuar a la venta** (`AccentButton`). It opens Venta with the tender chip already
applied — the customer who just sold a phone and is buying another walks through in one
motion.

---

## 5. Prints

Both are fixed Spanish (ADR-0011) and render through the existing ops model, so the thermal
and PDF paths cannot drift.

### Purchase document — `renderPurchaseDoc`

```
              A R K O M
   E L E C T R O N I C S · P H O N E S
       {shop legal name}
       NIF {nif} · {address}
------------------------------------------
COMPRA DE DISPOSITIVO USADO
C-000123               27/08/2026 12:04
Caja 1 · Atendido por Ana
------------------------------------------
Apple iPhone SE 2020 · 64GB · Blanco
Grado B · Batería 86%
IMEI 352094118803180
Accesorios: cargador, cable
------------------------------------------
VENDEDOR
Imran Khan
DNI Y2841170F
Tel. +34 632 118 044
------------------------------------------
IMPORTE PAGADO            80,00 €
Forma de pago: saldo a favor (vale C-000123)
------------------------------------------
El vendedor declara ser el legítimo
propietario del dispositivo y que no
procede de actividad ilícita.


Firma del vendedor


X ________________________________
------------------------------------------
        Gracias por su visita
```

The declaration line and the signature rule are the reason this print exists; the signature
box is at least 3 blank lines so a pen fits.

### Shelf label — `renderShelfLabel`

Short, for sticking on the box:

```
{barcode as text, Mono, double width}
Apple iPhone SE 2020 64GB
Grado B · C-000123
```

---

## Accessibility / focus order

- Comprar usados: brand → … → IMEI → gate checkbox → price → payout → log. The IMEI field
  keeps scanner focus like every other ScanInput.
- Capture modal: focus the Capturar button; Esc closes and releases the camera track
  (**always release it** — a webcam light left on after the modal closes reads as the shop
  being recorded).
- Voucher finder: focus the search field; Enter selects a single result.
- Every photo tile is a labelled button, and filled tiles announce which slot they fill.
