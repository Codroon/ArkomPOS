# ADR-0012: Local PIN authentication, session in main, permissions as a registry

**Status:** Accepted · **Date:** 2026-08-25 · **Deciders:** Zothix (Codroon)
**Supersedes the deferral in** [ADR-0010](0010-auth-deferred-nullable-actor-columns.md) — that ADR's
nullable actor columns are exactly what this one fills in. It is not otherwise changed.

## Context

v0.9.0 is installed on the client's till and selling. Its audit trail answers *what, when
and where* but not *who*, which ADR-0010 accepted for the pilot. Two things now force the
question: the owner wants price overrides attributable to a person, and the modules queued
behind this one (used-device purchase, repairs, workshop schedule) are meaningless without
roles — a technician must not be able to open the cash drawer.

The constraints that shape every decision below:

- **The till is offline-first and often offline.** Authentication cannot depend on a network
  round-trip, ever.
- **The threat model is a shop counter, not the internet.** The realistic risks are a
  cashier granting themselves a discount, a member of staff repudiating an action, and a
  customer or passer-by touching an unattended till. Not a remote attacker.
- **Speed is the product.** A cashier logs in dozens of times a day between customers. A
  password would be written on a sticky note within a week.
- **The upgrade must be lossless in place.** There are real sales in that database.

## Decision

### 1. Local PIN credentials, separate from Phase 2 cloud auth — permanently

A `users` table on the till holds name, role, PIN hash and permission overrides. It is the
**only** authority the till consults. When the Phase 2 Supabase dashboard arrives it will
have its own identities (email + password, the owner on a phone in a different building),
and the two are **not unified**. They stay separate because:

- The till must authenticate with the internet unplugged. Supabase cannot, and caching a
  JWT to bridge outages means an offline till trusts a token it cannot revoke.
- They authenticate different things for different reasons. The till proves "the person at
  this counter is Ana" for attribution on a receipt. The cloud proves "this browser belongs
  to the owner" for reading reports. One is a physical-presence check, the other a remote
  session.
- The lifecycles differ. A cashier who leaves is deactivated on the till that day. Cloud
  accounts belong to the business owner and outlive staff turnover.

The join between them is a **link, not a merge**: a future `users.cloud_user_id` (nullable)
maps a till user to a dashboard identity for reporting. Nobody signs in to the till with
cloud credentials, and no cloud session grants till permissions.

### 2. PIN policy and hashing

4–6 digits. Rejected: all-same-digit, ascending or descending runs of 3+ (`1234`, `4321`),
and a short blocklist of dates and keypad patterns. The PIN crosses IPC once as a string,
is compared, and is dropped. It never enters a log line, an oplog payload, or an error
message — including "wrong PIN" errors, which say only that.

Hashed with **argon2id** via `@node-rs/argon2` (N-API, prebuilt, ABI-stable across Electron
versions), per-user salt, constant-time verification. Node's built-in `crypto.scrypt` is a
documented, drop-in fallback behind a two-function interface (`hashPin`, `verifyPin`) if
the packaged build objects — the packaging risk is verified in the **first** build slice,
not discovered at `build:win`.

**The honest reason the KDF choice is not critical:** a six-digit PIN has a million
possible values. Anyone holding the database file can exhaust that space regardless of
which KDF guards it — argon2id makes it expensive, not impossible. The real control is the
lockout below plus the physical security of the shop. The KDF exists so that a stolen
backup does not hand over PINs *instantly*, and so that PINs reused elsewhere by staff are
not trivially recovered. Hashes never leave the main process.

### 3. Lockout is persisted and per-person

`failed_attempts` and `locked_until` live on the user row, so a lockout survives killing
the app — the obvious bypass, closed. Escalation: **5 failures → 1 minute, next 5 → 5
minutes, thereafter 15 minutes.** A success resets the counter.

It locks **the person, not the till**: a cashier fumbling their PIN must never stop the
owner from selling. The same counter governs login, unlock, and approval attempts alike,
because otherwise the approval keypad becomes an unrated oracle for guessing the owner's
PIN.

### 4. Session lives in the main process

The renderer never holds a credential, a hash, or a role it can edit. It receives
`SessionInfo { userId, name, role, permissions[] }` and subscribes to session-change
events. The session is memory-only: **an app restart always lands on Login.** A stolen or
tampered renderer can lie to itself about what to draw and gain nothing.

### 5. Two layers: session, then per-action authorization

- **Layer 1 — session.** Every IPC handler is registered through
  `handle(channel, permission, fn)` and receives the session as its first argument. A call
  with no valid session, or a session lacking the permission, is rejected **in main**.
- **Layer 2 — approval.** An action a user cannot perform but which is marked `approvable`
  raises `APPROVAL_REQUIRED`. The renderer collects an owner's PIN and retries the same
  call; on success the action executes **in that same IPC call**, stamped with both
  `user_id` (who did it) and `authorized_by_user_id` (who allowed it).

Dual attribution is the point. "Ana discounted this phone" and "Ana discounted this phone
and Ahmer approved it" are different facts, and the second is the one that settles an
argument. Approval is **single-use**: a fresh PIN every time, no "stay authorized for five
minutes" window, because such a window is exactly the thing a cashier learns to exploit.

Hiding a button in the renderer is a convenience for the user, never the control.

### 6. A permission registry, not an RBAC framework

One file in `packages/core` lists every permission as
`{ key, module, labelEs, approvable }`, with role defaults beside it. Effective permissions
= role defaults merged with the user's `permission_overrides`. Rejected: a generic
roles/permissions/role_permissions schema with a management UI to match. For a shop with
two to five staff that is three tables, three screens and a join to answer a question a
static object answers at compile time — and it moves the definition of "what a cashier can
do" out of code review and into production data, where it cannot be tested.

The registry is typed, so a permission key that does not exist is a **compile error** at
every call site.

`role` is a plain text column validated by Zod in code, with **no CHECK constraint**:
adding a role is an edit to one file, not a migration. This is deliberate — see *Reserved
for future modules*.

### 7. Overrides are per-user, and the owner cannot be reduced

`permission_overrides` is a JSON map of `key → boolean` on the user row: grant a specific
cashier `catalog.edit` without inventing a role for them. The owner role short-circuits
`can()` to true regardless of overrides, so nobody can lock the owner out of their own
shop, including themselves.

At least one active owner must exist at all times — enforced in core, not the UI.

### 8. Recovery has two paths, one of them printed

- **Cashier forgets:** the owner resets the PIN from Usuarios. No ceremony needed; the
  owner is physically present.
- **Owner forgets:** a 12-character recovery code is generated when the owner is created,
  stored hashed, and **shown exactly once** with a print button and an explicit "I have
  saved it" confirmation. It goes in the shop's safe or folder. Entering it on the Login
  screen allows setting a new PIN and prints a fresh code.

There is deliberately **no back door** — no master PIN, no support override, nothing
derived from the machine. A recoverable-by-the-vendor till is a till whose audit trail an
employment tribunal can dismiss. The cost is honest: lose the code and forget the PIN, and
the recovery is a developer restoring from a backup on site. Phase 2 adds cloud-assisted
reset, which is the right home for it because it requires an out-of-band identity.

### 9. Auth events go in the oplog, not a new table

Login, logout, lock, unlock, failed attempt, lockout, PIN reset, approval granted and
denied are written as oplog entries (`entity: "user"` / `"session"`). ADR-0005 says *no
second logging system, ever*, and the reasons hold here: these events are exactly what the
Phase 2 dashboard needs ("who was on the till at 14:20?"), the oplog already syncs, and a
separate table would need its own sync path and its own retention policy.

The volume objection does not survive contact with the lockout: five failed attempts per
user per minute is the ceiling, and real days produce a few dozen auth rows against
hundreds of sale rows.

## Options considered

**Windows user accounts / OS-level login.** Free, and wrong: the shop shares one Windows
session on one machine, staff would need Windows accounts created by someone who knows the
admin password, and switching users means a slow OS session switch between customers.

**Password instead of PIN.** Stronger in theory. In a shop it is written on the monitor,
or it is four characters long, and either way it is slower than a keypad. The threat model
does not justify the friction.

**Cloud-first auth with an offline cache.** Unifies identity, and fails the first
requirement: the till must work with the router unplugged. A cached credential is a
credential that cannot be revoked, which is worse than a local one that can.

**Per-user OS keychain / DPAPI for hashes.** Ties the database to one Windows profile and
breaks restore-to-a-new-machine, which is a documented procedure (DEPLOYMENT.md §7).

**A generic RBAC schema.** See §6.

## Consequences

**Easier:** every existing gated action already writes a full oplog entry with a reason —
only the "who" was missing, so this slice fills columns rather than inventing mechanisms.
Attribution arrives everywhere at once because it is stamped in `mutate()`, not per
handler.

**Harder:** every IPC handler must now declare a permission, and the guard makes that a
compile-time obligation rather than a convention. Adding a channel without thinking about
who may call it becomes impossible, which is the intent.

**Accepted risk:** a determined holder of the database file can brute-force a 6-digit PIN
offline. Mitigated by the backup destination being the shop's own USB stick, and by the
till being physically behind a counter. Revisit if Arkom POS is ever resold into an
environment where the database leaves the premises.

**Revisit:** PIN length floor (4 may become 6 once staff count grows), idle-lock default
after watching real use, and whether approval should be able to fall back to the recovery
code when the owner is out of the shop — currently it cannot, by design.

## Reserved for future modules

The next three modules are **used-device purchase (trade-in)**, the **repair portal**, and
the **workshop schedule**. Nothing here is built now. The rules below are the contract this
design commits to, and each is shown to hold against the shape above.

### Rule 1 — a new role is one addition to the registry file

Because `role` is a text column with no CHECK constraint (§6) and defaults live in code, a
role is a name plus a default permission set. **No migration, no schema change, no UI
change.**

Worked example — **Technician** (`técnico`), when the repair module lands:

```
repair.view · repair.update_status · workshop.schedule.view
```

and nothing else. Not `sale.create`, not `catalog.edit`, not `inventory.receive` — a
technician who can receive stock is a technician who can quietly write off a part. The
Usuarios screen renders their toggles from the registry with no code change, because it
already groups by `module`.

### Rule 2 — a new module is a namespaced key set

Adding keys to the registry is sufficient. The Usuarios override toggles and the Approval
modal both read the registry, so both pick up new keys with **no changes**:

| Module | Keys | Approvable |
|---|---|---|
| `repair` | `repair.create`, `repair.view`, `repair.assign_technician`, `repair.update_status`, `repair.quote.approve`, `repair.release_without_payment` | `repair.quote.approve`, `repair.release_without_payment` |
| `workshop` | `workshop.schedule.view`, `workshop.schedule.edit` | — |
| `tradein` | `tradein.create`, `tradein.offer_above_limit`, `tradein.police_register` | `tradein.offer_above_limit` |

`repair.release_without_payment` and `tradein.offer_above_limit` are the two that most
obviously need a second person's PIN — handing back a repaired phone without collecting, and
paying over the limit for a used device — and both get it for free by setting one flag.

### Rule 3 — resource-level rules use `ctx`

`can(user, key, ctx?)` carries its third argument from day one, unused. "A technician may
only edit repairs assigned to them" becomes a rule **inside** `can()` that reads
`ctx.assignedUserId`, without touching a single call site:

```
can(user, "repair.update_status", { assignedUserId: repair.technicianId })
```

Call sites that pass no `ctx` keep working. This is why the parameter exists now: adding it
later would mean editing every guarded handler in the app.

### Rule 4 — noted, not designed

- **Badge login** (a barcode card scanned at the Login screen) for speed. The scanner is
  already a keyboard wedge, so this is a `users.badge_code` column and a scan handler. PIN
  remains the authority for **approvals** — a badge left on the counter must not be able to
  authorize a discount.
- **Remote approval** from the Phase 2 dashboard, for when the owner is out of the shop.
  It fits the two-layer model exactly: the approval layer gains a second provider
  alongside the PIN keypad, and `authorized_by_user_id` then points at a cloud-linked user
  (§1's link, not merge). It requires connectivity, so it can only ever be an addition to
  the PIN path, never a replacement.
