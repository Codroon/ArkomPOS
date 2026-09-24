# ADR-0021: Two identities, one signup, and an admin console that cannot read a shop

**Status:** Accepted · **Date:** 2026-09-24 · **Deciders:** Zothix (Codroon)

## Context

ADR-0020 built the ingest door and left the account layer for later: enrolment codes are
issued by a CLI script, there is no way for a shop to sign up, no way to pay, and no way for
Codroon to see how many shops exist. That was the right slice to stop at, and it is not a
product.

The product is this. A shop owner in Spain is sent a link. He opens pos.codroon.com, signs
up, pays, downloads an installer, sets his shop up, and by the end of that sitting his till
is pushing to a dashboard he can open on his phone. Nobody at Codroon touches anything in
that sequence except to confirm the payment, which is manual while there is one customer.

Three questions that flow makes unavoidable:

1. **He needs credentials twice** — at the counter and in a browser — and ADR-0012 §1 froze
   the first of those as local-only, forever. What is the relationship between them?
2. **Codroon needs an admin side**: how many shops, which tills are alive, who has paid,
   revoke a stolen till. That is a console whose login would otherwise be a key to every
   shop's customer list.
3. **Who owns the shop's identity** — the website form he fills in before downloading, or
   the wizard he fills in afterwards? Both ask for a shop name.

And one that was left hanging: ADR-0002 says "Supabase Auth later for dashboard login",
while ADR-0020's build put the database on Neon. Adding accounts forces that to resolve.

## Decision

### 1. Two identities, created in one sitting, joined by a link and never merged

ADR-0012 §1 is not reopened: **the till's PIN is the only authority the till consults**, it
works with the router unplugged, and no cloud session grants a till permission. What this ADR
adds is the other one:

- A **cloud identity** — email and password, in Supabase Auth — proves "this browser belongs
  to this account". It signs into pos.codroon.com and nothing else.
- A **till identity** — a PIN, hashed locally — proves "the person at this counter is Ana".
  It signs into the till and nothing else.
- The join is `users.cloud_user_id`, nullable, exactly as ADR-0012 §1 already named it. A
  link, never a merge: setting it makes a dashboard able to say *Ana* closed that Z. It grants
  nothing in either direction.

"Sign up for the cloud and the desktop app" therefore means **one sitting, two credentials**.
A shop whose line is dead still opens tomorrow morning, which is the whole reason the till was
built the way it was.

### 2. The till owns the shop's fiscal identity; the website owns the account

The signup form and the setup wizard both ask for a shop name, and only one of them can be
right about what prints on paper.

| | Owns | Why |
|---|---|---|
| **Website** | account: contact email, billing, the name shown in the dashboard | it is who Codroon has a relationship with |
| **Till** | **legal name, NIF, registered address, series prefixes** | it is what prints, and it has to be right with no internet |

The cloud's `tenants.name` is overwritten from the till at enrolment and on every push —
already true, now deliberate. Signup collects a shop name to greet him with, not a NIF. A
fiscal identity that could be edited in a browser would let a document print one thing while
the books said another.

### 3. Supabase holds the database and the identities — one sub-processor, not two

ADR-0002 named Supabase Auth and is honoured rather than superseded. The database moves there
too:

- **One vendor holds the personal data**, so the DPA (ADR-0020 §4) names one sub-processor.
  Two vendors means two names, two breach surfaces and two regions to keep straight.
- The schema is **plain Postgres** — the ADR-0020 migration moves unchanged. Only the
  connection changes: `postgres-js` against the transaction pooler with `prepare: false`,
  `DATABASE_URL` pooled for runtime and `DIRECT_URL` for migrations.
- ADR-0009's trigger for **RLS at tenant #2** stays open, and gets easier: policies keyed on
  the JWT the same session already carries.
- Region **EU (Frankfurt)**, unchanged and non-negotiable (ADR-0020 §4).

Neon was the right first choice for a slice with no accounts in it and is dropped before it
holds a single row. The cost of moving is one file.

### 4. The admin console sees health, never a shop's customers

Codroon is the **processor**, the shop is the controller (ADR-0020 §4). An admin console that
can read shops is a console whose password is a key to every customer list Codroon hosts — the
one payload ADR-0020 already called genuinely serious.

**Staff can see, for any shop:** that it exists, which account holds it, how many tills, each
till's app version, when it last pushed, how far behind it is, and the licence state. Staff can
**revoke a device**, **delete a tenant** (ADR-0020 §4) and **mark an account paid**.

**Staff cannot see:** a sale, a total, a repair, a customer, a seller, an ID number, a
document, or any row of `sync_entries`. Not hidden in a UI — **the admin queries do not select
those columns**, in the same spirit as ADR-0020 §3 giving passcodes no column at all.

**Break-glass, for the support case that needs it:** a row in `support_grants` naming the
staff member, the tenant, a written reason and an expiry. Reading a shop's data without an
active grant is not possible; the grant row *is* the log. A shop can be told exactly who
looked, when, and why, because the answer is a SELECT.

Being staff is a row in a **separate `staff` table**, never a role on an account, so no
account can promote itself.

### 5. Membership is a table from the start

`account_members(account_id, auth_user_id, role)` with `owner` and `manager`. One shop with one
login is the common case and the day a chain wants its manager to see the dashboard should be a
row, not a migration. Codroon staff are not members of anybody's account.

### 6. The licence is a gate, not a pricing model

`accounts.licence_state` — `trial` | `active` | `suspended` — set by hand in the admin while
payment is manual. It gates **the download and the enrolment code**, which are the only two
things worth gating: an installed till keeps selling whatever the state says, because a shop
that has paid for a till and then lapsed still has a legal obligation to issue receipts.

This decides **nothing** about per-till versus per-shop, subscription versus one-off. That
remains open, and this column is where whatever is decided will attach.

### 7. The installer is a file in storage behind a signed URL

The `.exe` lives in Supabase Storage. The download page issues a **short-lived signed URL** to
a signed-in account whose licence is `active` or `trial`. Not a public link: a public link
cannot be revoked, cannot be counted, and ends up in a forum.

One binary, as already decided — the language is chosen at first run, not by which file was
downloaded.

### 8. The wizard gains a fifth step, and skipping it still leaves a complete till

The code goes **on the download page, beside the installer**, so the owner leaves with both.
The wizard's last step is the same panel as Ajustes → Nube. Pressing *Ahora no* leaves a till
that sells all day, exactly like the printer step.

ADR-0020's rejection of account credentials on the till stands: the wizard takes a code, not
an email and password. A counter PC that cashiers use is not where an owner's account password
belongs, even once.

## Options considered

**One identity for both** (cloud login, cached for offline use). Rejected in ADR-0012 §1 and
still rejected: a cached credential is a credential that expires at the worst moment, and the
till must be complete before the cloud exists.

**Supabase Auth with the data left on Neon.** Honours ADR-0002 and touches nothing already
built. Rejected: two vendors holding personal data, no foreign key between an identity and its
account, and RLS made awkward by an HTTP driver with no session to attach claims to.

**Self-hosted auth on Neon** (Auth.js, better-auth). Full control, one vendor. Rejected: it
contradicts ADR-0002, and password reset, email verification and MFA become our code to get
right for a gain measured in vendor preference.

**Full read access for support staff.** Genuinely easier support. Rejected: it makes one
Codroon password the key to every shop's customer list, and a processor that grants itself
blanket access to controller data has nothing to say when asked why.

**Shop details collected on the website.** Tidy signup, one form. Rejected: it puts the NIF
that prints on a fiscal document behind a browser session, and makes the offline copy the
subordinate one.

## Consequences

- **Easier:** a shop can buy and install without Codroon in the loop; a stolen till is revoked
  from a browser; "how many shops are live" is a page; the DPA names one sub-processor.
- **Harder:** we now hold passwords (Supabase's problem, deliberately), and the admin console
  has to be built twice as carefully as a dashboard because its whole design is about what it
  may not do. Every admin query needs a review that it selects no shop data.
- **Revisit:** self-serve payment when there is more than one customer; per-shop staff
  invitations; MFA for staff logins before the tenth shop; RLS at tenant #2 (ADR-0009);
  whether `support_grants` needs the shop's own consent rather than just its visibility.
