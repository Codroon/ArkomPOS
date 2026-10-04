# Consolidating Arkom's two tills

**Status:** ready to run, waiting on one confirmation from the shop
**Written:** 2026-10-04 · ADR-0022 §9 · read from production, nothing changed

Everything in ADR-0022 works for a till enrolling from now on. Arkom's existing pair is a
state the old design created, and unpicking it is a one-off job done once with the data in
front of you. This is that job, with the facts read rather than assumed.

## What the two shops actually hold

`pnpm cloud:shops`, run against production on 2026-10-04:

| | Shop name | Tenant | Products | In stock | Movements | Documents |
| --- | --- | --- | --- | --- | --- | --- |
| **Caja 2** | `Arkom` | `01a0ee1a-675a-7000-972c-8b0d5dd281ca` | 398 | 231 | 237 | 1 |
| **Caja 1** | `ARKOM` | `01a0397a-140d-7000-b701-d9bb73bbf96c` | 32 | 29 | 42 | 5 |

Both are in account `Arkom` / `01a0f8c7-a9c3-7000-8bbd-4db37f31904a`. Nothing overlaps. Each
till ran the first-run wizard, and the wizard minted a shop, so there are two businesses in
one account with the same name spelled differently.

### And this is the part that decides it

Caja 2 holds the shop's **real imported supplier catalogue** — 398 products with English
names, 231 of them in stock: *"Audio Cable Foneng BM22"*, *"BT250 Headphones Ellitech"*,
*"3 In 1 Vacuum Cleaner F6001"*. Somebody loaded this deliberately. It matches the shop's own
summary: **"caja 2 has the real stock."**

Caja 1 holds **the demo dataset**. Thirty of its thirty-two products are `demo-data.ts`
verbatim, quantities included — *"Protector cristal templado iPhone 13"* at 24,
*"Protector cristal templado Galaxy A16"* at 20, *"Funda silicona Galaxy A16"* at 10. Whoever
set that machine up ticked **Cargar datos de ejemplo** and it has been sitting there since.

There is exactly **one real product on caja 1**:

```
  5020  Copias B/N
```

Black-and-white photocopies, 5,020 on the counter. That is the only thing on caja 1 that the
shop typed in itself, and the only thing a reset would lose.

## The one thing to confirm before running this

Caja 1 has **5 documents**. They need a look, because the answer changes nothing structural
but it does change whether anybody minds.

On the dashboard — and this works now, because the till filter crosses both shops — set
**Caja** to caja 1 and open **Transacciones** with the range at 90 días. Five rows.

- **If they are test sales against the demo products** (fundas, protectores): nothing of
  value, proceed.
- **If any of them is a real sale of `Copias B/N`**: it is real revenue on a real day. Keep
  the CSV from step 2 and tell the shop's accountant it lives there, because after the reset
  it will not be in caja 1's `Informes`. It stays in the cloud until step 5 deletes that
  tenant, and in the backup file forever.

Either way the plan is the same. This is about telling the shop the truth, not about choosing
a different route.

## The plan

**Reset caja 1 and let it join caja 2's shop.** It uses the path that is built and tested,
it does not touch caja 2, and it ends with one shop, one catalogue, one stock figure.

Cost: the demo dataset (worthless), caja 1's 5 documents as rows on that machine (backed up
twice by step 1 and 2), and `Copias B/N` — which step 8 re-creates in about thirty seconds,
on either till, and which then replicates to both.

### The order matters

Delete the stale tenant **before** caja 1 re-enrols. While both shops exist in the account,
any new till is refused with `SHOP_AMBIGUOUS` — including caja 1's fresh install. That
refusal is correct and is there so nobody's history gets silently stranded; it is not a bug
to work around.

## Runbook

Nothing here touches caja 2. Steps 1–3 are reversible; step 5 is not.

1. **On caja 1, copy the database off the machine.**
   `%APPDATA%\Codroon POS\arkom-pos.db`, plus the `photos/` folder beside it. Put it
   somewhere that is not that PC. This is the fiscal record of those 5 documents and the only
   step that cannot be recovered from later if it is skipped.

2. **Export caja 1's transactions as a CSV.** Dashboard → **Caja: caja 1** → Transacciones →
   **Exportar**, range 90 días. A readable copy beside the database file. (The export carries
   the till filter, so this really is caja 1's five and not the shop's.)

3. **Write down what `Copias B/N` is at.** Its price, its VAT regime and the figure the
   counter shows today. 5,020 as of 2026-10-04, but check — it moves.

4. **Confirm the two tenants are still what this document says:**
   ```
   cd apps/web
   pnpm cloud:shops
   pnpm cloud:shops -- --tenant 01a0397a-140d-7000-b701-d9bb73bbf96c   # the demo one
   ```
   Expect 32 products and the demo names. **If the counts have moved a lot, stop** — somebody
   has been working on caja 1 and this document is out of date.

5. **Delete the stale tenant.** It shows what it is about to remove and does nothing until
   told twice (ADR-0020 §4):
   ```
   pnpm cloud:delete-tenant -- --tenant 01a0397a-140d-7000-b701-d9bb73bbf96c
   # read what it prints, then:
   pnpm cloud:delete-tenant -- --tenant 01a0397a-140d-7000-b701-d9bb73bbf96c --yes
   ```
   The dashboard now shows one shop. Caja 1 is unlinked as far as the cloud is concerned and
   **still selling**, because nothing about the cloud affects whether a till works.

6. **Reset caja 1.** With the backup from step 1 somewhere else: delete
   `%APPDATA%\Codroon POS\arkom-pos.db` and restart the app. It opens the first-run wizard.
   Answer with the shop's real details and set the printer. **Do not tick "Cargar datos de
   ejemplo"** — that is what put us here. The shop NAME does not matter: a joining till does
   not get to rename the shop (ADR-0022 §9).

7. **Issue a code and link it.** Dashboard → Cajas → **Enlazar una caja**. Then on caja 1:
   Ajustes → Nube → paste it. It reports the shop's name as caja 2 typed it, and Ajustes
   shows **Cajas en la tienda: 2**.

   Wait about a minute. Caja 1's Inventario should fill with caja 2's 398 products at caja 2's
   figures.

8. **Re-create `Copias B/N`** on either till, with the figures from step 3. It replicates to
   the other within half a minute, which is also the first proof that this works.

9. **Verify, do not assume.** On caja 1:
   ```
   pnpm db:audit --verify
   ```
   The two that matter here are `ningun dato replicado se ha registrado como decision de esta
   caja` (no echo) and `nada recibido de otra caja se ha quedado atascado`. Then spot-check
   three products by hand against caja 2's screen.

10. **Prove the loop both ways.** Sell one accessory on caja 1 and watch the figure drop on
    caja 2 within half a minute. Then the reverse. This is the thing the shop actually asked
    for, so it is worth watching once with both screens visible.

### If step 7 says `SHOP_AMBIGUOUS`

Step 5 did not take effect, or there is a third shop nobody expected. Run `pnpm cloud:shops`
and **look** before doing anything else. Do not delete tenants until the error stops.

### If step 7 shows no products after a few minutes

In order of likelihood: the till is pointed at the wrong address (Ajustes → Nube shows it);
the deployed cloud predates ADR-0022 and serves no pull route, in which case the till backs
off quietly and keeps pushing exactly as before — check that `cloud.arkom.es` is on the
current build; or rows are in the inbox unapplied, which `pnpm db:audit --verify` names and
`Ajustes → Nube → Pendiente de aplicar` shows.

## What this does NOT fix, and nobody should expect it to

- **Repairs and used purchases stay per-till** (ADR-0022 §1). A phone left at caja 1 is
  collected at caja 1. Phase 2.
- **Store credit stays per-till.** A voucher issued at caja 2 cannot be spent at caja 1,
  because a replicated voucher with no central redemption can be spent twice.
- **A till's `Informes` reports that till**, and agrees with that till's Z. Shop-wide figures
  are the dashboard's, with the filter by till.
- **Two tills can still oversell the last phone** in the same second. The cloud shows the
  discrepancy; it does not prevent it, because preventing it means the counter waits on a
  lock (ADR-0022 §11).
