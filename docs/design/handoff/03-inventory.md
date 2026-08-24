# Handoff 03 — Inventario (list + movimientos + entrada de stock)

## Overview
Header: "Inventario" + "Valoración total <b>18.492,60 €</b> (a coste)" (live sum onHand×cost) + chip "<n> artículos bajo mínimo" (click = applies Bajo-mínimo filter) + search + primary **"+ Entrada de stock"** button (F6).
Body: stock table, full height (the mockup's stock-count twin panel is NOT built in P1; receiving moved into its own drawer — see below).
Quantities are display-only everywhere on this screen (req 5.1).

## Stock table (sticky header)
Columns: Artículo (name + mono code) · Cantidad (bold tabular) · Punto de pedido (muted) · Estado (Chip `BAJO MÍNIMO` bordered when reorderPoint > 0 ∧ onHand ≤ reorderPoint; reorderPoint 0 = tracking off, renders "OK" faint like healthy rows — rule codified with PRD 5.2, implemented once in `@arkom/core` isLowStock) · Coste unitario (muted) · Valoración (onHand×cost). Serialized rows: Cantidad = live unit count, plus `SERIE` chip; their valuation = Σ unit costs.
Filters: Grupo · Tipo · Bajo mínimo. Search by name/code.
Row click → **Movimientos drawer** (this is an addition the mockup omits; req 5.4 mandates it).

## Movimientos drawer (right, 420px)
Header: product name + current onHand. Table: Fecha (dd/mm hh:mm) · Tipo (Chip: ENTRADA / VENTA / AJUSTE) · Cantidad (signed, +bold / −ink-2) · Coste · Documento (docNumber link → read-only ticket peek) · Usuario ("—" until auth). Newest first, infinite scroll (`inventory:movements` cursor). Footer note: "El stock solo cambia mediante movimientos." Empty: "Sin movimientos."

## Entrada de stock — right drawer (`stock:add`), reworked 2026-08-25
Receiving is a task the owner sits down to do, so it owns the screen instead of a strip squeezed under the table (the strip felt cramped and easy to miss in live testing). **The Inventario header carries a primary "+ Entrada de stock" button (shortcut F6)**; there is no bottom band.

The drawer is ~**480px**, right side, same pattern as Movimientos: **Esc closes** (but never while the scan picker/rescue is up), focus is **trapped** inside, clicking the backdrop closes. One column, top to bottom:
1. **ScanInput** (autofocus) "Escanea un código o busca por nombre…" — every code goes through `scan:resolve` (primary barcode ∪ additional codes ∪ in-stock IMEIs); typing a name shows an inline match list instead. Several matches ⇒ **ambiguity picker**; no match ⇒ **rescue modal** (create the item with the code prefilled, or attach the code to an existing item and carry straight on) — both work unchanged inside the drawer.
2. **Resolved item card**: name (+ `SERIE`), its code, current stock, and "Cambiar artículo". Before anything resolves, a dashed placeholder explains what to do and the fields below stay disabled — the shape of the task is always visible.
3. **Cantidad first** (focus lands there and selects), then **Coste por unidad***, prefilled with the item's last known cost.
4. Serialized items: the quantity IS the IMEI target. An **"IMEI n de N"** capture loop appears — scan/type → Enter → chip (each removable); invalid Luhn, an IMEI already staged, and one already registered are each rejected inline and the field re-selects so the next scan replaces it. "Faltan n IMEIs" counts down; the line cannot be added until captured == quantity, and it posts as ONE entry (`expectedQty` + `imeis[]`).
5. **Proveedor*** (select + "Nuevo proveedor" inline create).
6. **"Añadir a la lista"** (full width) ⇒ the line joins the staged list and **focus returns to the scan field** for the next box.
7. **Staged lines** occupy real vertical space (name · code/units | qty × cost | ✕ remove); empty state explains itself.
8. Footer: running **Total** + one full-width **Confirmar entrada** ⇒ one tx: purchase_in movements (+units for IMEIs) → table & valuation update in place, success toast "Entrada registrada · <n> línea(s)", and **the drawer clears but stays open** for the next delivery (Esc to leave). Confirmar is disabled while a line is still half-built, so nothing typed is silently discarded.

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
