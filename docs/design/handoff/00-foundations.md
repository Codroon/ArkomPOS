# Handoff 00 — Foundations (all screens)

Source of truth for look & behavior: `docs/design/mockup.html`. This spec translates it into
buildable rules and codifies the **deliberate deviations** for Phase 1. Where this file and the
mockup disagree, this file wins.

## Phase-1 deviations from the mockup (codified, not accidental)
| Mockup shows | Phase 1 builds | Why |
|---|---|---|
| Shift chip "Shift OPEN · 08:32", cashier chip "Muhammad A." | Terminal chip only ("Till 1") + date | ADR-0010: no auth/shifts |
| Semi-integrated card flow (Send to terminal → waiting → approved, AXIUM) | Card = amount + **reference field** (typed from standalone terminal receipt) | ADR/stack: terminal SDK is a later phase; req "standalone fallback" |
| Refund / Void / Discount / Customer buttons | Rendered **disabled** with lock badge (Discount already is) | Out of P1 scope; keeps layout honest |
| Repair / trade-in / agency example lines in ticket | Only `product` and `serialized_unit` lines can exist | P1 line types |
| Stock-count panel on Inventory | Not rendered | Req 7 is a later phase |
| English labels | **Spanish labels** (table below) | Customer-facing = ES (CLAUDE.md) |
| "Customer: María Fernández" in ticket header | Omitted | No customers in P1 |

## Design tokens (extracted from mockup — wireframe-grade, zinc ramp)
| Token | Value | Usage |
|---|---|---|
| `bg-app` | #e8e8ea | main canvas |
| `bg-panel` | #f4f4f5 | topbar, nav, right panels |
| `bg-panel-2` | #efeff0 | table headers, totals strip, search band |
| `bg-card` | #ffffff | cards, rows, inputs |
| `border-strong` | #b8b8bd | structural separators |
| `border` | #d4d4d8 | cards, row dividers (#e4e4e7 for light rows) |
| `border-input` | #a1a1aa | inputs (required fields: #71717a) |
| `ink` | #18181b | primary text |
| `ink-2` | #3f3f46 | secondary text, primary buttons bg |
| `ink-3` / `muted` | #52525b / #6b6b70 | tertiary / labels |
| `faint` | #9a9aa0 · #a1a1aa | placeholders, hints |
| accent | none — monochrome by design | keep it; no colors added in P1 |

Type: `system-ui, -apple-system, 'Segoe UI', sans-serif`; money/codes in `ui-monospace` with
`font-variant-numeric: tabular-nums`. Sizes seen: 9/10/11/12/15/20px. Section labels:
10px, 700, letter-spacing .1em, uppercase, `muted`.
Implement tokens as Tailwind theme extensions in `packages/ui` — components reference tokens, never raw hex.

## App shell
- Topbar 44px `bg-panel`, bottom border `border-strong`: brand "ARKOM POS", spacer, Till chip, date (tabular). 
- Left nav 186px `bg-panel`: numbered items (01 Venta…); active = `bg #e0e0e3`, 3px left border `ink-2`, bold. Phase-1: only Venta/Catálogo/Inventario enabled; the rest rendered muted with lock badge, non-navigable.
- Main = `bg-app`. Fixed desktop layout, min window 1280×860; no responsive breakpoints (till hardware), window resizable but layout clamps.

## Shared components (packages/ui)
`ScanInput` (always-refocusing search, ⌕ + SCAN kbd chip) · `SectionLabel` · `Chip` (line-type/status badges: 9px 700 bordered) · `DataTable` (sticky header row style above) · `MoneyText` (cents→"12,90 €", tabular) · `PrimaryButton` (`ink-2` bg, white text) / `GhostButton` (white, `border-input`) · `LockedButton` (disabled + LOCK monospace badge) · `Field` (label style + input) · `KbdHint`.

## Global behaviors
- **Scanner = keyboard wedge.** ScanInput auto-refocuses on blur (100ms) unless a modal input is focused; Enter = submit scan. Barcode heuristic: ≥8 digits fast-entry ⇒ treat as scan, else search-as-you-type (150ms debounce).
- Keyboard: F2 focus scan · F4 charge · F8 park (venta only). Esc closes modal/drawer.
- Money input: text field, accepts "12,90"/"12.90", parsed→cents at boundary; blur reformats.
- Errors: typed codes from IPC → inline field messages (11px, ink-2) or toast for tx-level (e.g. NEGATIVE_STOCK).
- Empty/loading: tables render skeleton rows (3, `bg-panel-2` shimmer) <300ms only; empty state = centered muted 12px text + primary action.
- Dates: dd/mm/yyyy hh:mm. Language: ES labels below; code stays EN.

## ES label table (customer/staff-visible strings)
> Since ADR-0011 these labels live as keys in the typed dictionary
> (`packages/ui/src/i18n/es.ts` — this table remains the canonical Spanish values; `en.ts`
> mirrors the key map). UI locale is staff-toggleable (ES/EN chip in the topbar); ticket
> printing always uses fixed Spanish strings, independent of the toggle.
Venta · Catálogo · Inventario · Buscar o escanear producto… · Grupo · Coste · PVP · IVA ·
Stock · Tipo · Nuevo artículo · Guardar · Cancelar · Ticket · Subtotal (base) · IVA 21% ·
TOTAL · Efectivo · Tarjeta · Bizum · Transferencia · Cobrar (F4) · Aparcar (F8) · Recuperar ·
Entrada de stock · Cantidad · Coste por unidad · Proveedor · Confirmar entrada · Movimientos ·
Punto de pedido · Valoración · BAJO MÍNIMO · Referencia (datáfono) · Motivo · Importe recibido ·
Cambio · Imprimir ticket · SERIE (serialized badge) · Ver movimientos
Group names seed: Móviles · Protectores · Cargadores y Cables · Auriculares · Memoria y Ordenador
