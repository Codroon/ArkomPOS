# Arkom POS — Architecture Decision Records

Decisions are frozen before code. Claude Code builds against these; it does not relitigate them.
If a decision must change, the ADR is superseded by a new one — never silently edited.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-hybrid-desktop-cloud-architecture.md) | Hybrid: offline-first desktop till + cloud web dashboard | Accepted |
| [0002](0002-typescript-monorepo-stack.md) | All-TypeScript pnpm monorepo; Electron till, Next.js cloud | Accepted |
| [0003](0003-sqlite-on-till-postgres-in-cloud.md) | SQLite on the till, Postgres (Supabase) in the cloud, Drizzle on both | Accepted |
| [0004](0004-stock-as-insert-only-movement-ledger.md) | Stock is an insert-only movement ledger | Accepted |
| [0005](0005-oplog-as-sync-outbox-and-audit-log.md) | One append-only oplog = sync outbox + audit log | Accepted |
| [0006](0006-identifiers-and-money.md) | UUIDv7 ids, integer-cent money, basis-point tax rates | Accepted |
| [0007](0007-tax-snapshot-on-lines.md) | Tax regime + rate + amounts snapshotted on every line | Accepted |
| [0008](0008-document-numbering-per-till-series.md) | Gap-free document numbers allocated per till series, locally | Accepted |
| [0009](0009-tenancy-and-location-keys-day-one.md) | tenant / location / terminal keys on every business row | Accepted |
| [0010](0010-auth-deferred-nullable-actor-columns.md) | Auth & shifts deferred; nullable actor columns now | Accepted |
| [0011](0011-ui-i18n-typed-dictionary.md) | UI i18n via typed in-repo dictionary; print path stays Spanish | Accepted |
| [0012](0012-local-pin-auth-and-permission-registry.md) | Local PIN auth, session in main, permissions as a typed registry | Accepted |
| [0013](0013-used-device-purchases-and-store-credit.md) | Used devices as serialized units; purchase document; store credit as a tender | Accepted |
| [0014](0014-repair-tickets-status-from-facts-and-parts-before-revenue.md) | Repair status derived from facts; parts move on consumption, revenue only at collection | Accepted |
| [0015](0015-cash-shifts-derived-status-and-one-drawer-truth.md) | Shift status derived from facts; sale cash never copied into the drawer ledger; the Z is frozen | Accepted |
| [0016](0016-reports-read-completed-documents-and-cost-is-snapshotted.md) | Reports read completed documents by completed_at; cost snapshotted on the sale line | Accepted |
| [0017](0017-product-groups-belong-to-the-shop.md) | Every install seeds groups the shop owns; create and rename in-app; no delete | Accepted |
| [0018](0018-transfers-are-a-shadow-log-and-the-principal-is-never-revenue.md) | WU counter shadow-logged; principal is pass-through, never revenue; cancel reverses in full | Accepted |
| [0019](0019-a-refund-is-a-second-document-and-verification-touches-no-money.md) | Refund = own D1- document; tax reverses at the original snapshot; WU verification moves no cash | Accepted |
| [0020](0020-the-till-enrols-with-the-cloud-and-photographs-stay-home.md) | Till enrols once for a device token; oplog pushes up-only; passcodes and photographs never leave the shop; EU region, shop is controller | Accepted |

Constraints common to all: team = one developer + Claude Code · Phase 1 = 2 weeks (sale screen, catalog, inventory) ·
client = retail mobile shop in Spain (unreliable connectivity, Spanish fiscal rules ahead) · product intent = resell to
similar retailers after first onboarding.
