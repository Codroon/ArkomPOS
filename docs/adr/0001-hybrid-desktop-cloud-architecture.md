# ADR-0001: Hybrid architecture — offline-first desktop till + cloud web dashboard

**Status:** Accepted · **Date:** 2026-08-14 · **Deciders:** Zothix (Codroon)

## Context
The client runs a retail mobile shop in Spain. The till must never stop selling because the
internet dropped, and it must drive local hardware (barcode scanner, ESC/POS printer, cash
drawer, later a card terminal). The owner also wants to see sales, stock and reports from
anywhere in a browser. After this client, Arkom POS will be sold to similar retailers, so the
cloud side must be multi-tenant-ready.

## Decision
Two applications, one product:
1. **Desktop till (Electron)** installed on the shop PC. Fully functional offline. Owns all
   operational writes: sales, stock movements, cash. Owns all hardware.
2. **Cloud (web dashboard + API)**. Read model of everything the till does, synced up from
   the till. This is what gets resold: new tenant → new tills → same cloud.

**Direction of edits, v1: up only.** The till pushes; the browser reads. Down-sync of
catalog edits from the web is a later, separate decision — the sync design (ADR-0005)
already leaves room for it.

## Options considered

### A — Web-only SaaS (browser POS)
Simplest to build and resell, but a browser till fails the two hard requirements: offline
operation and reliable hardware access. Rejected.

### B — Desktop-only (no cloud)
Fastest for client #1, but no remote visibility for the owner and nothing to productize.
Rejected.

### C — Hybrid (chosen)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — sync is the added cost, contained by ADR-0004/0005 |
| Offline resilience | Full — till is self-sufficient |
| Hardware | Full — Node-side access in Electron |
| Resale path | Strong — cloud is the multi-tenant product |

## Consequences
- Easier: bulletproof till UX; clear resale story; cloud outages never stop selling.
- Harder: two runtimes to ship; sync correctness is now core domain logic we own.
- Revisit: down-sync (web-edited catalog) after Phase 2; self-hosted cloud only if a
  future buyer demands it.

## Action items
1. [ ] Monorepo scaffold reflecting the split (ADR-0002).
2. [ ] Sync designed now, built after Phase 1 (ADR-0005).
