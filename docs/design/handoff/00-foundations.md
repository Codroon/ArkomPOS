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

## Design tokens (Arkom brand identity manual v1.0)
The mockup's zinc ramp was wireframe scaffolding and is **retired**. The palette below is
the manual's, and it is the whole palette: five brand colours, four functional pairs
derived from them, nothing else. Components reference tokens by MEANING, never raw hex.

Brand colours: Signal Blue `#2F9BFF` · Graphite 900 `#15181B` · Graphite 700 `#2A2F35` ·
Gray 400 `#70777D` · Bone `#F1EFE9`.

| Token | Value | Usage |
|---|---|---|
| `canvas` | #f1efe9 | Bone — the main working surface |
| `surface` | #eae7de | nav, drawers, panels beside the canvas |
| `surface-2` | #e4e1d7 | table headers, totals strips, footers |
| `card` | #ffffff | rows, cards, inputs — paper on the counter |
| `inverse` / `inverse-2` | #15181b / #2a2f35 | Graphite topbar + active nav; hairlines on dark |
| `inverse-ink` / `inverse-muted` | #f1efe9 / #70777d | Bone text on graphite; its muted partner |
| `ink` / `ink-2` | #15181b / #2a2f35 | primary / secondary text |
| `muted` / `subtle` | #70777d / #9b9a92 | labels, tertiary / placeholders, hints |
| `line` / `line-strong` | #dcd8cd / #c4bfb1 | hairlines, dividers / structural separators, input borders |
| `accent` | #2f9bff | Signal Blue — **the one blue**, see the rule below |
| `accent-ink` | #15181b | text on blue, always. Never white. |
| `focus` | #2f9bff | focus ring |
| `warning-bg` / `warning-ink` | #f6e7c3 / #6a4a05 | BAJO MÍNIMO — must read across the shop |
| `danger-bg` / `danger-ink` | #f7dbd6 / #7a2015 | rejected scans, destructive confirmations |
| `success-bg` / `success-ink` | #d9ead9 / #1d5127 | completed sale, accepted entry |
| `info-bg` / `info-ink` | #dceeff / #0b3a66 | a blue *tint* is allowed as a surface, with dark ink on it |
| `hover` / `active` / `row-selected` / `row-flagged` | #e7e4da / #ddd9cd / #e4e1d7 / #f7f5ef | interaction + row states |

### The one-blue rule
> "Blue appears on ONE piece per surface. Everything else is neutral." — manual, page 03

That one piece is the screen's **primary action**: Cobrar on Venta, Confirmar entrada in the
receiving drawer, Guardar in Catálogo. It is `AccentButton`, and there is one per screen. A
second blue thing on a screen is a bug — demote it to `PrimaryButton` (graphite) or a ghost.

### Two contrast bans, both non-negotiable
1. **White on blue is banned.** Signal Blue is light and bright; white text on it fails
   contrast. Text on blue is always Graphite 900 — `accent-ink`.
2. **Blue body text on Bone is banned.** Blue on the Bone canvas is far too weak to read.
   Blue is a *surface* colour for the one primary action — never prose, labels, links or data.

### Type
| Face | Weight | Where |
|---|---|---|
| Archivo Black (`font-display`) | 400 | the ARKOM wordmark, TOTAL, the completed-sale amount |
| IBM Plex Sans (`font-sans`) | 400/500/600 | everything else in the UI |
| IBM Plex Mono (`font-mono`) | 500 | data: codes, IMEIs, quantities, till/clock |
| IBM Plex Mono (`font-mono`) | 700 | money, always, with `tabular-nums` |

Fonts are vendored as woff2 in `packages/ui/src/fonts` — no CDN, the till is offline.
Sizes seen: 9/10/11/12/15/20px. Section labels: 10px, 700, letter-spacing .1em, uppercase, `muted`.


## App shell
- Topbar 44px `inverse` (Graphite 900) sitting under a 3px `accent` underline — the one place blue spans a full edge: wordmark "ARKOM" in Archivo Black + "POS" in Mono, spacer, locale chip, Till chip, date (Mono, tabular).
- Left nav 186px `surface`: numbered items (01 Venta…); active = inverted (`inverse` bg, `inverse-ink` text, bold) — graphite, never blue. Phase-1: only Venta/Catálogo/Inventario enabled; the rest rendered muted with lock badge, non-navigable.
- Main = `canvas`. Fixed desktop layout, min window 1280×860; no responsive breakpoints (till hardware), window resizable but layout clamps.

## Shared components (packages/ui)
`ScanInput` (always-refocusing search, ⌕ + SCAN kbd chip) · `SectionLabel` · `Chip` (line-type/status badges: 9px 700 bordered) · `DataTable` (sticky header row style above) · `MoneyText` (cents→"12,90 €", Mono 700, tabular) · `AccentButton` (`accent` bg, `accent-ink` bold text — the one blue, one per screen) / `PrimaryButton` (`ink` bg, `inverse-ink` text) / `GhostButton` (`card`, `line-strong`) · `LockedButton` (disabled + LOCK monospace badge) · `Field` (label style + input) · `KbdHint`.

## Global behaviors
- **Scanner = keyboard wedge.** ScanInput auto-refocuses on blur (100ms) unless a modal input is focused; Enter = submit scan. Barcode heuristic: ≥8 digits fast-entry ⇒ treat as scan, else search-as-you-type (150ms debounce).
- Keyboard: F2 focus scan · F4 charge · F8 park (venta only). Esc closes modal/drawer.
- Money input: text field, accepts "12,90"/"12.90", parsed→cents at boundary; blur reformats.
- Errors: typed codes from IPC → inline field messages (11px, `danger-ink`) or toast for tx-level (e.g. NEGATIVE_STOCK).
- Empty/loading: tables render skeleton rows (3, `surface-2` shimmer) <300ms only; empty state = centered muted 12px text + primary action.
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
