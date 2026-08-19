# ADR-0011: UI i18n via a typed in-repo dictionary; print path stays Spanish

**Status:** Accepted · **Date:** 2026-08-20 · **Deciders:** Zothix (Codroon)

## Context
The till's customer-facing output is Spanish by requirement (fiscal documents, tickets),
but the staff operating the UI may prefer English. These are two different locale axes
that must never be conflated: what the cashier reads on screen vs. what the customer
receives on paper. Phase 1 needs the split now, before more screens multiply strings.

## Decision
- **Two locale axes.** (1) *UI locale*: toggleable ES/EN, staff-only, default `es`,
  persisted in `localStorage`. (2) *Document locale*: fixed Spanish. The print path
  (ticket rendering, Day 9) owns its own ES string constants and **never** reads the UI
  dictionary — a ticket must look identical regardless of the toggle.
- **Typed dictionary, no dependency.** `packages/ui/src/i18n/es.ts` is the source of
  truth (`as const`); `en.ts` is typed `Record<keyof typeof es, string>`, so a missing or
  extra English key fails `tsc`. No i18n library: our needs are a lookup, `{var}`
  interpolation and a toggle — a dependency would add pluralization machinery we don't use
  (plural forms are explicit keys) and runtime cost on the till.
- **Access only via `useT()`** (React hook over a tiny `useSyncExternalStore` store in
  `@arkom/ui`). Renderer components hold zero hardcoded UI strings.
- **Formats don't switch.** Dates (dd/mm/yyyy hh:mm) and money ("12,34 €") are part of the
  till's visual spec (00-foundations) and stay es-ES in both locales.
- **Typed error codes stay the i18n boundary for errors.** The renderer maps known codes
  (e.g. DUPLICATE_NAME) to dictionary keys; free-form VALIDATION detail messages from the
  domain layer remain Spanish and render verbatim.

## Options considered
i18next/react-intl (runtime + concepts far beyond one toggle; rejected) · per-locale JSON
files (no type safety; missing keys found at runtime; rejected) · no i18n, ES only
(cheapest, but retrofit cost grows with every screen; rejected now that a second screen
exists).

## Consequences
- Easier: adding a screen = adding keys; forgetting a translation is a compile error;
  the print path is structurally isolated from the toggle.
- Harder: two files to touch per string; plural/gender handled by hand (acceptable at
  till-UI scale).
- Revisit: extraction tooling if the dictionary outgrows a few hundred keys; a third
  locale (CA) is an additive file.
