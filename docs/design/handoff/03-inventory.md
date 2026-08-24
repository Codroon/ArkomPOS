# Handoff 03 — Inventario (list + movimientos + entrada de stock)

## Overview
Header: "Inventario" + "Valoración total <b>18.492,60 €</b> (a coste)" (live sum onHand×cost) + right chip "<n> artículos bajo mínimo" (click = applies Bajo-mínimo filter).
Body: stock table; bottom band = **Entrada de stock** panel (mockup's stock-count twin panel is NOT built in P1 — band is single, full-width).
Quantities are display-only everywhere on this screen (req 5.1).

## Stock table (sticky header)
Columns: Artículo (name + mono code) · Cantidad (bold tabular) · Punto de pedido (muted) · Estado (Chip `BAJO MÍNIMO` bordered when reorderPoint > 0 ∧ onHand ≤ reorderPoint; reorderPoint 0 = tracking off, renders "OK" faint like healthy rows — rule codified with PRD 5.2, implemented once in `@arkom/core` isLowStock) · Coste unitario (muted) · Valoración (onHand×cost). Serialized rows: Cantidad = live unit count, plus `SERIE` chip; their valuation = Σ unit costs.
Filters: Grupo · Tipo · Bajo mínimo. Search by name/code.
Row click → **Movimientos drawer** (this is an addition the mockup omits; req 5.4 mandates it).

## Movimientos drawer (right, 420px)
Header: product name + current onHand. Table: Fecha (dd/mm hh:mm) · Tipo (Chip: ENTRADA / VENTA / AJUSTE) · Cantidad (signed, +bold / −ink-2) · Coste · Documento (docNumber link → read-only ticket peek) · Usuario ("—" until auth). Newest first, infinite scroll (`inventory:movements` cursor). Footer note: "El stock solo cambia mediante movimientos." Empty: "Sin movimientos."

## Entrada de stock panel (`stock:add`) — rebuilt 2026-08-24 for discoverability
`bg-panel`, SectionLabel "ENTRADA DE STOCK". **The whole shape is always visible** — find · Cantidad · Coste por unidad · Proveedor · staged lines · Confirmar — with the per-line fields *disabled* until an item resolves. Nothing about the feature is hidden behind a successful scan (the failure that prompted this: a real box code returned "no results" and the panel looked empty/missing).
1. ScanInput "Escanea un código o busca por nombre…" — every code goes through `scan:resolve` (primary barcode ∪ additional codes ∪ in-stock IMEIs); typing a name shows an inline match list instead. Several matches ⇒ **ambiguity picker**; no match ⇒ **rescue modal** (create the item with the code prefilled, or attach the code to an existing item and carry straight on). A resolved item shows as a chip with "Cambiar artículo".
2. **Quantity first:** focus lands on Cantidad. Coste por unidad* prefills from the item's last cost.
3. Serialized items: the quantity IS the IMEI target. An **"IMEI n de N"** capture loop appears — scan/type → Enter → chip; invalid Luhn, an IMEI already staged, and one already registered in the system are each rejected inline. "Faltan n IMEIs" counts down; the line cannot be added until captured == quantity, and it posts as ONE entry (`expectedQty` + `imeis[]`).
4. Proveedor* (select + "Nuevo proveedor" inline create).
5. Staged-lines mini table (name · units | qty × cost | ✕ remove), running total.
6. `Confirmar entrada · <total> €` primary ⇒ one tx: purchase_in movements (+units for IMEIs) → table & valuation update in place, panel clears, focus returns to scan. Success toast "Entrada registrada · <n> líneas".

## States
| Element | State | Behavior |
|---|---|---|
| Confirmar | any line invalid | button disabled; first invalid field focused |
| Confirmar | in-flight | spinner, panel inert |
| Table | after entry | changed rows flash `bg-panel-2` 600ms |
| BAJO MÍNIMO count chip | zero | hidden |
| Scan (any screen) | one match | resolves instantly — no extra click |
| Scan (any screen) | several matches | ambiguity picker: name, price, current stock, SERIE badge for units |
| Scan (any screen) | no match | rescue: "Crear artículo nuevo" (code prefilled) or "Asignar a un artículo existente" |
| Scan (any screen) | known IMEI, phone sold/reserved | says so; no create/attach offered |
Loading: skeleton rows; valuation header shows "—" until loaded.
