# Consolidating Arkom's two tills

**Status:** ready to run; steps 5 to 9 are one sitting, with the shop present
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
- **If any of them is a real sale of `Copias B/N`**: it is real revenue on a real day. It
  survives the merge and stays on the dashboard, under the till filter, with the combined
  figures including it — which is why the plan merges rather than deletes. It will no longer
  be in caja 1's own `Informes` after the reset, because that screen reports the till it is
  running on; the CSV from step 2 and the backup from step 1 are the local copies.

Either way the plan is the same. This is about telling the shop the truth rather than
choosing a different route.

## The plan

**Merge the two shops in the cloud, then reset caja 1 so it joins the surviving one.**
Nothing is deleted: caja 1's history stays on the dashboard, under the till filter, and the
combined figures include it.

Cost: the demo dataset (which the dashboard no longer shows as stock), caja 1's 5 documents
as rows on that machine (backed up twice by steps 1 and 2, and still in the cloud after the
merge), and `Copias B/N` — which step 9 re-creates in about thirty seconds, on either till,
and which then replicates to both.

### The two steps are ONE sitting

Between the merge and the re-enrolment, caja 1 cannot push: its database still names the old
shop, the cloud no longer has one, and its next attempt is refused with `DEVICE_MISMATCH`.
That refusal is visible in Ajustes → Nube and harmless on its own — **but anything sold on
caja 1 in that window reaches no cloud and is then discarded by the reset in step 7.**

Caja 1 has not pushed since 3 October, so the window is almost certainly empty. Do not rely
on that: run steps 5 to 9 together, with the shop told not to use caja 1 until they are done.

Caja 2 is untouched throughout and keeps selling.

## Runbook

Steps 1 to 4 change nothing. Step 5 writes a rollback file before it acts.

1. **On caja 1, copy the database off the machine.**
   `%APPDATA%\Codroon POS\arkom-pos.db`, plus the `photos/` folder beside it. Put it
   somewhere that is not that PC.

2. **Export caja 1's transactions as a CSV.** Dashboard → **Caja: caja 1** → Transacciones →
   **Exportar**, range 90 días. The export carries the till filter, so this really is caja
   1's five.

3. **Write down what `Copias B/N` is at.** Its price, its VAT regime and today's count —
   5,020 as of 2026-10-04, but check.

4. **Confirm the two shops are still what this document says:**
   ```
   cd apps/web
   pnpm cloud:shops
   ```
   Expect `Arkom` with ~398 products and `ARKOM` with ~32. **If the counts have moved a lot,
   stop** — somebody has been working on caja 1 and this document is out of date.

5. **Merge, reading the dry run first.**
   ```
   pnpm cloud:merge-shops -- --from 01a0397a-140d-7000-b701-d9bb73bbf96c \
                             --into 01a0ee1a-675a-7000-972c-8b0d5dd281ca
   ```
   It prints what it would move — about 473 rows and one till — and changes nothing. Read it,
   then add `--yes`. It writes `rollback-01a0397a-….json` **before** the first write; keep
   that file until step 10 has passed. To undo:
   ```
   pnpm cloud:merge-shops -- --undo rollback-01a0397a-….json --yes
   ```
   The dashboard now shows one shop, with both tills' history in it and a filter to look at
   either. The 30 demo products are in the stream but no longer counted as stock or shown in
   the catalogue — after step 7 no till holds them, and a dashboard listing products that
   exist on no counter would disagree with every counter.

6. **Issue an enrolment code**, before touching the till so nobody is waiting.
   Dashboard → Cajas → **Enlazar una caja** → copy it. It is valid for seven days.

7. **Reset caja 1.** With the backup from step 1 somewhere else: close the app, delete
   `%APPDATA%\Codroon POS\arkom-pos.db`, and restart. The first-run wizard opens. Answer with
   the shop's real details and set the printer. There is no demo-data option any more.

8. **Link it.** On caja 1: Ajustes → Nube → paste the code from step 6 → Enlazar. It reports
   the shop's name as caja 2 typed it, and Ajustes shows **Cajas en la tienda: 2**.

   Wait about a minute. Caja 1's Inventario fills with caja 2's catalogue at caja 2's figures.

9. **Re-create `Copias B/N`** on either till, with the figures from step 3. It appears on the
   other within half a minute, which is also the first proof the loop works.

10. **Verify, do not assume.** On caja 1:
    ```
    pnpm db:audit --verify
    ```
    The ones that matter here: `ningun dato replicado se ha registrado como decision de esta
    caja` (no echo), `nada recibido de otra caja se ha quedado atascado`, and
    `el saldo de cada vale coincide con su libro de usos`. Then spot-check three products by
    hand against caja 2's screen.

11. **Prove the loop both ways, with both screens visible.** Sell one accessory on caja 1 and
    watch the figure drop on caja 2 within half a minute. Then the reverse. Then leave a phone
    for repair on caja 1 and find it on caja 2 — that is new in v1.3.0 and worth seeing once.

### If step 8 says `SHOP_AMBIGUOUS`

The merge in step 5 did not take effect, or there is a third shop nobody expected. Run
`pnpm cloud:shops` and **look** before doing anything else.

### If step 8 shows no products after a few minutes

In order of likelihood: the till is pointed at the wrong address (Ajustes → Nube shows it);
the deployed cloud predates ADR-0022 and serves no pull route, in which case the till backs
off quietly and keeps pushing exactly as before — check `cloud.arkom.es` is on the current
build; or rows are sitting in the inbox unapplied, which `pnpm db:audit --verify` names and
Ajustes → Nube → **Pendiente de aplicar** shows.

## What this does NOT fix, and nobody should expect it to

- **Used-device purchases stay per-till.** The seller's identity document and photographs are
  the point of that record.
- **Repair photographs stay on the till that took them.** The ticket crosses; the pictures are
  files the cloud holds none of. The other till says where they are.
- **A device passcode stays on the till that was told it.** Same reason, stronger: it is the
  customer's.
- **A till's `Informes` reports that till**, and agrees with that till's Z. Shop-wide figures
  are the dashboard's, with the filter by till.
- **Two tills can still oversell the last phone, or spend one voucher twice**, inside a few
  seconds of each other. Both are shown — `db:audit` fails and the dashboard says so — and
  neither is blocked, because blocking means the counter waits on a lock (ADR-0022 §11,
  ADR-0023 §5).
