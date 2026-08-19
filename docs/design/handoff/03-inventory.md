# Handoff 03 — Inventario (list + movimientos + entrada de stock)

## Overview
Header: "Inventario" + "Valoración total <b>18.492,60 €</b> (a coste)" (live sum onHand×cost) + right chip "<n> artículos bajo mínimo" (click = applies Bajo-mínimo filter).
Body: stock table; bottom band = **Entrada de stock** panel (mockup's stock-count twin panel is NOT built in P1 — band is single, full-width).
Quantities are display-only everywhere on this screen (req 5.1).

## Stock table (sticky header)
Columns: Artículo (name + mono code) · Cantidad (bold tabular) · Punto de pedido (muted) · Estado (Chip `BAJO MÍNIMO` bordered when onHand ≤ reorderPoint, else "OK" faint) · Coste unitario (muted) · Valoración (onHand×cost). Serialized rows: Cantidad = live unit count, plus `SERIE` chip; their valuation = Σ unit costs.
Filters: Grupo · Tipo · Bajo mínimo. Search by name/code.
Row click → **Movimientos drawer** (this is an addition the mockup omits; req 5.4 mandates it).

## Movimientos drawer (right, 420px)
Header: product name + current onHand. Table: Fecha (dd/mm hh:mm) · Tipo (Chip: ENTRADA / VENTA / AJUSTE) · Cantidad (signed, +bold / −ink-2) · Coste · Documento (docNumber link → read-only ticket peek) · Usuario ("—" until auth). Newest first, infinite scroll (`inventory:movements` cursor). Footer note: "El stock solo cambia mediante movimientos." Empty: "Sin movimientos."

## Entrada de stock panel (`stock:add`)
`bg-panel`, SectionLabel "ENTRADA DE STOCK".
1. ScanInput "Escanea código o introduce IMEI…" — resolves product; unknown code ⇒ inline "No existe · Crear artículo" link.
2. Per-entry fields: Coste por unidad* (mono money) · Cantidad* (int ≥1) — **serialized products instead show an IMEI field, qty locked 1, one row per IMEI** (dup IMEI ⇒ inline error).
3. Proveedor* (select + "Nuevo proveedor" inline create).
4. Staged-lines mini table (name·code | qty × cost | ✕ remove), running total.
5. `Confirmar entrada · <total> €` primary ⇒ one tx: purchase_in movements (+units for IMEIs) → table & valuation update in place, panel clears, focus returns to scan. Success toast "Entrada registrada · <n> líneas".

## States
| Element | State | Behavior |
|---|---|---|
| Confirmar | any line invalid | button disabled; first invalid field focused |
| Confirmar | in-flight | spinner, panel inert |
| Table | after entry | changed rows flash `bg-panel-2` 600ms |
| BAJO MÍNIMO count chip | zero | hidden |
Loading: skeleton rows; valuation header shows "—" until loaded.
