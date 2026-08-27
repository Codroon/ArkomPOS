# Arkom POS — Auth slice spec (PIN login · roles · permissions)

Status: **Stage A — design, awaiting go** · Target: **v0.10.0** · Owner: Zothix (Codroon)
Companions: [`ADR-0012`](../adr/0012-local-pin-auth-and-permission-registry.md) (decisions) ·
[`system-design.md`](../design/system-design.md) (schema + IPC) ·
[`handoff/auth.md`](../design/handoff/auth.md) (screens). This spec defines **what "done" means**.

## Problem statement

v0.9.0 is installed and selling. Its audit trail records what changed, when, and on which
till — but every row says `user_id = NULL`, so it cannot say who. The owner cannot tell
which member of staff discounted a phone, and the modules queued next (trade-in, repairs,
workshop) cannot exist without roles: a technician must not be able to open the drawer.

This slice adds identity and authority to a running till, in place, without losing a row.

## Goals

1. A cashier signs in with a 4–6 digit PIN in under three seconds, offline, dozens of
   times a day.
2. Every mutation from now on carries the person who made it. Rows written before the
   upgrade keep `user_id = NULL`, meaning "pre-auth", and are never backfilled.
3. An action a cashier may not take is refused **in the main process**, not hidden in the
   renderer — and where sensible it is refused *pending an owner's PIN* rather than
   refused outright.
4. A price override records both who did it and who allowed it.
5. An unattended till locks itself and cannot be used by whoever walks past.
6. The upgrade over v0.9.0 is one installer, no data loss, and no instruction sheet beyond
   "create the owner".

## Non-goals (this slice)

Shifts, float, Z report (next slice) · refunds and voids · Supabase/cloud auth or any
network call · badge login · the Technician role's UI · any repairs, trade-in or workshop
screen · password or biometric login · per-terminal user restrictions.

`shift_id` stays NULL everywhere. ADR-0010's other half is the next slice.

## Personas

| | Owner (**Responsable**) | Cashier (**Cajero**) |
|---|---|---|
| Who | Ahmer, and anyone he trusts with the shop | Counter staff |
| Signs in | Every day, and whenever a cashier needs approval | Every shift |
| Can | Everything | Sell, park, resume, view catalog and stock, receive stock, attach an unknown barcode |
| Cannot | — | Manage users, edit settings, manage backups |
| Needs approval for | — | Price override, create/edit a product, stock adjustment |

## User stories

- As a cashier, I tap my name and type four digits and I am selling — no username, no
  keyboard.
- As a cashier, when I need to discount a phone the owner types their PIN on my screen and
  the sale continues without losing the ticket.
- As an owner, I can see on the audit trail that Ana took 10 € off a case and that I
  approved it.
- As an owner, when someone leaves I deactivate them and their past sales still show their
  name.
- As an owner, if a cashier forgets their PIN I reset it in ten seconds without calling
  anyone.
- As an owner, if *I* forget mine, the code in the shop folder gets me back in.
- As an owner, a till left alone during a delivery does not let the delivery driver sell.

---

## Acceptance criteria

### A. Data and migration

- [ ] **A1** `users` table: UUIDv7 `id`, tenant/location/terminal keys (ADR-0009), `name`,
      `role` (text, Zod-validated in code, **no CHECK constraint**), `pin_hash`,
      `pin_salt`, `permission_overrides` (JSON map key→boolean), `active`,
      `failed_attempts`, `locked_until`, `recovery_code_hash` (owners only, nullable),
      `created_at`, `updated_at`.
- [ ] **A2** `oplog` gains nullable `authorized_by_user_id`, beside the existing `user_id`.
- [ ] **A3** Migration runs on a **copy of a real v0.9.0 database with data**; every
      pre-existing row keeps `user_id = NULL` and `shift_id = NULL`. No backfill. Row
      counts before and after are identical, and `db:audit --verify` passes on the result.
- [ ] **A4** Users are deactivated, never deleted. `active = false` hides them from Login
      and from user pickers; their name still resolves everywhere history references them.

### B. PINs and lockout

- [ ] **B1** PIN is 4–6 digits. Rejected with a specific message: non-digits, wrong length,
      all-same-digit (`1111`), ascending or descending runs of 3 or more (`1234`, `4321`,
      `987654`), and a short blocklist.
- [ ] **B2** Hash/verify round-trips through one interface (`hashPin` / `verifyPin`);
      comparison is constant-time. argon2id via `@node-rs/argon2`, with `crypto.scrypt` as
      the documented fallback if the **packaged** build objects.
- [ ] **B3** The PIN never appears in a log file, an oplog `before`/`after` payload, an
      error message, or a renderer state object. Verified by a test that hashes a known PIN
      and greps the resulting oplog row and log line for the digits.
- [ ] **B4** Lockout escalates 5 → 1 min, next 5 → 5 min, thereafter 15 min; resets on
      success; **survives an app restart** (persisted on the row).
- [ ] **B5** Lockout applies identically to login, unlock, and approval attempts.
- [ ] **B6** A locked user does not block anyone else: another user can sign in normally.

### C. Session and the IPC guard

- [ ] **C1** The session lives in the main process. The renderer receives only
      `SessionInfo { userId, name, role, permissions[] }`.
- [ ] **C2** Every IPC handler is registered through `handle(channel, permission, fn)` and
      receives the session as its first argument. A handler cannot be registered without
      naming a permission or explicitly declaring itself unguarded.
- [ ] **C3** Unguarded allow-list is small and enumerated in one place: `auth:login`,
      `auth:session`, `auth:recover`, `setup:status`, `setup:complete`, `meta:context`.
- [ ] **C4** A call with no session is rejected with `AUTH_REQUIRED`; a call with a session
      lacking the permission is rejected with `PERMISSION_DENIED` — both from main.
- [ ] **C5** `mutate()` stamps the actor from the **session**, never from renderer input.
      A payload containing a `userId` field cannot influence what is recorded.
- [ ] **C6** App restart lands on Login. No session is persisted to disk.

### D. Permissions

- [ ] **D1** One registry file in `packages/core`; each entry
      `{ key, module, labelEs, approvable }`. Role defaults live in the same file.
- [ ] **D2** Effective permissions = role defaults ∪ overrides (override wins, either way).
- [ ] **D3** The owner role cannot be reduced: `can(owner, anything)` is true regardless of
      overrides.
- [ ] **D4** `can(user, key, ctx?)` — `ctx` is accepted and unused now.
- [ ] **D5** An unknown permission key is a **compile error**, not a runtime false.
- [ ] **D6** Renderer gets `useCan()` and `<Guarded permission>`, which hides or renders a
      locked state. This is convenience; C4 is the control.
- [ ] **D7** Initial keys and defaults exactly as listed in *Permission registry* below.

### E. Approval (dual attribution)

- [ ] **E1** A user lacking an `approvable` permission triggers `APPROVAL_REQUIRED` naming
      the key — not a generic denial.
- [ ] **E2** The renderer retries the **same** call with an approval `{ userId, pin }`
      alongside the payload; on success the action executes in that same IPC call.
- [ ] **E3** The resulting oplog entry carries both `user_id` (actor) and
      `authorized_by_user_id` (approver). The existing `document_line.price_override`
      entry gains the second id and keeps its before/after and reason.
- [ ] **E4** Approval is single-use. No window, no "stay authorized", no caching.
- [ ] **E5** The approver must hold the permission and be active; a cashier cannot approve
      for another cashier.
- [ ] **E6** Denials and cancellations are recorded as oplog events.
- [ ] **E7** If the current user already holds the permission, no modal appears.

### F. Idle lock

- [ ] **F1** The renderer forwards activity (mouse, keyboard, scanner) to main, throttled —
      not one message per mouse move.
- [ ] **F2** After `auth.idle_lock_minutes` (setting, default **5**) the Lock overlay covers
      everything and cannot be dismissed except by the **current user's** PIN.
- [ ] **F3** The session and any open cart survive the lock. Unlocking returns to exactly
      the screen that was open.
- [ ] **F4** A manual lock button is available at all times.
- [ ] **F5** "Cambiar de usuario" logs out. If a cart is open it is auto-parked with a note
      naming the outgoing user, so attribution stays clean.
- [ ] **F6** Lock is not logout: `auth.idle_lock_minutes = 0` disables the timer, with a
      warning in Ajustes.

### G. Usuarios screen (owner only)

- [ ] **G1** List of users: name, role, active state, last sign-in.
- [ ] **G2** Add: name, role, PIN twice (must match), overrides as labelled toggles
      **grouped by module**, read from the registry.
- [ ] **G3** Edit name, role and overrides. Owner rows show overrides disabled (D3).
- [ ] **G4** Deactivate and reactivate.
- [ ] **G5** Reset another user's PIN. An owner changing **their own** PIN must enter the
      current one first.
- [ ] **G6** At least one active owner must always exist — deactivating or demoting the
      last one is refused in core with `LAST_OWNER`, not merely disabled in the UI.

### H. Recovery

- [ ] **H1** A 12-character recovery code is generated at owner creation, grouped for
      reading, from an alphabet excluding ambiguous characters.
- [ ] **H2** Stored hashed. Shown **once**, with an "Imprimir" button (thermal printer) and
      a "Lo he guardado" confirmation that must be pressed before continuing.
- [ ] **H3** Login → "He olvidado mi PIN": a cashier is told to ask the owner; an owner is
      offered the recovery-code field.
- [ ] **H4** A correct code allows setting a new PIN and prints a **new** code; the old one
      stops working.
- [ ] **H5** Recovery attempts are rate-limited by the same lockout ladder.

### I. Upgrade and first run

- [ ] **I1** Fresh install: the owner-creation step is appended to the existing setup
      dialog, before the demo-data choice completes.
- [ ] **I2** Existing install (setup done, no users): on first launch after the update, the
      owner-creation step is shown **before anything else**, including the till.
- [ ] **I3** Both paths converge on Login.
- [ ] **I4** The owner-creation step cannot be skipped or dismissed.

### J. Login screen

- [ ] **J1** Active users as tiles; big keypad; shop name and app version in a corner.
- [ ] **J2** Error states: wrong PIN shows remaining attempts; a locked user shows a live
      countdown and the keypad is disabled.
- [ ] **J3** Spanish only. Role labels **Responsable** / **Cajero**.
- [ ] **J4** Brand rules hold: tokens only, one blue element (the confirm action), no
      white-on-blue, no blue body text on Bone.

### K. Audit

- [ ] **K1** Auth events are oplog entries: login, logout, lock, unlock, failed attempt,
      lockout, PIN reset, approval granted, approval denied.
- [ ] **K2** Every mutation's oplog entry carries a non-null `user_id` from the moment
      users exist.
- [ ] **K3** `pnpm db:audit --action login --diff` reads sensibly, and no auth entry
      contains a PIN.

---

## Permission registry (initial)

| Key | Module | Cashier default | Approvable |
|---|---|---|---|
| `sale.create` | sale | ✅ | — |
| `sale.park` | sale | ✅ | — |
| `sale.resume` | sale | ✅ | — |
| `sale.price_override` | sale | ❌ | ✅ |
| `catalog.view` | catalog | ✅ | — |
| `catalog.attach_code` | catalog | ✅ | — |
| `catalog.create` | catalog | ❌ | ✅ |
| `catalog.edit` | catalog | ❌ | ✅ |
| `inventory.view` | inventory | ✅ | — |
| `inventory.receive` | inventory | ✅ | — |
| `inventory.adjust` | inventory | ❌ | ✅ |
| `users.manage` | admin | ❌ (hidden) | — |
| `settings.edit` | admin | ❌ (hidden) | — |
| `backup.manage` | admin | ❌ (hidden) | — |

Owner holds every key. `inventory.adjust` is registered although no adjust UI exists yet —
the key is the contract; the screen arrives later without touching this file.

"Hidden" means the nav item and screen are not rendered for a cashier **and** the handlers
reject the call. Not approvable: a cashier does not manage users with the owner leaning
over their shoulder; the owner signs in themselves.

## Typed error codes added

`AUTH_REQUIRED` · `PERMISSION_DENIED` · `APPROVAL_REQUIRED` · `INVALID_PIN` ·
`USER_LOCKED` · `WEAK_PIN` · `LAST_OWNER`

`INVALID_PIN` carries remaining attempts; `USER_LOCKED` carries the unlock time. Neither
carries the PIN.

## Test plan (Vitest, `packages/core` unless noted)

| Area | Test |
|---|---|
| Hashing | hash → verify round trip; wrong PIN fails; comparison is constant-time |
| Weak PINs | each rejection class, and a table of accepted PINs |
| Lockout | 5 → 1 min, 10 → 5 min, 15 → 15 min; success resets; expiry unlocks |
| Permissions | role defaults; overrides both directions; owner not reducible; unknown key is a type error |
| Guard (main) | missing session → `AUTH_REQUIRED`; missing permission → `PERMISSION_DENIED`; payload `userId` cannot spoof the actor |
| Approval | valid owner PIN executes and stamps both ids; cashier PIN refused; denial logged |
| Last owner | deactivating and demoting the last active owner both refused |
| Idle lock | timer logic: activity resets, expiry fires, `0` disables |
| Migration | on a populated v0.9.0 copy: row counts equal, actor columns NULL, `--verify` green |
| Oplog | every mutation entry carries the actor once a session exists |

## Out of scope, stated so it is not assumed

Nothing here touches money, stock or numbering logic. No existing screen changes behaviour
for an owner — a single-owner shop that never creates a cashier should not notice this
slice beyond the Login screen.
