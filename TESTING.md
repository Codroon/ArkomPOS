# Codroon POS — manual walkthrough

A test you can run yourself, by hand, with no scanner: every code below is typed
into the app. Each step says exactly what to type and what you should see.

**Before you start** — open a terminal in the project folder and run:

```bash
pnpm db:seed     # only fills an empty database; safe to run any time
pnpm dev         # opens the till
```

If you want a clean slate first, delete the `.data` folder and run `pnpm db:seed` again.
The app opens in Spanish; the **ES · EN** chip in the top bar switches the interface.

**Two words you will see a lot:**

| Term | What it is | Length |
|---|---|---|
| **Barcode** (código de barras) | the code printed on the *box* — identifies a **model** | 13 digits |
| **IMEI** | the serial number of **one individual phone** | 15 digits |

> Phones are the only products tracked piece by piece, each with its own IMEI.
> Everything else is counted by model — and one barcode may point to several models,
> which is exactly why the app sometimes asks you "which item is it?".

> **Why an invented IMEI is rejected:** a real IMEI's last digit is a checksum of the
> other 14, so a made-up number is wrong 9 times out of 10. Use a real phone's IMEI, one
> from the box below, or run `pnpm imei:gen 10` for fresh valid ones.

Anywhere you type a code, press **Enter** to submit it (that is what a scanner does).

**Spare valid test IMEIs** (none of these are in the database yet):

```
353474021190657   353474051376481   353474027065457   353474097128706   353474031298037
353474052979234   353474032184889   353474029141223   353474014039127   353474012595260
```

---

## 1. Create a new product with a real box barcode

1. Go to **Catálogo** → click **+ Nuevo artículo**.
2. Fill it in:
   - **Nombre:** `Cargador rápido 65W`
   - **Código de barras (el de la caja):** type `8412345009990`
   - **Grupo:** Cargadores y Cables
   - **Coste:** `8,00` · **PVP:** `19,90` · **IVA:** 21%
   - **Punto de pedido:** `3`
3. Click **Guardar**.

✅ It saves and appears in the list with the barcode you typed — not a generated one.

---

## 2. Receive 10 units of it

1. Go to **Inventario** and click **+ Entrada de stock** in the top right (or just
   press **F6**). A panel slides in from the right — that's where all receiving happens.
   Notice Cantidad and Coste are greyed out until you pick an item.
2. The cursor is already in the search box. Type `8412345009990` and press **Enter**.

✅ The item appears as a card showing its code and current stock, with a
   "Cambiar artículo" link; Cantidad and Coste become editable.

3. **Cantidad:** `10` · **Coste por unidad:** `8,00`
4. Click **Añadir a la lista** → the line drops into the list below and the cursor
   jumps back to the search box, ready for the next box.
5. Choose a **Proveedor** (e.g. *Distribuidora Madrid Móvil*).
6. Check the **Total** at the bottom reads **80,00 €**, then click **Confirmar entrada**.

✅ Toast "Entrada registrada · 1 línea", the row flashes, *Cargador rápido 65W*
   now shows **10** in the table, and the panel empties but stays open for the next
   delivery. Press **Esc** to close it.

7. Click that row to open **Movimientos** on the right.

✅ One line: **ENTRADA**, **+10**, cost 8,00 €, Documento "—" (no sale involved), Usuario "—".
   Press **Esc** to close.

---

## 3. A code the app doesn't know (the rescue)

This is the case that used to fail: you scan the box, nothing matches, dead end.

1. Open the receiving panel again (**F6**) and type `8412345007774` → **Enter**.

✅ A window appears: *"Código no encontrado — Ningún artículo responde a 8412345007774"*,
   offering **Crear artículo nuevo** and **Asignar a un artículo existente**.

2. Click **Asignar a un artículo existente**.
3. Search `Cargador rápido` and click it in the list.

✅ The window closes, the item is now resolved in the panel, and the code has been
   added to it as an additional code. You never left the panel.

4. **Cantidad:** `4` · **Coste por unidad:** `8,00` → **Añadir a la lista** →
   Proveedor → **Confirmar entrada** (Total 32,00 €).

✅ *Cargador rápido 65W* now shows **14**.

5. (Optional check) Type `8412345007774` in the panel again → it resolves straight to
   the same product. The code now belongs to it permanently.

---

## 4. Receiving phones (IMEI one by one)

The seed already contains **Apple iPhone 17 Pro Max 256GB Negro** — barcode
`0194253172567` — with **5 units** in stock. We'll receive 3 more.

1. In the receiving panel (**F6**) type the **barcode** `0194253172567` → Enter.

✅ It resolves with a **SERIE** badge — a phone model.

2. **Cantidad:** `3` · **Coste por unidad:** `1199,00`

✅ An **IMEI 1 de 3** field appears with "Faltan 3 IMEIs" underneath.

3. First, type this **IMEI** and press Enter — it is a phone already in stock, on purpose:

   ```
   353474060000122
   ```

   ✅ Rejected inline: *"Ese IMEI ya está registrado en el sistema."* Nothing is added.

4. Now type these three **IMEIs**, pressing Enter after each:

   ```
   353474060000619
   353474060000791
   353474060000874
   ```

   ✅ Each becomes a chip and the counter walks 1 → 2 → 3. **Añadir a la lista** only
      becomes clickable once all three are in.

5. **Añadir a la lista** → Proveedor → check the **Total** reads **3.597,00 €** →
   **Confirmar entrada**.

✅ The iPhone 17 row goes from **5** to **8**. Open its Movimientos: three separate
   **ENTRADA +1** lines, one per phone, each showing its IMEI.

---

## 5. Accessories sharing one barcode (non-phones)

Two protector models, one wholesaler barcode on both boxes. This is the everyday
case the "which item is it?" picker exists for.

The seed has both, each with its own barcode:

| Product | Its own barcode | Starting stock |
|---|---|---|
| Protector iPhone 15 Pro Max | `8412345001567` | 12 |
| Protector iPhone 16 Pro Max | `8412345001635` | 9 |

### (a) Put the same extra code on both

1. **Catálogo** → click **Protector iPhone 15 Pro Max**.
2. In **Códigos adicionales**, type `8412345008887` → **Añadir código**.

   ✅ A chip with that code appears.

3. Now click **Protector iPhone 16 Pro Max** and add the **same** code
   `8412345008887` → **Añadir código**.

   ✅ A warning appears naming the other product:
      *"Ese código ya está en otro artículo — 8412345008887 también está en:
      Protector iPhone 15 Pro Max."*

4. Click **Asignar igualmente**.

   ✅ The chip appears here too. Both products now answer to that code.

### (b) Receive 5 of the 15 Pro Max using the shared code

1. **Inventario** → **F6** → type `8412345008887` → Enter.

   ✅ The picker opens: *"¿Qué artículo es?"* listing **both** protectors with their
      current stock (12 and 9).

2. Click **Protector iPhone 15 Pro Max** → **Cantidad:** `5` → **Coste por unidad:** `5,00`
   → **Añadir a la lista** → Proveedor → **Confirmar entrada**.

### (c) Receive 3 of the 16 Pro Max using the same code

1. Type `8412345008887` again → Enter → picker → this time click
   **Protector iPhone 16 Pro Max**.
2. **Cantidad:** `3` · **Coste por unidad:** `5,50` → **Añadir a la lista** →
   Proveedor → **Confirmar entrada**.

### (d) Check the two moved independently

✅ In the Inventario table: **Protector iPhone 15 Pro Max = 17** (12 + 5) and
   **Protector iPhone 16 Pro Max = 12** (9 + 3).

✅ Open each row's **Movimientos**: the newest line on the 15 is its **+5** and on the 16
   its **+3** (below them you'll also see the opening stock each one started with — 12 and
   9). Neither shows the other's entry.

### (e) Sell one, using the shared code

1. Go to **Venta** → type `8412345008887` in the search box → Enter.

   ✅ The same picker appears.

2. Click **Protector iPhone 15 Pro Max** → it is added to the ticket at 14,90 €.
3. Click **Efectivo**, leave the amount as it is, and click **Cobrar (F4)**.

   ✅ The sale completes with a ticket number (e.g. `T1-000001`).

4. Back in **Inventario**: **Protector iPhone 15 Pro Max = 16** (one less) and
   **Protector iPhone 16 Pro Max = 12** (unchanged).

### (f) Check the books

```bash
pnpm db:audit --verify
```

✅ Every line reads OK and it ends with *"Todo correcto"*.

---

## 6. Sell a phone — the two ways

**By box barcode** (you have the box, not the phone in hand):

1. **Venta** → type `0194253172567` → Enter.

   ✅ A list of the individual phones in stock opens, each with its IMEI.

2. Click `353474060000122` in that list (any one works, but leave `353474060000205`
   alone — the next half needs it) → it is added to the ticket at 1.499,00 €.
3. **Efectivo** → **Cobrar (F4)** → the sale completes with the next ticket number.

**By IMEI** (the phone is in your hand):

1. **Venta** → type this **IMEI** → Enter:

   ```
   353474060000205
   ```

   ✅ That exact phone is added straight to the ticket — no list, no picker.

2. **Efectivo** → **Cobrar (F4)**.

✅ In **Inventario** the iPhone 17 count has dropped by 2 in total from step 4's result
   (8 → 6). Open its **Movimientos**: the two **VENTA −1** lines each show a ticket
   number in the **Documento** column — click one to see the ticket.

3. (Optional) Type a sold phone's IMEI in Venta again, e.g. `353474060000205`.

   ✅ It says that IMEI belongs to a phone already sold — it does *not* offer to
      create a new product for it.

---

## 7. The three things fixed after your first run-through

### (a) Receiving is its own panel now

1. From **Inventario**, press **F6** (or the **+ Entrada de stock** button).
2. Type `8412345001635` (Protector iPhone 16 Pro Max) → Enter → **Cantidad** `4` →
   **Coste por unidad** `5,50` → **Añadir a la lista**.

   ✅ The cursor returns to the search box on its own.

3. Type `8437123000174` (Auriculares TWS) → Enter → **Cantidad** `2` →
   **Coste por unidad** `8,50` → **Añadir a la lista**.

   ✅ Two lines in the list, **Total 39,00 €**.

4. Pick a **Proveedor** → **Confirmar entrada**.

   ✅ Toast, both rows update, and the panel stays open and empty — ready for the next
      box without reopening anything. Press **Esc** to leave.

### (b) A bad IMEI now tells you why

1. **F6** → type `0194253172567` (iPhone 17 Pro Max) → Enter → **Cantidad** `3` →
   **Coste por unidad** `1199,00`.
2. Type this deliberately corrupted IMEI (its last digit is wrong) → Enter:

   ```
   353474021190650
   ```

   ✅ *"IMEI no válido — el dígito de control no coincide. Vuelve a escanear la etiqueta."*
      The bad number stays selected, so the next scan simply replaces it.

3. Now type these three good ones, Enter after each:

   ```
   353474021190657
   353474051376481
   353474027065457
   ```

   ✅ Counter walks to **3 de 3**; **Añadir a la lista** unlocks.

4. **Añadir a la lista** → Proveedor → **Confirmar entrada**.

   ✅ The iPhone 17 count goes up by 3.

### (c) The till stops you selling what you haven't got

We'll empty one item completely. *Base carga inalámbrica 15W* (barcode
`8437123000167`) starts with **6**.

1. Go to **Venta** and type `8437123000167` → Enter, **six times**.

   ✅ The ticket line reads **6**.

2. Type it a **seventh** time.

   ✅ Nothing is added: *"Solo quedan 6 · Base carga inalámbrica 15W"* and the card shakes.

3. Click the **+** on that ticket line.

   ✅ Same message; the quantity stays at 6.

4. Pay it: **Efectivo** → **Cobrar (F4)** → **Nueva venta**.
5. Now scan `8437123000167` once more.

   ✅ *"Agotado · Base carga inalámbrica 15W"* — the ticket stays empty.

### (d) Check the books

```bash
pnpm db:audit --verify
```

✅ All checks OK.

---

## 8. Sixty-second look at the branding

Nothing to click. Just look, and if any line below is wrong, say so.

| Look at | It should be |
|---|---|
| **The taskbar / Alt-Tab** | The Arkom mark — dark tile, cream **A**, blue bar through it. Not the default Electron atom. |
| **The bar across the top** | Near-black, with **ARKOM** in the heavy brand type, and a thin blue line running the full width underneath it. |
| **The menu down the left** | The page you are on is a black block with cream text. Nothing in the menu is blue. |
| **Blue, on any screen** | Exactly **one** blue thing, and it is the main button: **Cobrar** on Venta, **Confirmar entrada** in the receiving panel, **Guardar** in Catálogo. Two blue things = wrong. |
| **The writing on that blue button** | Black and bold. If it is white, that is wrong — say so. |
| **BAJO MÍNIMO on Inventario** | An amber badge with dark brown writing, readable from a step or two back from the counter. |
| **Prices and totals** | Typewriter-style digits, bold, columns of them lining up on the decimal point. |
| **TOTAL on the ticket** | The heavy brand type, clearly the biggest number on the screen. |

Also worth a glance: nothing anywhere should be blue *writing* on the cream background —
blue is only ever the fill behind a button.

---

## 9. Printing the ticket, with no printer attached

You have no thermal printer yet, and that is fine — this whole section runs
without one. The paper path gets its real test at the shop, on the Citizen.
What you are checking here is the two things that must never cost you a sale:
that the till **refuses to sell** when no printer is set up at all, and that it
**still sells** when a printer is set up and the printing itself fails.

### (a) With no printer configured, the till will not charge

Go to **11 Ajustes**. Under **Impresión**, **Impresora** should read
**Sin configurar**. Leave the paper at **80 mm** and the command set at
**Epson (ESC/POS)**. It saves as you go — there is no Save button and nothing to
forget.

Now go to **01 Venta**, put an item on the ticket, take **Efectivo** and press
**Cobrar**. Nothing is sold, and a message says:

> **No hay impresora configurada. Ve a Ajustes → Impresora y elige una antes de cobrar.**

The ticket stays open exactly as it was. That is deliberate: a till that takes
money it cannot hand a ticket for leaves an argument for later, and this is the
one state where refusing is kinder than selling.

While you are there, look at **Datos de la tienda** below. The fields are empty
until you fill them in — your shop's registered name, NIF and address have to
come from you, and a blank line simply does not print.

### (b) Give it a printer, and sell something

Back in **11 Ajustes → Impresión**, press **Ver todas las impresoras** and pick
any queue Windows offers (OneNote or the fax queue will do — the point is that
it is not a real receipt printer). The till now sells.

Go to **01 Venta**, put two or three items on a ticket — include a phone, so
there is an IMEI on the paper — take **Efectivo**, and press **Cobrar**.

The sale completes as normal: you get a ticket number, and change if you
overpaid. A second later a red message appears bottom-right:

> **No se pudo imprimir** · [Reintentar] [Guardar PDF] [✕]

**This is the point of the exercise.** The sale is done. The money is counted,
the stock has moved, the ticket number is used. The printer failing did not
undo any of it — it only means no paper came out.

Note the message does **not** disappear on its own. Four seconds after a sale
the till moves on to the next customer, and if the message vanished with it you
would lose the only way to recover the ticket.

### (c) Save it as a PDF instead

Click **Guardar PDF**. The message tells you the file name and gives you
**Abrir** and **Ver carpeta**. Nothing is filed per sale: this PDF is written
only because you asked for one, into a temporary folder that is emptied every
time the app starts. To keep a copy, open the sale from **13 Documentos** and
use **Guardar PDF…**, which asks you where to put it.

Open the file. Check it against what you sold:

| On the PDF | Should be |
|---|---|
| Top | **ARKOM** in the heavy brand type, on a blue line. It is the only blue on the page. |
| Under it | Your shop's letterhead — blank until you fill it in under **Datos de la tienda**. |
| Ticket number + date | Matches what the till showed. |
| Each item | Name, then `qty × price`, then the line total on the right. |
| The phone's line | Its **IMEI**, printed underneath the name. |
| A price you changed | The word **MODIFICADO** beside it. |
| **TOTAL** | The biggest thing on the page, with **IVA INCLUIDO** under it — the prices already include VAT, they are not added on top. |
| Payment | What you paid with, and your change. |
| Bottom | Your footer line, then *Gracias por su visita*. |

If any line above is wrong, say so — that is the ticket the customer keeps.

### (d) Reprint it later

Now pretend the customer came back tomorrow without their receipt.

Go to **03 Inventario**, open any item that moved, and in **Movimientos** click
the **Documento** link for that sale. The ticket opens. Click **Reimprimir**.

It fails the same way (still no printer), so click **Guardar PDF** again. Open
the new file — it is the same ticket with **C O P I A** stamped across the top,
and it saved under a different name (`…-COPIA.pdf`) so the original is intact.

A reprint also does *not* open the cash drawer. The money was already counted
once; a copy must not pop the till open again.

### (e) Check the books are still straight

```bash
pnpm db:audit --action print --diff
```

Every attempt is listed — the failed ones say `ok = false`, the PDFs say where
they went. Nothing about printing is invisible.

Then the full check:

```bash
pnpm db:audit --verify
```

✅ It must pass. A failed print must leave **no** mark on the sale itself: the
numbering is still gap-free, the stock still matches its movements, the sale
still balances.

> **At the shop:** pick the Citizen CT-S310S in Ajustes, press
> **Imprimir prueba**, and paper should come out and cut. That button prints a
> sample — it does not use up a ticket number or leave a fake sale in your books.

---

## 10. The installed version

Everything above runs the app from the code. This checks the thing the shop
actually gets. Full instructions are in **DEPLOYMENT.md** — this is the short
version, for confirming a build is sound before it leaves.

Build it:

```bash
pnpm build:win
```

The installer lands in `apps/desktop/release/Codroon POS Setup 0.9.0.exe` (~94 MB).

### The clean-machine walk

| Step | What should happen |
|---|---|
| Run the installer | Windows shows a SmartScreen box → **More info** → **Run anyway**. No administrator password is ever asked for. It installs and launches itself. |
| First launch | The **welcome screen**, not the till. Fill in a shop name, NIF and address, pick a ticket prefix, choose **Cargar datos de ejemplo**, press **Empezar**. |
| The till opens | The catalogue has the 29 sample items. The topbar carries the till name you typed. |
| Sell something | A phone and an accessory, cash, with change. The ticket number uses **your prefix**. |
| The ticket | No printer configured yet → the red **No se pudo imprimir** message with **Guardar PDF**. Save it, press **Abrir**, check the shop name you typed is on it. |
| Close the app | It closes. It does not hang. |
| Open it again | Straight to the till — **no welcome screen** — and the sale you made is still in the books. |
| A backup exists | `%APPDATA%\Codroon POS\backups\` has a file, written when the app closed. |
| Uninstall | *Settings → Apps → Codroon POS → Uninstall*. The program goes; `%APPDATA%\Codroon POS\` and its database **stay**. |

### Where the data lives

Paste this into the Explorer address bar (`AppData` is hidden):

```
%APPDATA%\Codroon POS
```

`arkom-pos.db` is the whole business. `tickets\`, `backups\` and `logs\` sit
beside it. Ajustes has a button for each of the first three.

> If anything above behaves differently, that is worth reporting — the packaged
> build is what the shop runs, and it is the only version whose paths, installer
> and permissions are real.

---

## 11. Usuarios and PINs (v0.10.0)

From this version the till asks who you are. Nothing sells until someone signs
in, and every sale now records the person who made it.

> **Dev PINs** — a seeded development database creates two users:
> **Ahmer / 8317** (responsable) and **Ana / 5162** (cajero).
> These exist **only** on a developer's machine. A real install has no seed
> step: it asks the owner to set their own PIN on first launch, and nobody else
> ever knows it.

### (a) Signing in

Start the app. You get tiles, not a password box. Tap **Ahmer**, type `8317`,
press **Entrar**.

Type it wrong on purpose. It should say **"PIN incorrecto · te quedan 4
intentos"**, and count down each time. Get it wrong five times and that user
locks for a minute with a countdown you can watch — and **the other user can
still sign in**, because it locks the person, not the till.

### (b) What a cashier cannot do

Sign out (top-right, your name → **Cambiar de usuario**) and sign in as **Ana**.

Look at the menu. It ends at **10 Informes** — no **11 Ajustes**, no
**12 Usuarios**. Those are the owner's, and they are not merely greyed out:
even if the button were there, the till would refuse the request.

### (c) What a cashier can do with permission — the important one

Still as Ana, put something on a ticket, click the **…** on the line and choose
**Modificar precio**. Set a lower price, give a reason, apply.

Instead of refusing, a box appears: **"Autorización del responsable"** showing
what is being authorised — the item, `14,90 € → 10,00 €`, and your reason.
Type **Ahmer's** PIN (`8317`) and press **Autorizar**.

The price changes and the sale carries on. **This is the point of the version:**

```bash
pnpm db:audit --action price_override --diff
```

The entry records Ana as the person who did it — and Ahmer as the person who
allowed it. Two different facts, and the second is the one that settles an
argument three weeks later.

Now try it again on another line. It asks again. There is deliberately no
"stay authorised for five minutes".

### (d) The lock

Leave the till alone for five minutes, or click your name → **Bloquear**.

The screen goes black with your name on it. Esc does nothing. Only **your** PIN
opens it — there are no other user tiles — and when it opens, the ticket you
were building is exactly where you left it.

To hand over to someone else, use **Cambiar de usuario**. If a ticket is open it
is parked automatically with a note, so the next person's lines never end up
mixed into yours.

### (e) Managing people

As Ahmer, go to **12 Usuarios**.

- Add a user: name, role, PIN twice. Try `1234` — it is refused as too easy.
- Open Ana and look at **Permisos**: every permission grouped by area, each
  saying "Por defecto", "Permitido" or "Bloqueado". Switch one on and it becomes
  hers without inventing a new role.
- Open Ahmer. His toggles are disabled: the responsable always has everything.
- Try to deactivate Ahmer while he is the only responsable. **It refuses**, and
  says why.

### (f) If a PIN is forgotten

A **cashier** forgetting theirs: the owner resets it from Usuarios in ten
seconds. On the Login screen, "He olvidado mi PIN" tells them exactly that.

An **owner** forgetting theirs: that is what the recovery code printed at setup
is for. Keep it in the shop's folder — it is the only way back in, by design.
Entering it lets you set a new PIN and prints a fresh code.

### (g) The books

```bash
pnpm db:audit --entity user --diff
```

Sign-ins, sign-outs, locks, failed attempts, lockouts, approvals granted and
denied — all there. **No PIN appears anywhere in it**, and none ever will.

---

## 12. Used devices and store credit (v0.11.0)

Sign in as **Ahmer / 8317**. This whole section needs no hardware: every print
falls back to a PDF you can open from the toast.

### (a) Buying a phone

**04 · Comprar usados.**

Fill the device: `Apple` / `iPhone SE 2020` / `64GB` / `Blanco`, grade **B**,
battery `86`. Fill the seller: `Imran Khan`, DNI `Y2841170F`.

Now the IMEI. Type one you know is already in stock — `353474060000122` —

✅ The right-hand rail says **Ya existe en el sistema** and names the device it
   belongs to. The confirmation checkbox stays greyed, and *Precio* and *Forma de
   pago* stay inert. **There is no way to price a device you cannot buy.**

Clear it and type `352094118803185` —

✅ **IMEI válido.** The checkbox wakes up. The price and payment cards are still
   inert until you tick it, because the check is the physical one you are
   promising you did.

Tick the box —

✅ Price and payment become editable. Enter **80,00** and leave the payout on
   *Efectivo*. Press **Generar** next to the barcode.

Press **Dejar en espera** —

✅ A green card: *Compra C-000001 registrada. El dispositivo queda en espera.*
✅ Two prints go out (or two PDFs): the **purchase document** and a **shelf
   label**. Open the document.

The document is the reason the screen exists. Check it has, in this order: the
shop's legal block, `C-000001` and the date, the device and its IMEI, the
accessories, **VENDEDOR** with the name and DNI, the amount paid, the ownership
declaration, and then **three blank lines above a signature rule**. A seller has
to be able to sign it with a real pen.

### (b) The gate is not just the screen

Still on 04, start another purchase for the SAME IMEI `352094118803185` —

✅ Refused before you can price it: the device is now a unit in the system.

### (c) The register

**05 · Dispositivos usados.**

✅ Your purchase is there, newest first, with an **En espera** chip and no
   selling price.
✅ The counts strip reads `En espera 1`. Click it — the list filters and the
   counts do **not** change. (A filter that also changes its own counts is one
   you cannot navigate back out of.)
✅ Search `352094` — one row. Search the purchase number `C-000001` — one row.

Open it.

✅ **Quién vende** shows the name and DNI, because you are the owner.
✅ **Historial** lists the purchase, the device and the document as three
   separate entries, each *by Ahmer*.
✅ **Reacondicionamiento** has an *Editar* link. Set it to **15,00** —
   *Coste total* becomes **75,00 €**.

Press **Enviar a inventario** —

✅ The modal shows the cost breakdown and prefills **93,75 €** — 75,00 plus the
   25% margin from Ajustes, rounded up to 5 cents. Confirm it.
✅ The chip becomes **En stock**, the actions collapse to one line, and
   *Reacondicionamiento* now says **Ya incluido en el inventario. No se puede
   cambiar.** That is not a UI whim: the figure is inside a posted stock
   movement, and this ledger does not rewrite those.

### (d) What a cashier sees

Sign out, sign in as **Ana / 5162**.

Open the same device from **05** —

✅ Where the seller block was: *Datos del vendedor ocultos — requiere permiso.*
✅ The ID photo, if you took one, is not in the gallery either.
✅ There is no **Reimprimir documento de compra** button — a reprint is a way to
   read the seller's details off a till that will not show them.

> To prove it is not just hidden: as Ahmer, **12 · Usuarios → Ana**, switch
> **Ver los datos del vendedor** on. Sign back in as Ana and the block appears.
> Switch it off again before continuing.

### (e) Selling the phone you bought

Still as Ana, **01 · Venta**. Scan or type the barcode you generated, or search
`iPhone SE` —

✅ It is there, and its name ends in **(usado)**.
✅ The unit picker shows the phone with its **grade** and **its own price** —
   93,75 €, not the product's.

Add it and press **Cobrar**, cash —

✅ The ticket shows **no IVA** for that line and prints **Régimen especial de
   bienes usados** instead. Under the margin scheme the customer pays no VAT
   they could deduct, and the document must not pretend otherwise.

Now check **02 · Catálogo** —

✅ The used product is **not** in the list. It is bookkeeping the buy screen
   creates, not stock the owner maintains.

### (f) Store credit

As Ahmer, buy a second phone on **04** — any valid IMEI, `50,00 €` — and set the
payout to **Saldo a favor**.

✅ The card says a voucher will be issued for 50,00 €.
✅ After logging, the green card offers **Continuar a la venta**.

Press it —

✅ Venta opens with the credit already applied as a tender chip reading the
   purchase number and 50,00 €. The amount is not editable: a voucher is spent
   whole.

Add items until the total is **more** than 50 €, pay the rest in cash, and press
**Cobrar** —

✅ The sale completes. **The total is the value of the goods** — the credit is a
   payment, not a discount, so nothing about the taxable base changed.

Try to use the same voucher again: **Venta → Saldo → search the same number** —

✅ It is listed, greyed, marked **Ya usado**. Not hidden — a cashier who cannot
   see why is a cashier arguing with a customer about a slip.

One more: start a ticket for a few euros and search a voucher worth more —

✅ Listed, greyed, **Mayor que el total**, with the rule underneath. The shop's
   answer is to add items or pay another way, not to quietly keep the change.

### (g) The books

```bash
pnpm db:audit --verify
```

✅ Still all OK. Purchases have their own `C-` series, gap-free and independent
   of ticket numbers; the used phone's stock-in and the sale that took it back
   out both balance.

---

## 13. Repairs (v0.12.0)

Sign in as **Ahmer / 8317**. No hardware needed: every print falls back to a PDF
you can open from the toast.

### (a) Taking a device in

**06 · Reparaciones → Nueva reparación.**

Search the customer by phone. Nobody matches yet, so press **Nuevo cliente**,
fill `Joan Puig` / `671 220 918`, and create. The block collapses to one line.

Fill the device: `Apple iPhone 11 64GB`, fault `Pantalla rota, táctil
intermitente`. Tick **Pantalla rota** and **Golpes**. Type `0451` in
**Código / patrón** and press **Ver** — it reveals, and **Ocultar** hides it
again. Set a **Depósito** of `20`.

Now **Entrega prevista**. It is a typed field, not the operating system's date
picker, so it reads the same on a Spanish Windows and an English one.

- Type `hoy`. ✅ It says **La fecha de entrega no es válida** and
  **Crear ficha** goes grey. Your keystrokes are still there to correct.
- Type `31/02/2026`. ✅ Refused too — February has no 31st, and a date picker
  would have quietly offered you 3 March.
- Type `3-9` and click away. ✅ It becomes **03/09/2026** — day first, always,
  and the missing year is the next one, never a date already gone by.
- Press **+1 semana**. ✅ Seven days from today, in the same spelling.

Press **Crear ficha e imprimir resguardo**.

- ✅ The panel says **Ficha R-000001 creada** and **Depósito de 20,00 € registrado en caja**.
- ✅ A toast offers the saved PDF. Open it. The receipt is **in Spanish even if
  the UI is in English** — flip the ES · EN toggle first and check.
- ✅ It lists the damage marks, the deposit, the warranty sentence, the notice
  about not doing chargeable work without approval, and a signature line.
- ✅ **The passcode is nowhere on it.** Search the PDF for `0451`.

### (b) Quoting, and what the customer agreed to

Open the ficha. Under **Presupuesto**:

1. **Añadir mano de obra** → `Cambio de pantalla`, `30`.
   - ✅ The status chip moves to **PRESUPUESTADO**. Nothing was clicked to do that.
2. **Añadir pieza del inventario** → pick any accessory with stock, quantity 1.
   - ✅ The row says **Descontada del inventario**.
   - ✅ Check **03 · Inventario**: that article's on-hand has dropped **now**,
     not at hand-back. Open its movements — the row is a `repair_part_out`
     carrying **R-000001** as its document.
3. Press the blue **Registrar aprobación** → **En persona** → confirm.
   - ✅ The status moves to **EN REPARACIÓN** and the strip shows the amount
     approved, who recorded it and when.
4. Now add another labour line for `50`.
   - ✅ The ticket falls **back to PRESUPUESTADO** by itself: the quote grew past
     what was approved.
   - ✅ Print the quote. It asks for a **new signature** rather than saying
     APROBADO — the paper agrees with the screen.
5. Approve again.
   - ✅ **Aprobaciones** now lists **two** rows, oldest last. Neither was overwritten.

### (c) Lowering a charge after approval

Click the **charge** amount on the labour line and type something lower.

- ✅ A **Motivo de la rebaja** field appears. Leaving it empty refuses the save.
- ✅ Fill it in and save. It goes through.
- Now sign out and back in as **Ana / 5162** (cashier) and try the same.
  - ✅ Ana is asked for an owner's PIN. Type Ahmer's `8317`.
  - ✅ It goes through, and the oplog entry names **both** people.

### (d) A part you have to order

**Añadir pieza por pedir** → `Batería iPhone 11`, supplier `Movilex`,
expected `18`, charge `45`. Approve the new total.

- ✅ The ticket sits at **ESPERANDO PIEZA**.
- ✅ **Piezas por pedir** (the second tab) lists it with the ticket number, the
  customer, the expected cost and days waiting.

Press **Recibida** on that row. Pick a catalogue article, set the real cost to
`21` (not the 18 that was expected), confirm.

- ✅ The toast says the stock entry was recorded **and** the part was taken.
- ✅ In **03 · Inventario** the article shows **two** new movements: a
  `purchase_in` of +1 at 21,00 € and a `repair_part_out` of −1. Net zero on the
  shelf, both halves visible.
- ✅ That article's **cost** is now 21,00 € — it came from the invoice.
- ✅ The ticket is back at **EN REPARACIÓN**, and the buying list is empty.

### (e) The board

**07 · Taller.**

- ✅ Seven columns, with **Entregado** and **No reparado** hidden until you turn
  on *Ver cerradas*.
- ✅ The card shows the number, the device, the fault in one line, the technician
  (or *Sin asignar* in italics) and days in the current status.
- ✅ Clicking a card opens its ficha. Cards do not drag — see the README.

### (f) Handing it back

Back on the ficha, press the blue **Marcar listo**.

- ✅ **LISTO**. Try it on a ticket with a part still on order — refused, and the
  reason is in words.

**Avisar al cliente** → Teléfono, note `Avisado, pasa mañana` → confirm.

- ✅ It appears under **Avisos al cliente** with your name and the time.
- ✅ Nothing was sent anywhere. The dialog says so.

**Cobrar y entregar.**

- ✅ The **Depósito · 20,00 €** is already there and cannot be removed. The
  total is still the full value of the work — the deposit is a payment, not a
  discount.
- ✅ **Pendiente** is the remainder. Pay it in cash with more than is due.
- ✅ **Cambio** appears, using the same rules as the Sale screen.

Confirm.

- ✅ The ticket is **ENTREGADO** and shows its **T1-** number.
- ✅ The printed receipt names **both** documents, breaks out base and IVA 21%
  adding back to the total exactly, lists the deposit as a payment, and carries
  the **warranty end date**.
- ✅ The passcode is not on it.
- ✅ **03 · Inventario**: no new movement. The parts left when they were fitted.

### (g) A device you could not fix

Take in a second device with a deposit and fit a part to it. Then press
**Marcar no reparado** at the bottom of the actions card.

- ✅ The confirm stays **disabled** until every consumed part is resolved.
- ✅ Choose **Devolver al inventario** for the part. Choose **Devolver** for the
  deposit. Confirm.
- ✅ In **03 · Inventario** the part is back, as a **second movement** — the
  original is still there. Nothing was deleted.
- ✅ The return document prints: what came back, why, the deposit returned, and
  a line the customer signs.
- ✅ As **Ana**, the same action asks for an owner's PIN first.

### (h) The passcode, one last time

Open a ficha with a passcode.

- ✅ It shows as `••••` until you press **Ver código**.
- ✅ Run `pnpm db:audit` — no complaint. Then search every printed PDF you
  produced in this section for the passcode. It is in none of them.

---

## 14. Caja — el turno (v0.13.0)

Sign in as **Ahmer / 8317**. No hardware needed: every print falls back to a PDF.

### (a) The till will not take money until somebody opens it

Go straight to **01 · Venta**, add any product and press **Cobrar (F4)**.

- ✅ The sale is **not** refused with a red error. A dialog appears saying
  *Para cobrar hace falta un turno abierto*, with the float already filled in.
- ✅ Look at the top bar first: a red **▲ Sin turno** chip. Click it — it goes to
  **09 · Caja**.

Back on the sale, press **Cobrar** again to bring the dialog back. Press
**Contar…**.

- ✅ Two columns, notes and coins, largest first. Type `4` beside 20,00 € and
  `10` beside 10,00 €. The TOTAL reads **180,00 €** as you type.
- ✅ **Usar este total** puts 180,00 € in the field and shows the breakdown under it.

Press **Abrir turno**.

- ✅ The dialog closes and **the charge you already pressed goes through by
  itself**. You are not asked to press Cobrar twice.
- ✅ The top-bar chip is now green: **Turno abierto · HH:MM**.

### (b) What needs a shift and what does not

With the shift still open, close it for a moment — do §(f) first if you want to
try this, or simply trust the tests. What matters on screen:

- ✅ **03 · Inventario → Entrada de stock** works with no shift open. A delivery
  is unpacked before the shop opens and involves no drawer.
- ✅ **06 · Reparaciones → Nueva reparación** with the deposit left empty works
  with no shift. Put `20` in **Depósito** and it asks for a shift instead.

### (c) The drawer ledger, and why sales are not in it

**09 · Caja.**

- ✅ Left: **TURNO** with the float, who counted it, when, and the breakdown on
  one line.
- ✅ Right: **MOVIMIENTOS DE EFECTIVO (NO VENTAS)**, and under the heading, in
  small type: *Las ventas no aparecen aquí: se leen de los tickets.* The sale
  you just made is **not** in this list. That is the design, not a bug.

Take in a repair with a **20 €** deposit (§13a) and pick **Efectivo** as the
method.

- ✅ A **DEPÓSITO** row appears, +20,00 €, with the `R-` number.
- ✅ Click the row: the document opens.

Now take in a second device with a **30 €** deposit and pick **Tarjeta**.

- ✅ **No row appears.** A card deposit is real money and a real obligation, but
  it never reached the drawer. It is on the ticket, and the Z will report it.

Press **Salida** in the panel header. Amount `200`, and tap the
**A la caja fuerte / banco** chip.

- ✅ A **SALIDA** row, −200,00 €, with your name.
- ✅ The footer strip: Entradas **+20,00 €** · Salidas **−200,00 €** · Neto **−180,00 €**.

Try **Salida** again with `150`.

- ✅ Above the 100 € limit, so it warns you before you submit and then asks for
  an owner's PIN. As Ahmer you are not asked — you already hold it. Sign in as a
  cashier to see the keypad.

### (d) The X, before committing to anything

Look at the **CIERRE** panel on the left, marked **PROVISIONAL**.

- ✅ **Efectivo esperado** is float + the cash part of your sale + 20,00 −
  200,00. Check it by hand.
- ✅ Open **Ver detalle Z**: base, IVA, total, and a line per payment method.

Press **Ver la X**.

- ✅ Since v0.14.1 the X opens **on screen** as a document, headed **Vista X ·
  PROVISIONAL**, with a closing line *No es un cierre. No consume número.*
  Nothing was printed, and no paper was spent to answer the question.
- ✅ Its actions are **Imprimir · Guardar PDF · Cerrar**. Press **Guardar PDF**:
  a file called `X.pdf` appears, with the same figures.
- ✅ Nothing was written: the panel still says PROVISIONAL and no Z number
  exists.

Toggle the header to **EN** while the X is open.

- ✅ The whole document re-reads in English — *X reading*, *Cash expected*,
  *Not a close. Consumes no number.* — and **every figure is identical**. A Z is
  the shop talking to itself, so it follows the staff language; a customer
  ticket does not (ADR-0015 A1). Toggle back to **ES** before continuing.

### (e) Counting, and a difference you have to explain

Press **Contar…** in the Cierre panel and count **10 €** less than expected.

- ✅ **Descuadre −10,00 €** in red, with **FALTA 10,00 €** beside it.
- ✅ A **Motivo del descuadre** field appears. **Cerrar turno** stays grey while
  it is empty.
- ✅ A line warns that 10,00 € is over the 3,00 € tolerance and will need a
  manager.

Type `Se dio mal el cambio por la tarde` and press **Cerrar turno**.

- ✅ A confirmation showing expected, counted, variance and your reason — not a
  second form. You do not type the count twice.

Press **Cerrar el turno**. As a cashier you would be asked for an owner's
PIN here; as Ahmer you are not.

### (f) The Z

- ✅ You land **directly on the Z document**, headed **Informe Z · Z1-000001**.
  Nothing printed — check the `tickets` folder if you like; there is no new PDF.
  Since v0.14.1 the paper is a choice, taken on the screen that already has
  your attention (ADR-0015 A1).
- ✅ The primary action is **Abrir nuevo turno**, which is the shop's actual
  next move.
- ✅ Press **Guardar PDF** twice. The first file is `Z1-000001.pdf`; the second
  is `Z1-000001-COPIA.pdf`. The original is spent by the first print.
- ✅ Open the PDF. Check, in order: the Z number and the till · who opened and
  who closed · **DOCUMENTOS** with a count and a first→last number per series ·
  **VENTAS** with base and IVA 21% · **COBROS**, one line per method, whose
  **TOTAL COBRADO equals TOTAL VENTAS** · **MOVIMIENTOS (NO VENTAS)** ·
  **POR MEDIO DE PAGO** with Entra / Sale / Neto per method · the counts · and
  the drawer block ending in **DESCUADRE** and **FALTAN 10,00 €**, your reason,
  and the approver if one was needed.
- ✅ The **card deposit from §(c) is on the Z** under Tarjeta, even though it
  never touched the drawer.
- ✅ The **cash** line of POR MEDIO DE PAGO equals expected minus the float.
- ✅ There is no *Devoluciones 0,00 €* line. Refunds do not exist in this phase,
  and printing a zero for them would imply they do.

Now try to sell something.

- ✅ Refused with the open-a-shift dialog again. The till is closed.

### (g) A closed shift does not change its mind

Press **Historial** in the Caja header (owner only).

- ✅ One row: Z1-000001, both names, expected, counted, descuadre, approver.
- ✅ Click the row: the same Z opens on screen. **Guardar PDF** here produces
  `Z1-000001-COPIA.pdf` — a Z reopened from the history is **always** a copy,
  however many times you ask.

The proof that matters is in the tests: the reprint renders the frozen snapshot,
so deleting every tender from that shift afterwards does not change one number on
the paper. Nothing on this screen offers to reopen or edit a closed shift, and
nothing anywhere else does either.

### (h) The audit

Run `pnpm db:audit --verify`.

- ✅ Thirteen checks, all OK. Four of them are new: one open shift per till,
  gap-free Z numbers, every closed shift still computing to what it froze, and
  every stamped row sitting inside the shift that signs it.

---

## 15. Informes (v0.14.0)

Sign in as **Ahmer / 8317**. Everything here is read-only: you can run any of it
twice and nothing changes.

### (a) The hub

**10 · Informes.**

- ✅ Five cards. Each one shows a single number **and the window it covers**:
  *Neto · este mes*, *Ahora*, *Coste inmovilizado · ahora*, *A coste · ahora*,
  *Sin venta en 90 días · ahora*.
- ✅ The Reparaciones card's overdue half is red only when it is not zero.
- ✅ There is no date selector in the header. Three of the five reports answer
  "right now", so a global range would be a lie for most of the screen.

### (b) Ventas — and the tax figures

Open **Ventas**.

- ✅ Presets: Hoy · Ayer · Semana · Mes · Mes pasado · Personalizado. Pick
  **Mes**; the header says the range.
- ✅ The strip: Tickets · Neto · IVA 21% · Bruto · Ticket medio, and
  **Usado (REBU, sin IVA)** on its own — a margin-scheme sale carries no VAT and
  adding it to the taxable base would misstate the return.
- ✅ **This is the tax report.** Neto + IVA = Bruto for the period.

Switch **Agrupar por** through Día · Grupo · Artículo · Usuario · Medio de pago.

- ✅ Every grouping's Bruto column adds up to the same Bruto in the strip. Check
  one with a calculator — that equality is a test, and it is worth seeing once.
- ✅ Grouped by **Artículo** you get three more columns: Coste, Margen, Margen %.
- ✅ Grouped by **Grupo**, a repair you have collected appears under
  **Reparaciones**. The `T1-` a hand-back creates is an invoice like any other.

Click a **Día** row.

- ✅ A list of that day's tickets. Click one: the usual ticket peek.

Now the cross-check that matters. Pick a closed shift in the **Turno** dropdown.

- ✅ Tickets, Neto, IVA and Bruto match that shift's printed Z exactly. Open the
  Z PDF beside it and compare. If they ever differ, one of them is lying.

### (c) The estimated-cost warning

If the shop has sales from before v0.14.0, group by **Artículo**:

- ✅ A yellow strip under the summary: *N de M líneas son anteriores a v0.14.0 y
  usan el coste actual del artículo. El margen es aproximado.*
- ✅ Sell something new, then look again: the new line is exact, and the count in
  the warning goes up by one on the M side, not the N side.

The reason this exists: before this version the till never recorded what a thing
cost when it was sold, so those rows can only use today's cost. That is the best
answer available, and it is not the same kind of answer.

### (d) Reparaciones

- ✅ **Abiertas** lists every open ticket with days in status and days since
  intake. Vencidas is red when non-zero; **Esperando al cliente** (quoted) is
  highlighted, because that pile grows without anyone touching it.
- ✅ Filter by status and by technician, including *Sin asignar*.
- ✅ Click a row: it opens the repair page.
- ✅ **Cerradas en el periodo** shows Entregadas · Ingresos · Piezas · Mano de
  obra · Margen · Tiempo medio · No reparadas, with the reasons broken out below.
- ✅ Turn on **Agrupar por técnico**: one row per person, same money columns.
- ✅ Ingresos equals the sum of the collection tickets in the period.

### (e) Dispositivos usados

- ✅ Three status figures, each *count · cost*, plus **Saldo a favor pendiente** —
  money the shop owes, beside money it is holding.
- ✅ The table is **oldest first**. Days over 60 go amber and over 120 go red.
- ✅ Filter by grade: the table narrows and the summary figures **do not move**.
  A filter narrows what you are looking at, not how much money is asleep.
- ✅ Click a row: the used device detail.

### (f) Valoración de inventario

- ✅ One big number: **Total a coste**.
- ✅ Now open **03 · Inventario** in the same session and read its header total.
  **They must be identical to the cent.** This is the check worth doing by hand
  once, because two screens disagreeing about the same money is worse than
  neither existing.
- ✅ A serialized product shows `—` for Coste unitario and a real Valor: five
  identical phones bought at three prices have no single unit cost.

### (g) Stock muerto

- ✅ Header says *Sin venta en 90 días · ahora*. The threshold is in
  **Ajustes → Informes**, not in the filter bar — a threshold you can twiddle on
  the report is an invitation to fish for a nicer number.
- ✅ Sorted by **Coste inmovilizado**, largest first: 40 unsold cases at 2 € are
  a tidy-up, one unsold laptop at 900 € is the point.
- ✅ A product that never sold shows *nunca* in italics.
- ✅ Used phones are absent. Section (e) covers them.

Change the setting to 30 days in Ajustes and come back:

- ✅ More products, and the header now says *Sin venta en 30 días*.

### (h) The CSV — open one in Excel

On any report, press **Exportar**.

- ✅ A save dialog with a name like `informe-ventas-2026-09-02.csv`.
- ✅ Save it and **double-click it**. This is the whole test:
  - Columns land in separate columns, not all in column A (semicolons).
  - Money is right-aligned and can be summed — Excel sees numbers, not text
    (decimal comma).
  - Accents in your product names are correct, not `Ã­` (UTF-8 with a BOM).
  - Dates read `02/09/2026`, not `2026-09-02`.
- ✅ The first line names the report and its period. If a margin was estimated,
  the second line is the **AVISO** — the warning cannot be lost by exporting.
- ✅ Export with a filter set, then check the file contains only the filtered
  rows. The export re-runs the query rather than copying what is on screen.

### (i) The permissions

**12 · Usuarios** → open a cashier → grant **Ver informes** but not
**Ver costes y márgenes en informes**. Sign in as them.

- ✅ **10 · Informes** appears, with **two** cards: Ventas and Reparaciones. The
  other three are not rendered at all — not greyed.
- ✅ Ventas grouped by Artículo has **five** columns. No Coste, no Margen.
- ✅ Reparaciones has no **Cerradas** tab.
- ✅ Export Ventas: the file has no cost columns either.

Now take **Ver informes** away as well.

- ✅ The Informes menu item is gone.

---

## 16. Grupos, técnicos y el idioma (v0.14.1)

Four checks that cut across screens. Each one is a **pattern**: if it holds on
one screen and not another, it has failed.

### (a) The shop names its own shelves

**02 · Catálogo** → **Grupos** (next to *+ Nuevo artículo*).

- ✅ The five starter groups, each with **Renombrar**. No delete button, and a
  line saying so: *Los grupos no se borran.*
- ✅ Type `Coche y viaje` in **Nuevo grupo** and press **Crear**. It appears in
  the list **and** in the *Grupo: todos* filter behind the modal, immediately.
- ✅ Type `  COCHE Y VIAJE ` and press **Crear** again. Refused **under the
  field**, not in a toast: *Ya existe un grupo con ese nombre.* Spacing and
  capitals do not make a new group.
- ✅ Type `Moviles` (no accent) and press **Crear**. **Accepted** — those are
  different words, and refusing it would be wrong.

Now press **Renombrar** on your new group, change it, and save.

- ✅ The catalog filter behind the modal already shows the new name.
- ✅ **03 · Inventario** and **01 · Venta** show it too, without a restart. One
  list, one fetch (ADR-0017 §6).
- ✅ **10 · Informes → Valoración** and **Stock muerto** group by the new name.

### (b) The dead end that used to exist

**02 · Catálogo → + Nuevo artículo**. Open the **Grupo** dropdown.

- ✅ The last option is **+ Nuevo grupo…**. Pick it: the field becomes a name
  box with **Crear** beside it.
- ✅ Create one. The field returns to a dropdown **with your new group already
  selected** — the article you are typing lands in it.
- ✅ A duplicate name here shows the same error, under the same field.

The point of this: a shop that chose *Empezar vacío* at first run used to reach
this field, find it empty, and have no way forward.

### (c) Técnicos are names, not logins

**12 · Usuarios** → create a user with the **Técnico** role.

- ✅ No PIN is asked for, and none can be set at creation.
- ✅ Sign out. The technician **is not on the login screen**.
- ✅ **06 · Reparaciones**, **07 · Taller**, the ficha's *Cambiar técnico*, and
  **Informes → Reparaciones** all offer that name — the same list in all four.
- ✅ Assign a repair to them while signed in as Ahmer, then look at the ficha's
  history: the action is recorded against **Ahmer**, not the technician. A
  technician is assigned work; they never act.
- ✅ Back in Usuarios, give them a PIN. They now appear on the login screen like
  anyone else — that is the second-shop path, and it is the same rule.

### (d) The language really is a toggle

Set the header to **EN** and walk the app.

- ✅ Every screen, dialog, chip, empty state and toast is in English —
  especially **Comprar usados**, **Reparaciones**, **Caja** and **Informes**.
- ✅ Provoke an error: try to save a product with a name another already has.
  The message is in English (`err.duplicateName`), not Spanish.
- ✅ Try an action a cashier needs approval for while signed in as one: the
  invitation is in English too.
- ✅ Product, group and customer names stay exactly as the shop typed them.
  **They are not translated**, and after the first rename a group is the shop's
  own word (ADR-0017 §2).
- ✅ Print a customer ticket while in English. **The ticket is still Spanish** —
  a customer document and a tax record do not follow a staff toggle. Only the Z
  and the X do.

One string that slips through is a bug, not a preference: `pnpm test` fails on
any Spanish letter inside a renderer string literal.

---

## 17. Final check
```bash
pnpm db:audit --verify
```

✅ All checks OK: stock matches its movement history, every change is in the audit
   log, ticket numbers are consecutive with no gaps, sales balance, and every IMEI is
   valid and unique.

---

### Codes used in this walkthrough

| What | Code | Notes |
|---|---|---|
| New product barcode (step 1) | `8412345009990` | must not exist before you start |
| Unknown code (step 3) | `8412345007774` | matches nothing until you attach it |
| Shared accessory code (step 5) | `8412345008887` | you attach it to both protectors |
| iPhone 17 Pro Max barcode | `0194253172567` | seeded |
| Protector 15 Pro Max barcode | `8412345001567` | seeded, stock 12 |
| Protector 16 Pro Max barcode | `8412345001635` | seeded, stock 9 |
| New phone IMEIs (step 4) | `353474060000619` `353474060000791` `353474060000874` | seeded as *not* present |
| Already-in-stock IMEI (step 4 rejection) | `353474060000122` | seeded |
| In-stock IMEI to sell (step 6) | `353474060000205` | seeded |
