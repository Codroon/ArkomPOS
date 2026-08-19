# Handoff 01 — Venta (Sale screen)

## Overview
Split layout: left = find products, right (400px fixed) = the ticket being built + payment.
Header strip: "Venta — Till 1" + draft state ("Ticket en curso"; number appears only after completion) + KbdHint "F2 buscar · F4 cobrar · F8 aparcar".

## Left column
1. **Search band** (`bg-panel-2`): ScanInput full-width. P1 drops the mockup's IMEI/Customer buttons (IMEI selection happens via the unit-pick modal; no customers).
2. **Group filter chips**: from `productGroups`, "Todos" + one per group; active chip inverted (`ink-2` bg, white).
3. **Product grid**: per group section (uppercase SectionLabel + count), 4-col card grid. Card: name (11px, 2-line clamp), SKU/barcode mono faint, price bold tabular; hover border `#71717a`. Click = add line. Serialized products show a `SERIE` chip on the card. Grid virtualizes past ~200 visible cards.

## Right column — ticket
- Header: "Ticket" + line count.
- Lines list (scroll): white rows, 12px name + mono sub-line (`barcode · qty × unit-price`), bold total right. `serialized_unit` line: `SERIE` chip + sub-line `IMEI <imei> · 1 × price`; left border 3px `ink-3`. Overridden price: sub-line adds `PVP original <x> · motivo: <reason>` and a `MODIFICADO` chip.
- Line interactions: click qty area → stepper (− qty +; serialized locked at 1); long-press/⋯ menu → "Modificar precio" (opens override modal: new price + required reason ⇒ `sale:overridePrice`), "Eliminar línea".
- **Totals strip** (`bg-panel-2`, tabular): Subtotal (base) · IVA 21% · TOTAL (20px bold). Values always from server state (never recomputed in renderer).

## Payment panel
- 4 tender tiles: Efectivo · Tarjeta · Bizum · Transferencia (mockup's Credit tile dropped in P1). Tap tile → amount input pre-filled with remaining due; multiple tenders allowed; running "Pendiente / Cambio" line (cash over-tender ⇒ change; non-cash cannot exceed due — typed error TENDER_MISMATCH).
- **Tarjeta (P1 standalone mode):** amount + `Referencia (datáfono)` text field (required, ≥4 chars) replacing the mockup's terminal simulation block entirely.
- **Cobrar** primary button (F4): disabled until lines>0 ∧ tenders cover total. Success ⇒ `sale:complete` tx → show completed state: doc number (e.g. `T1-000123`) + "Imprimir ticket" (auto-print once, button reprints) + "Nueva venta" (auto after 4s or Enter).
- Failure paths: NEGATIVE_STOCK / UNIT_NOT_AVAILABLE ⇒ toast + offending line flashes; sale stays open.

## Park / resume (F8)
"Aparcar" prompts optional label (default time), clears screen. Header gains "Aparcadas (n)" chip → popover list (label · lines · total) → resume loads draft. Parked drafts survive restart (they're documents in `parked` status).

## States
| Element | State | Behavior |
|---|---|---|
| ScanInput | barcode hit | line added, input clears, stays focused; beep-free (visual flash on line) |
| ScanInput | no match | shake + "Sin resultados para <code>" inline, offers "Crear artículo" → Catálogo prefilled |
| Scan of serialized product's barcode | — | unit-pick modal: in-stock units (IMEI mono · cost-in date); scan/type IMEI filters; select ⇒ line, unit `reserved` |
| Scan of an IMEI directly | in stock | adds that unit's line immediately |
| Grid | empty catalog | empty state "Catálogo vacío" + "Ir a Catálogo" |
| Cobrar | in-flight | spinner in button, panel inert (single submit) |

## Accessibility / focus order
Scan → chips → grid → ticket lines → tenders → Cobrar. All modals trap focus; Esc cancels (never mid `sale:complete`).
