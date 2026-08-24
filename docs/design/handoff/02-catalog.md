# Handoff 02 — Catálogo (list + add/edit)

## Overview
Header: "Catálogo" + item count + search (260px, name/code) + `+ Nuevo artículo` primary.
Body: list table (flex) + right editor panel (380px, `bg-panel`). Editor doubles for create/edit; on narrow data it's always visible with empty state "Selecciona un artículo".

## Filters row (under header)
Chips/selects: Grupo · Tipo · **Bajo mínimo** · **Datos incompletos** (req 3.2/3.3). Filters combine; active count shown; "Limpiar".

## Table (sticky header)
Columns: Código (mono, faint) · Nombre · Grupo · Tipo (Chip) · Coste (right, muted) · PVP (right, bold) · IVA (right) · Stock (right).
- Missing-data rows: `bg #f6f6f7` + per-cell "—" with warning chip `FALTA` on the missing field(s); row always clickable to fix (req 3.3).
- Stock cell is read-only display from `product_stock` (editing lives in Inventario).
- Row click → load into editor; selected row `bg #eceef0`.
**Product identity (added 2026-08-24).** The barcode field is labelled *"Código de barras (el de la caja)"* with the helper *"Escanea aquí el código real del producto"* — capturing the manufacturer's code is the point, because that is what gets scanned later. Generating an internal code is the fallback: a small text button, shown only while the field is empty (auto-generation on an empty save is unchanged). Below it, **"Códigos adicionales"** holds every other code the item answers to, as removable chips (removal asks first). Attaching a code that other products already use — or saving a primary barcode that is already in use — shows *"Ese código ya está en otro artículo: X"* and proceeds only on confirmation (PRD 4.4 amended). Duplicate names are still blocked outright.

- Sort by Nombre default; header click sorts (Nombre, PVP, Stock). **P1 deviation:** no virtualization — plain scroll. A one-shop catalog is ≤ a few hundred rows; windowing (a dep or hand-rolled scroller) buys nothing at that scale. Same call applies to Venta's product grid. Revisit if a real catalog import lands thousands of rows.

## Editor panel (create/edit — `catalog:save`)
Fields, top→down (Field component; required inputs use `border-input`-strong #71717a):
1. Nombre* (text, unique per tenant → DUPLICATE_NAME inline)
2. Código de barras (el de la caja) (mono; SCAN works here; helper "Escanea aquí el código real del producto"; while empty, a small text button "Generar código interno (solo si no tiene código)" ⇒ core auto-EAN, and an empty save still auto-generates; **no longer unique** — a code already in use warns and names the holders, then proceeds on confirmation, PRD 4.4 amended)
2b. Códigos adicionales (scan/type ⇒ chip; ✕ asks to confirm; same shared-code warning on attach; disabled until the item has been saved once, since codes attach immediately)
3. Grupo* (select from productGroups)
4. Coste* · PVP* · IVA* (three-up grid; IVA select: 21% only enabled in P1, others visible-disabled "próximamente")
5. Margen calculado (live, muted: "36,60 € · 24,6%" from PVP−Coste; pure display)
6. Tipo de artículo: segmented — **Stock** / **Serializado** enabled; Usado/Servicio/Reparación/Agencia visible-disabled (P1). Serializado hint: "Requiere IMEI por unidad en la venta."
7. Punto de pedido · Umbral bajo stock (int, default 0)
8. Activo (switch, default on)
Footer: Guardar (primary; disabled until dirty ∧ Zod-valid) · Cancelar · Eliminar rendered LockedButton (P1: deactivate only via Activo switch — deletes are never allowed once movements exist).

## States
| Element | State | Behavior |
|---|---|---|
| Guardar | server dup error | field-level message under Nombre/Código; no toast |
| Editor | switching row with unsaved changes | confirm dialog "Descartar cambios?" |
| Tipo change Stock→Serializado with existing on-hand > 0 | blocked | inline: "Tiene stock por cantidad; no se puede serializar." (typed error) |
| Search | ≥2 chars | debounced 150ms server filter |
| List | empty (filters) | "Sin resultados" + Limpiar filtros |

New item created via scan-miss on Venta arrives with barcode prefilled and focus on Nombre.
