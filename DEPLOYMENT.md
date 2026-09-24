# Codroon POS — installing and running it in the shop

Everything needed to put this on the counter PC and hand it over. Written to be
followed at the shop, not read beforehand.

Version covered: **0.10.0**.

---

## 1. What the PC needs

| | Minimum | Comfortable |
|---|---|---|
| Windows | 10 (64-bit), version 1809 or newer | Windows 11 |
| RAM | 4 GB | 8 GB |
| Free disk | 1 GB | 5 GB (backups and ticket PDFs grow slowly) |
| Screen | 1280 × 860 or larger | 1920 × 1080 |
| Ports | 1 USB for the printer, 1 for the scanner | plus a spare for the backup stick |

No internet connection is required — not to install it, not to use it. The till
works completely offline and does not phone anywhere.

**Do not install it on a machine the shop shares with anything important until
the backup destination in §7 is set up.**

---

## 2. What the installer contains, and what it doesn't

`Codroon POS Setup 0.10.0.exe` — about 94 MB.

**Inside it:**
- the application,
- the database *structure* (migrations), which it applies on first launch,
- the ticket fonts and the Arkom icon.

**NOT inside it:**
- **the database.** It is created on this machine, on first launch, and from
  then on it holds the shop's products, stock, tickets and takings.

That distinction matters when updating and when uninstalling. The installer is
the program; the data belongs to the machine.

### Installing

Double-click it. There are no options and no questions — it installs for the
**current Windows user only**, so it never asks for an administrator password,
and it launches itself when it finishes.

It installs to:

```
C:\Users\<user>\AppData\Local\Programs\arkom-pos\
```

### The SmartScreen warning

The installer is not code-signed yet, so Windows will show a blue box:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognised app from starting.

Click **More info**, then **Run anyway**.

This is expected and it is not a virus warning — it means "we have not seen this
file signed by a known publisher before", which is true. It disappears once the
app is signed with a certificate (planned; it costs money and takes verification
time, so it is deliberately not blocking the shop visit).

---

## 3. First launch

The app opens on a welcome screen instead of the till. It asks for:

0. **Language.** The toggle in the corner sets the staff language for the
   screens and for the starter data (group names, the drawer's one-tap
   concepts). Printed tickets are always Spanish, whatever is chosen here.
1. **Shop details** — registered name, NIF, registered address, then postcode,
   town and phone, and the footer line for the ticket. **Bring the real fiscal
   data to the shop visit.** The first three are the legal block on every ticket
   the customer keeps; the rest print under it when filled in. Nothing is
   pre-filled: a field left blank simply does not print.
2. **Till name and ticket prefix.** The prefix is how tickets are numbered:
   `T1-000001`, `T1-000002`, and so on. **It cannot be changed afterwards** —
   ticket numbering must be gap-free and continuous, so agree it with the owner
   before pressing Start.
3. **The shop's responsable.** A name and a 4–6 digit PIN, typed twice. This is
   the person who can manage users, change settings and authorise a discount.
   Weak PINs are refused — no `1234`, no `1111`, no runs of digits.

4. **The printer**, last and skippable. Pick it and press **Imprimir prueba**:
   paper coming out is what confirms it. **Ahora no** leaves it for later — and
   until it is set, the till will not charge (§4).

An installed till starts **empty**: twelve shelves (groups) in the chosen
language and nothing on them. The demo dataset is not offered anywhere in the
wizard and an installed build refuses it outright; it exists for development.

Once inside, the Venta screen carries a short checklist — printer, items, staff
(optional), first shift. Each line ticks itself when the shop does the thing and
takes you to the screen that does it; the card disappears for good when the work
is done or when the owner dismisses it.

Everything except the prefix can be changed later in **Ajustes**.

### The recovery code — do not skip this

Immediately after the owner is created the till shows a **12-character recovery
code, once**, with an **Imprimir** button. Print it and put it in the shop's
folder or safe. With no printer configured yet the same button produces a PDF
and opens it — print that from the PC, or save it somewhere the owner controls.

It is the **only** way back in if the owner forgets their PIN. There is no
master PIN and no vendor override — deliberately, because a till the developer
can unlock is a till whose audit trail proves nothing. If both the PIN and the
code are lost, recovery means restoring a backup on site.

A cashier who forgets their PIN needs none of this: the owner resets it from
**Ajustes → Usuarios** in ten seconds.

### Adding staff

**12 Usuarios**, owner only. Add each person with their own PIN and the
**Cajero** role. A cashier can sell, look at the catalogue and stock, and
receive deliveries. Changing a price, creating or editing an item, or adjusting
stock raises **"Autorización del responsable"** — the cashier presses the
button, the owner types their PIN on the same screen, and the sale carries on
with both names on the record.

Individual permissions can be granted or withheld per person from the same
screen, without inventing new roles.

---

## 4. Printer setup — Citizen CT-S310S

**Do this before the shop starts working — the till will not issue a document
without it.** With no printer chosen in Ajustes, **Cobrar**, a refund, a repair
hand-back, taking a repair in and buying a used phone all answer "No hay
impresora configurada" and nothing happens; those screens say so at the top
before anything is filled in. A shop that takes money, or somebody's phone,
without being able to hand over paper has an argument waiting for it.

The drawer and the shift are not blocked: paid-in/out and closing the day work
whatever the printer is doing, because a Z that cannot be closed strands the
day's takings and reprints from its own snapshot later anyway.

Once a printer is configured the till works normally, and if that printer later
jams or is unplugged the sale still goes through — the ticket is retried or
saved from the document itself.

1. **Install the Citizen driver first, with the printer unplugged.** Get it from
   Citizen's support site (the CT-S310 family driver). Reboot if it asks.
2. **Plug the printer into USB and switch it on.** Windows finishes setting it
   up. Check it appears in *Settings → Bluetooth & devices → Printers & scanners*
   and note the exact name shown there.
3. **Load the paper roll** — 80 mm, printed side facing the head. Close the lid
   until it clicks.
4. In Codroon POS, open **11 Ajustes → Impresión**:
   - **Impresora**: the Citizen should already be picked — the list puts real
     printers first and hides OneNote, Print to PDF and the fax queue behind
     **Ver todas las impresoras**, and when exactly one queue looks like a
     receipt printer the till preselects it. It is a suggestion until you print:
     nothing is saved by looking at it.
   - **Ancho del papel**: **80 mm**.
   - **Juego de comandos**: **Epson (ESC/POS)** — the CT-S310S speaks it, and so
     does almost everything else. Star is the other option, for Star printers.
5. Press **Imprimir prueba**. This is what confirms the suggestion and saves it.

**What should happen:** a short sample ticket prints and the paper is cut. It
uses no ticket number and leaves no sale in the books — it is safe to press as
many times as needed.

**Check on the paper:**
- the ARKOM heading is legible and not cut off at either edge,
- the accented characters and the **€** sign print correctly (`Impresión`, not
  `Impresi?n`),
- the paper cuts cleanly at the end.

If nothing comes out, the app shows **No se pudo imprimir** with **Reintentar**
and **Guardar PDF**. Work through:
- printer switched on, lid closed, paper not jammed;
- the right printer selected in Ajustes (not "Microsoft Print to PDF");
- the queue: *Printers & scanners → Citizen → Open queue* — clear anything stuck;
- if it prints garbage characters instead of a ticket, the driver is set to a
  mode the app is not expecting — check the command set is Epson.

### The cash drawer

If a drawer is connected to the printer's DK port, it opens automatically when a
sale is paid **with cash**. It does **not** open for card, Bizum or transfer, and
it does **not** open on a reprint — the money was already counted once.

There is no way to test the drawer without ringing up a cash sale, so do that as
part of §9.

---

## 5. Scanner check

The scanner is a keyboard wedge — to Windows it is just a very fast typist. It
needs no driver and no configuration in the app.

**Test it in Notepad first, before blaming the app.** Open Notepad, scan a
product barcode, and confirm that:
- the digits appear, and
- the cursor jumps to a new line at the end (the scanner is sending Enter).

If the digits appear but there is no new line, the scanner needs a "suffix:
Enter / CR" setting — the barcode for that is in its manual. If nothing appears
at all, it is a cable or power problem, not an Arkom problem.

Once Notepad is happy, scanning anywhere in Codroon POS works.

---

## 5b. Upgrading a till that was installed as Arkom POS

The product is called **Codroon POS** from v1.1.0. The installer keeps the same
application id, so it upgrades an Arkom POS install in place — Start-menu entry,
shortcut and *Add or remove programs* all take the new name by themselves.

The shop's data moves with it. Electron keeps a till's database, photographs and
backups in a folder named after the app, so the first launch under the new name
**moves** `…\Roaming\Arkom POS` to `…\Roaming\Codroon POS`. Nothing is copied
and nothing is deleted; if the move cannot happen (the folder is open in another
program, say) the app starts on an empty till and the old folder is still there —
close everything, rename it by hand, and start the app again.

What does NOT change is the paper. A receipt has never carried the till's name
and still does not: the top of every document is the shop's own trading name,
with its strapline underneath if it has one (**Ajustes → Datos de la tienda →
Lema de la tienda**).

## 6. Where everything lives

All of the shop's data is under one folder:

```
C:\Users\<user>\AppData\Roaming\Codroon POS\
```

`AppData` is hidden by default. Paste the path into the Explorer address bar, or
turn on *View → Show → Hidden items*.

| What | Exact path |
|---|---|
| **The database** (everything: products, stock, tickets, takings) | `…\Codroon POS\arkom-pos.db` |
| **Photos of used devices** | `…\Codroon POS\photos\` |
| Backups | `…\Codroon POS\backups\` |
| Error log | `…\Codroon POS\logs\arkom.log` |
| The program itself | `C:\Users\<user>\AppData\Local\Programs\arkom-pos\` |

Ajustes shows the database and backup locations, each with a button that opens
the folder — easier than typing the path.

Nothing is filed per ticket. A document is kept in the database and re-rendered
on demand: **Reimprimir** on any ticket, or **Guardar PDF…** to write a copy
exactly where you choose.

Until a printer is configured the counter does not sell at all (§4). The parts
of the till that still work in that state — a repair intake, buying a used phone
— print nothing and say so, with a **Guardar PDF** button beside the message.
They save no file on their own; the button does, into a temporary folder that is
emptied at every launch.

> You may see `arkom-pos.db-wal` and `arkom-pos.db-shm` next to the database.
> They are part of it while the app is running. **Copy all three, or none.**
> A backup taken by the app (§7) is always a single complete file — that is the
> one to copy.

---

## 7. Backups

The app backs itself up **every night at 03:30** and **every time it closes**,
into `…\Codroon POS\backups\`. It keeps the last **14** and deletes older ones.
Each backup is reopened and checked immediately after it is made; anything that
fails the check is deleted rather than kept.

Since v0.11.0 each backup is **two things**, not one:

| | |
|---|---|
| `arkom-20260829-0330.db` | the database |
| `arkom-20260829-0330.db-photos\` | the photographs of used devices taken up to that moment |

They are made together, pruned together, and **must be restored together**.
The repairs slice needed **no change here**: `photos/repairs/…` sits under the same
root the backup already copies recursively, which was verified against a real
backup rather than assumed.

Restoring only the database leaves every purchase and repair listing photos that
no longer exist — the record is there and the evidence is gone, which is the worst
of both. If the photo folder cannot be copied, the whole backup is discarded and
recorded as failed rather than left looking complete.

### Set up the second copy — do this at the shop visit

Backups on the same disk as the database do not survive that disk failing.

1. Plug in a USB stick (or open a synced folder — OneDrive, Google Drive).
2. **Ajustes → Copia de seguridad → Elegir carpeta…**
3. Pick the stick.

From then on every backup is written to both places. If the stick is unplugged
the local backup still succeeds and the app notes that the second copy failed —
it never turns a good backup into a failed one. The stick is never pruned; old
copies there are the owner's to manage.

### Taking a backup by hand

**Ajustes → Copia de seguridad → Copiar ahora.** Do this before anything risky:
a big stock import, a Windows update, moving the PC.

### Restoring — the manual procedure

There is deliberately no restore button. Overwriting a live database with one
click is how a day's takings disappear.

1. **Close Codroon POS completely.** Check it is not still in the taskbar.
2. Open `C:\Users\<user>\AppData\Roaming\Codroon POS\`.
3. Rename the current `arkom-pos.db` to `arkom-pos-broken.db` — do **not** delete
   it. If `arkom-pos.db-wal` and `arkom-pos.db-shm` exist, rename them too.
4. Copy the backup you want out of `backups\` and rename the copy to
   `arkom-pos.db`.
5. Start Codroon POS.
6. Check the till: open **02 Catálogo** and confirm the products are there.

Everything after the moment that backup was taken is gone — that is what
restoring means. Which is why the second copy in §7 matters.

---

## 8. Updates

New version, same procedure: **run the new installer over the top.** No need to
uninstall first.

- The shop's data is untouched. It lives in `AppData\Roaming`, the installer only
  replaces the program in `AppData\Local\Programs`.
- Any new database changes are applied automatically the first time the new
  version starts.
- First launch after an update goes straight to the till — the welcome screen
  only ever appears on a database that has no shop in it.

**Take a manual backup before updating** (§7). It costs ten seconds.

### Updating a v0.9.0 till to v0.10.0 — what the client sees

v0.10.0 adds users and permissions to a till that has been selling without
them. The upgrade is one installer over the top and **no data is touched**:
every existing sale, product and setting stays exactly as it was, and past
sales keep showing no cashier name because there was none to record.

On the **first launch after the update** the owner sees one new screen before
the till:

> **Un paso más**
> Esta versión añade usuarios y permisos. Crea el responsable de la tienda para
> continuar. Tus ventas, artículos y ajustes siguen intactos.

They enter their name and choose a PIN, the recovery code is printed, and from
then on the till opens on the Login screen. It cannot be skipped — without a
user there is nobody to attribute a sale to.

**Walk the owner through this in person, or on the phone, the first time.** It
is the only update so far that changes what they see when the app opens.

### Uninstalling

*Settings → Apps → Codroon POS → Uninstall.*

**This removes the program and leaves the data.** The database, tickets and
backups stay in `AppData\Roaming\Codroon POS\`, so reinstalling picks up exactly
where the shop left off. To remove the business data as well, that folder has to
be deleted by hand — deliberately, so an uninstall can never take the books with
it. *(Verified on a clean machine.)*

---

### Updating a v0.12.0 till to v0.13.0 — opening the till each day

v0.13.0 adds the **Caja** screen: a shift per till, a counted float, and a Z
report at the end of the day. The upgrade is one installer over the top and
**no data is touched**. Every past sale, purchase and repair keeps working
exactly as before; they simply belong to no shift, which is the truth about
them — they happened before shifts existed.

**The one thing to tell the shop.** After the upgrade there is no shift open, so
the first attempt to charge a customer, buy a phone or take a deposit will stop
and offer to open one. That is the feature, not a fault. It takes ten seconds:

1. The dialog appears with the usual float already filled in (**Ajustes →
   Caja → Fondo inicial**, 200 € out of the box).
2. Press **Contar…** to count the drawer properly, or just accept the figure.
3. **Abrir turno** — and the charge they already pressed goes through by itself.

From then on the top bar shows a green **Turno abierto · 08:32** chip. If it ever
shows a red **Sin turno**, nobody has opened the till today.

**At the end of the day**, from **09 · Caja**: count the drawer with the same
helper, compare against **Efectivo esperado**, write a line if there is a
difference, and press **Cerrar turno**. A difference over 3 € needs the owner's
PIN. The Z prints, and it is the shop's record of the day.

Two things worth saying out loud to the client:

- **A closed shift cannot be reopened.** If a mistake turns up tomorrow, it is
  recorded as a cash movement tomorrow with a note saying which Z it corrects.
  Yesterday's Z keeps its figures, because that is what was counted.
- **Sales are not in the movements list.** That list is for money that is not a
  sale — deposits, refunds, buying a phone, taking cash to the bank. The takings
  are on the tickets, and the Z adds them up.

The tolerance (3 €), the default float, the approval limit for a manual movement
and the list of frequent concepts all live in **Ajustes → Caja** and are the
owner's to change.

## 9. Install day, in order

Each step assumes the one above worked. Nothing here needs a developer except
step 11, and nothing here needs administrator rights.

- [ ] **1. Install.** Double-click `Codroon POS Setup 1.0.0.exe`, click through
      SmartScreen (§2). It installs for the current Windows user only — no
      administrator prompt — and launches itself.
- [ ] **2. Onboarding, with the REAL data.** The app opens on the wizard.
      - **Language** — top right, *Idioma de la caja*. It sets the screens and
        the starter shelf names. Printed tickets are Spanish either way.
      - **Shop details** — registered name, NIF, registered address, postcode,
        town, phone, footer line. These print at the top of every ticket.
      - **Till and numbering** — till name, and the prefix for each of the five
        documents: tickets, refunds, repairs, used purchases, Z closes.
        **Agree these with the owner: they cannot be changed afterwards.**
      - **Owner** — their name and a PIN they choose, typed twice. You should
        not know it.
      - **Recovery code** — shown once. With no printer yet the blue button is
        **Guardar PDF**; it asks where to save it. Put it in the shop's folder,
        not on the till. §3 explains why this matters.
      - **Printer step** — do it now if the printer is on the counter (step 3),
        or press **Ahora no** and come back to it.
- [ ] **3. Printer + a test print.** **11 Ajustes → Impresión**. The Citizen
      should already be selected (the list hides OneNote, Print to PDF and the
      fax queue behind *Ver todas las impresoras*). Paper **80 mm**, command set
      **Epson (ESC/POS)**. Press **Imprimir prueba** and check the paper:
      - the shop's name, NIF and address, centred and complete — a long name
        wraps onto a second line, it never gets cut;
      - **the accents and the € sign**: the sample line prints
        *Prueba de impresión* and *1,00 €*. If you see `Prueba de impresi?n` or
        a blank where the euro belongs, the printer is on the wrong code page —
        set it to **PC858** in the Citizen utility and test again;
      - the cut at the end.
      **Until a printer is set here, the till refuses to charge** — that is
      deliberate (§4).
- [ ] **4. Cash drawer.** Ajustes → **Abrir cajón**. If it does not open here it
      will not open on a sale (§4).
- [ ] **5. Scanner.** Notepad test first, then Ajustes → *Probar el escáner*
      (§5).
- [ ] **6. The shop's own items.** With the owner, three or four real boxes:
      - **02 Catálogo → + Nuevo artículo** — scan the box barcode into the code
        field, then name, group, cost, PVP, IVA.
      - **03 Inventario → Entrada de stock** — receive real quantities from a
        real supplier at real cost. For phones, one IMEI per unit.
      This is the step that proves the shop's own barcodes work, which is the
      whole reason for the visit.
- [ ] **7. Open the first shift.** **09 Caja → Abrir turno**, counting the float
      that is actually in the drawer.
- [ ] **8. The first real sale.** A phone (with IMEI) and an accessory on one
      ticket, paid in **cash**, with change. Check the paper: both items, the
      IMEI under the phone, **IVA INCLUIDO** under the total, the change, and
      the drawer opening. Then **Reimprimir** once: it comes out stamped
      **COPIA** and the drawer stays shut.
- [ ] **9. The first Z.** **09 Caja**, count the drawer, **Cerrar turno**. The Z
      appears on screen with the day's figures and a variance of 0,00 €. Print
      it if the shop wants paper. A closed shift can never be edited (§8).
- [ ] **10. Second backup destination.** Plug in the stick, Ajustes → Copia de
      seguridad → **Elegir carpeta** (§7), then **Copiar ahora** and confirm a
      file lands both locally and on the stick.
- [ ] **11. Audit** (developer, from the project folder): `pnpm db:audit
      --verify`. It must say **Todo correcto**.
- [ ] **12. Show the owner five things:** reprinting a ticket, where the backups
      are, that closing the app backs it up by itself, how to authorise a
      cashier's price change with their PIN, and that the day ends with a Z.
- [ ] **13. Have a cashier sign in and sell one thing** with you standing there,
      then have them try a price change and let the owner authorise it.

### If install day goes wrong — rollback

Nothing here needs the developer, and none of it deletes anything.

1. **The app will not start, or starts wrong.** Close it. Rename
   `C:\Users\<user>\AppData\Roaming\Codroon POS` to `Codroon POS.broken` and start
   the app again: it comes up on the wizard with a new empty database, and the
   old one is still on disk under the new name.
2. **The data is wrong but the app works** (a test sale in the books, the wrong
   prefix agreed, the shop's name misspelt beyond what Ajustes can fix). Do the
   **factory reset** below — before the first real sale, never after.
3. **A previous version behaved better.** Uninstall from *Add or remove
   programs* — uninstalling does NOT touch `…\Codroon POS\`, the data folder —
   then install the older `Codroon POS Setup <version>.exe`. Data written by a
   NEWER version may not open in an older one: restore the backup from before
   the upgrade (§7, *Restoring*) if it refuses.
4. **The database is damaged.** Close the app, follow §7 *Restoring* with the
   newest file from `…\Codroon POS\backups\`. Every backup is verified when it is
   written, so the newest one that exists is a good one.

### Factory reset for go-live

A till that has been used for training, demos or a dry run should go live from
nothing rather than from a catalogue full of practice sales. There is no button
for this on purpose — wiping the books is not something a screen should offer.
With the app closed:

1. Take one last backup if anything in it might be wanted (Ajustes → **Copiar
   ahora**, or copy the newest file from `…\Codroon POS\backups\`).
2. Rename the data folder `C:\Users\<user>\AppData\Roaming\Codroon POS` to
   `Codroon POS.before-golive` (or delete it — everything in §6 lives there,
   including the practice photos and backups).
3. Launch the app. It migrates a fresh database and opens on the welcome screen
   again: language, real shop details, prefix, owner, recovery code, staff.

Ticket numbering starts again at `T1-000001`, which is the point. Do this
**before** the first real sale, never after — a till that has issued a real
ticket is a set of books, and the way to fix a mistake in a set of books is a
refund or a correcting movement, not a fresh folder.

### Leave behind

- The USB backup stick, plugged in.
- The installer file, somewhere findable, in case Windows needs reinstalling.
- **The printed recovery code**, in the shop's folder — not in the till drawer.
- This document.
