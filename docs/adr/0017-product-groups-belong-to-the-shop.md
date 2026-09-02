# ADR-0017 — Product groups belong to the shop, and are never deleted

**Status:** Accepted (v0.14.1)
**Supersedes:** nothing. Amends the seed behaviour assumed by ADR-0011 §"formats don't switch".

## Context

Groups were a seed. Five of them — Móviles, Protectores, Cargadores y Cables, Auriculares,
Memoria y Ordenador — were written by `insertDemoData()`, carried `is_demo = true`, and were
removed with the rest of the demo dataset. Nothing in the app created one.

That was survivable while the demo data was assumed, and it hid two real faults:

1. **"Start empty" was a trap.** First run offers the honest choice, and taking it produced a
   till with zero groups. `catalog:save` requires a `group_id` — req 4.1, and correctly, since
   an ungrouped catalog is a list nobody can filter — so the shop reached the editor, found a
   required field with nothing in it, and had no route forward except loading demo data it did
   not want.
2. **Clearing the demo did the same thing to a working shop.** Ajustes offers "Remove demo
   data" precisely so a shop can start real selling on a clean catalog. It deleted the groups
   along with the products, and left the same dead end.

The shop also had no way to say *Reparaciones* or *Accesorios de coche* — its own words for its
own shelves — which is the ordinary thing a shopkeeper wants on day two.

## Decision

### 1. Every fresh install gets the five, `is_demo = false`

`seedStarterGroups()` runs inside first-run setup, before the demo data and whether or not the
demo data comes. They are a starting point, not a taxonomy. Nothing in the code reads a group
by name — the demo dataset finds them by a stable key (`mobiles`, `protectors`, …), so the
names are free to change the moment the shop wants them to.

### 2. They are written in the language the till was set up in

`setup:complete` carries the locale from the toggle on the first-run dialog. A group name is
shop **data** from the instant it lands in the database, and shop data is never translated —
after the first rename it is their word for their thing. So the one moment the app can get the
language right is the moment it writes the row, and it takes it.

This is not a hole in ADR-0011: the dictionary translates the app's words, and `translateData`
maps the *demo* names for a till reading English. A starter group is neither — it is a row the
app writes once on the shop's behalf.

### 3. Removing the demo data ADOPTS the groups; it does not delete them

On a v0.14.1 install there is nothing to adopt — the starter five are already the shop's. On a
till set up earlier, the five came in with the demo dataset, and `removeDemoData()` now clears
their `is_demo` flag instead of deleting them. That turns the old dead end into the state the
groups should always have been in, without a migration and without touching a name.

### 4. Create and rename; no delete

`catalog:createGroup` and `catalog:renameGroup`, both through `mutate()`, both writing an oplog
entry, both behind permissions the catalog **already has**: `catalog.create` and `catalog.edit`.
A new permission for five rows would be ceremony — somebody trusted to add an article is
trusted to name the shelf it goes on. A cashier therefore gets `APPROVAL_REQUIRED`, the same
invitation they get for creating a product, rather than a refusal.

**There is no delete, and no affordance suggesting one.** A group with fifty products behind it
cannot go without somebody deciding where those products land, and that decision needs a screen
this phase does not have — a reassign-then-delete flow, or a "sin grupo" bucket that reopens
the ungrouped-catalog problem req 4.1 exists to prevent. A button that refuses half the time is
worse than no button. The modal says so in a line of text rather than leaving it to be
discovered. **This is a known seam**; when the shop needs it, it needs the reassign screen
first.

### 5. A rename propagates because nothing copies the name

Every product carries `group_id`. The catalog list, the inventory filter, the valuation report
and the dead-stock report all join to `product_groups` at read time, so a rename reaches all of
them without a second write. The one place a name was being *copied* — the reports' `"Sin
grupo"` fallback, written in Spanish inside the main process — is fixed by returning `null` and
letting the reader word it. The CSV export keeps a Spanish literal, because an exported file
follows the print rule, not the toggle (ADR-0011).

### 6. One list, one fetch

Five screens each fetched `catalog:groups` into their own state. That was harmless while the
list was a fixed seed and became a bug the moment the shop could add to it: four of the five
would show a stale list until their screen remounted, and the shop's reading of "my new group
isn't there" is that the feature does not work. `useGroups()` in `components/group-picker.tsx`
is now the single cache, with `refreshGroups()` and a `noteGroup()` for the row that was just
created. What is shared is the LIST, not the control — the toolbar filters and the editor's
field are styled differently on purpose.

### 7. Duplicates are refused the way a person would refuse them

`groupNameKey()` trims, collapses runs of whitespace and lowercases. "Fundas" and "fundas " are
the same group to everybody except a unique index, and a shop told "that already exists" about
a name it cannot see the difference from stops trusting the message. **Accents are kept**:
"Móviles" and "Moviles" are different words, and refusing the second would be wrong. The
partial unique index on `(tenant_id, name)` remains the real guarantee; the check exists so the
answer is `DUPLICATE_NAME` naming the clash rather than a constraint violation.

## Options considered

**A settings screen for groups** — rejected: the place a shop notices it needs a group is the
editor, mid-typing, and a trip to Ajustes to come back is how a feature goes unused. Both
routes exist instead: inline in the field, and a *Grupos* button on the Catalog screen.

**Delete with a reassign prompt** — the right eventual answer, deferred: it needs a product
picker, a bulk move and an oplog story per product. Named here so the next person does not
implement half of it.

**Seeding in Spanish always, translated by `translateData`** — rejected: it works on screen and
lies everywhere else. The CSV export, a printed valuation and any future sync would all carry
Spanish names on an English shop's data.

**A `sortOrder` the shop can drag** — deferred. New groups append; the starter five keep 0–4,
so a shop's own group never lands in the middle of an order it did not choose.

## Consequences

**Easier.** "Start empty" works. Clearing the demo data leaves a usable catalog. A shop can
name its own shelves without asking anybody. Five stale copies of one list became one.

**Harder.** `insertDemoData()` now takes the starter groups as an argument, so its two callers
(first run and `db:seed`) must seed them first — the type makes that impossible to forget.

**Accepted.** No delete, stated above and in the UI. A shop that renames a starter group loses
its `translateData` mapping and sees its own name in both languages — which is correct, and is
the whole point of the rule.

## A1. Amendment (v0.14.2) — a group carries both names, because only the shop knows the second

§2 said starter groups are seeded in the setup language and are shop data from that moment,
never translated. That was half right and it produced a till nobody could explain: five shelves
changed language with the toggle (they were in a hardcoded es→en map) and every shelf the shop
added did not. A shop that names one *Used Phones*, watches *Móviles* become *Phones* beside it,
and sees *Used Phones* stay English in Spanish, concludes the feature is broken. It is right to.

Removing the map made it consistent and made it worse: now nothing translated, and a till set to
English showed Spanish shelves with no way to change that short of renaming them and losing the
Spanish.

**The app cannot translate a name the shop typed.** No dictionary exists for *Coche y viaje*,
and building one means an online service in a till that has to work with the router unplugged,
returning a word the shop did not choose. That much stands.

**But the shop knows both words.** So `product_groups` gains `name_en`:

- `name` is canonical and Spanish — it holds the unique index and it is what a document carries.
- `name_en` is optional. Blank means "show the Spanish one", which is what most shops want and
  must therefore never look like an error.
- `groupDisplayName(group, locale)` is the only place that chooses, and it falls back rather
  than blanking.
- The starter five are seeded with **both**, from `STARTER_GROUPS`, whatever language set the
  till up — so the toggle works on day one. A fix-up fills `name_en` on existing tills by
  matching either language, and skips any row that already has one, because a shop that wrote
  its own English name owns it.
- The Grupos modal edits both, side by side. The inline "+ New group" in the editor stays one
  box: the shop is mid-typing an article, and the second name can wait.

This does not reopen "shop data is never translated" — it is still not translated. It is
**stored twice, by the only party that knows both**, which is the ordinary answer for localized
user content and the only one that works offline.

Supplier names deliberately do NOT get this: they are company names, and a company is called
what it is called in every language.
