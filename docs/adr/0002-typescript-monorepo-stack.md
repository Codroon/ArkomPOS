# ADR-0002: All-TypeScript pnpm monorepo — Electron till, Next.js cloud

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
One developer + Claude Code, two weeks for Phase 1. Three deliverables (till, web dashboard,
API) must share one schema and one set of business rules without drift. Every component must
be deep in Claude Code's training distribution and already familiar to the developer.

## Decision
One language, one repo:

- **Monorepo:** pnpm workspaces — `apps/desktop`, `apps/web`, `packages/core`,
  `packages/db`, `packages/ui`.
- **Till:** Electron + Vite + React + TypeScript + Tailwind + shadcn/ui; Zustand for
  in-progress sale state; typed IPC validated with Zod; electron-builder +
  electron-updater for Windows installer and silent updates.
- **Cloud:** one Next.js app on Vercel = dashboard pages + API routes (sync endpoint);
  TanStack Query on the dashboard; Supabase Auth later for dashboard login.
- **Shared:** `packages/core` (domain rules, Zod schemas, totals/tax/ledger math),
  `packages/db` (Drizzle schema for both databases), `packages/ui` (shared primitives).
- **Tests:** Vitest on `packages/core`.
- **No containers.** Local dev is `pnpm dev`; the till ships as an installer, the cloud as
  a Vercel deployment; databases are embedded (SQLite) or managed (Supabase). Docker adds
  overhead and solves nothing here. Reconsidered only if a buyer requires self-hosting.

## Options considered

### Desktop shell: Tauri vs Electron
| Dimension | Tauri | Electron (chosen) |
|-----------|-------|-------------------|
| Bundle size / RAM | Better | Worse — irrelevant on a shop PC |
| Hardware libs (ESC/POS, serial, terminal SDKs) | Thin, Rust bridging needed | Native Node ecosystem |
| Team + Claude Code fluency | Rust required | 100% TypeScript |
| Post-handover maintainability | Niche | Mainstream |

### Cloud API: separate Fastify service vs Next.js API routes
Fastify is cleaner as a standalone service, but it doubles deployments and configs for a
one-person team. Sync logic lives in `packages/core`, so it can be lifted into a dedicated
service later without rewrite. Next.js routes chosen.

## Consequences
- Easier: one mental model; shared validation end-to-end; Claude Code at maximum reliability.
- Harder: Electron bundle discipline; serverless limits on long-running work (acceptable —
  sync is short request/response).
- Revisit: dedicated sync service if/when Vercel limits bite.
