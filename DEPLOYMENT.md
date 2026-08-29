# Arkom POS — installing and running it in the shop

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

`Arkom POS Setup 0.10.0.exe` — about 94 MB.

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

1. **Shop details** — registered name, NIF, registered address, and the footer
   line for the ticket. **Bring the real fiscal data to the shop visit.** These
   three print at the top of every ticket the customer keeps.
2. **Till name and ticket prefix.** The prefix is how tickets are numbered:
   `T1-000001`, `T1-000002`, and so on. **It cannot be changed afterwards** —
   ticket numbering must be gap-free and continuous, so agree it with the owner
   before pressing Start.
3. **Demo data or empty.**
   - *Load demo data* puts 29 sample items with stock in the catalogue, so the
     till can be demonstrated immediately. It can be removed later in
     **Ajustes → Datos de demostración**, but **only until the first ticket is
     issued** — after that the sample rows are part of the shop's books and
     removal is refused.
   - *Start empty* is the right choice if the owner's real stock is going in
     that same day.

4. **The shop's responsable.** A name and a 4–6 digit PIN, typed twice. This is
   the person who can manage users, change settings and authorise a discount.
   Weak PINs are refused — no `1234`, no `1111`, no runs of digits.

Everything except the prefix can be changed later in **Ajustes**.

### The recovery code — do not skip this

Immediately after the owner is created the till shows a **12-character recovery
code, once**, with an **Imprimir** button. Print it and put it in the shop's
folder or safe.

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

Do this before the first real sale.

1. **Install the Citizen driver first, with the printer unplugged.** Get it from
   Citizen's support site (the CT-S310 family driver). Reboot if it asks.
2. **Plug the printer into USB and switch it on.** Windows finishes setting it
   up. Check it appears in *Settings → Bluetooth & devices → Printers & scanners*
   and note the exact name shown there.
3. **Load the paper roll** — 80 mm, printed side facing the head. Close the lid
   until it clicks.
4. In Arkom POS, open **11 Ajustes → Impresión**:
   - **Impresora**: pick the Citizen from the dropdown.
   - **Ancho del papel**: **80 mm**.
   - **Juego de comandos**: **Epson** (the CT-S310S speaks ESC/POS).
5. Press **Imprimir prueba**.

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

Once Notepad is happy, scanning anywhere in Arkom POS works.

---

## 6. Where everything lives

All of the shop's data is under one folder:

```
C:\Users\<user>\AppData\Roaming\Arkom POS\
```

`AppData` is hidden by default. Paste the path into the Explorer address bar, or
turn on *View → Show → Hidden items*.

| What | Exact path |
|---|---|
| **The database** (everything: products, stock, tickets, takings) | `…\Arkom POS\arkom-pos.db` |
| Ticket PDFs | `…\Arkom POS\tickets\` |
| **Photos of used devices** | `…\Arkom POS\photos\` |
| Backups | `…\Arkom POS\backups\` |
| Error log | `…\Arkom POS\logs\arkom.log` |
| The program itself | `C:\Users\<user>\AppData\Local\Programs\arkom-pos\` |

The app shows the first three inside **Ajustes**, each with a button that opens
the folder — easier than typing the path.

> You may see `arkom-pos.db-wal` and `arkom-pos.db-shm` next to the database.
> They are part of it while the app is running. **Copy all three, or none.**
> A backup taken by the app (§7) is always a single complete file — that is the
> one to copy.

---

## 7. Backups

The app backs itself up **every night at 03:30** and **every time it closes**,
into `…\Arkom POS\backups\`. It keeps the last **14** and deletes older ones.
Each backup is reopened and checked immediately after it is made; anything that
fails the check is deleted rather than kept.

Since v0.11.0 each backup is **two things**, not one:

| | |
|---|---|
| `arkom-20260829-0330.db` | the database |
| `arkom-20260829-0330.db-photos\` | the photographs of used devices taken up to that moment |

They are made together, pruned together, and **must be restored together**.
Restoring only the database leaves every used-device purchase listing photos that
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

1. **Close Arkom POS completely.** Check it is not still in the taskbar.
2. Open `C:\Users\<user>\AppData\Roaming\Arkom POS\`.
3. Rename the current `arkom-pos.db` to `arkom-pos-broken.db` — do **not** delete
   it. If `arkom-pos.db-wal` and `arkom-pos.db-shm` exist, rename them too.
4. Copy the backup you want out of `backups\` and rename the copy to
   `arkom-pos.db`.
5. Start Arkom POS.
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

*Settings → Apps → Arkom POS → Uninstall.*

**This removes the program and leaves the data.** The database, tickets and
backups stay in `AppData\Roaming\Arkom POS\`, so reinstalling picks up exactly
where the shop left off. To remove the business data as well, that folder has to
be deleted by hand — deliberately, so an uninstall can never take the books with
it. *(Verified on a clean machine.)*

---

## 9. Shop-visit checklist

In order. Do not skip ahead — each step assumes the one above worked.

- [ ] **1. Install.** Run the installer, click through SmartScreen (§2). It
      launches itself.
- [ ] **2. First run with the REAL data.** Registered name, NIF, address, footer.
      Agree the ticket prefix with the owner — it is permanent. Choose demo data
      or empty (§3).
- [ ] **2b. Create the responsable.** The owner picks their own PIN — you should
      not know it. **Print the recovery code and watch them put it somewhere
      safe** before continuing (§3).
- [ ] **2c. Add the staff** in 12 Usuarios, each with their own PIN, as Cajero.
- [ ] **3. Printer.** Driver, USB, paper, then Ajustes → pick it → 80 mm → Epson
      → **Imprimir prueba**. Check the accents, the € sign, and the cut (§4).
- [ ] **4. Scanner.** Notepad test first, then a scan into the app's search box
      (§5).
- [ ] **5. Real products in.** With the owner, scan the barcodes off three or
      four real boxes and enter them properly:
      - **02 Catálogo** — new item, scan the box barcode into the code field,
        name, group, cost, PVP, IVA 21%.
      - **03 Inventario → Entrada de stock** — receive real quantities from a
        real supplier, at real cost. For phones, enter each IMEI.
      - **01 Venta** — scan the same boxes and confirm each one finds its item
        first time.
      This is the step that proves the shop's own barcodes work, which is the
      whole reason for the visit.
- [ ] **6. One real sale, end to end.** A phone (with IMEI) and an accessory, on
      the same ticket. Take **cash**, with change.
- [ ] **7. Check the ticket.** The paper ticket should carry the shop's real name
      and NIF, both items, the IMEI on the phone's line, the total with
      **IVA INCLUIDO**, and the change. **The cash drawer should have opened.**
      Then check the PDF of the same sale in `…\Arkom POS\tickets\`.
- [ ] **8. Reprint.** From the ticket, press **Reimprimir**. It comes out stamped
      **COPIA**, and the drawer stays shut.
- [ ] **9. Second backup destination.** Plug in the stick, Ajustes → Copia de
      seguridad → Elegir carpeta (§7).
- [ ] **10. Audit.** With the developer present, from the project folder:
      `pnpm db:audit --verify`. It must report **Todo correcto**.
- [ ] **11. Back up.** Ajustes → **Copiar ahora**. Confirm a file appears both
      locally and on the stick.
- [ ] **12. Show the owner four things:** how to reprint a ticket, where the
      backups are, that closing the app backs it up automatically, and how to
      authorise a cashier's price change with their PIN.
- [ ] **13. Have a cashier sign in and sell one thing**, so they have done it
      once with you standing there. Then have them try a price change and let
      the owner authorise it.

### Leave behind

- The USB backup stick, plugged in.
- The installer file, somewhere findable, in case Windows needs reinstalling.
- **The printed recovery code**, in the shop's folder — not in the till drawer.
- This document.
