# Arkom POS — manual walkthrough

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
What you are checking here is that the till behaves properly when printing
**fails**, because that is the case that must never cost you a sale.

### (a) Turn the printer off

Go to **11 Ajustes**. Under **Impresión**, set **Impresora** to
**Sin impresora**. Leave the paper at **80 mm** and the command set at
**Epson**. It saves as you go — there is no Save button and nothing to forget.

While you are there, look at **Datos de la tienda** below. All three fields say
`PENDIENTE`. That is on purpose: your shop's real registered name, NIF and
address still have to come from you, and until they do, every ticket prints the
word PENDIENTE where they belong so nobody can ship this by accident.

### (b) Sell something

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

Click **Guardar PDF**. The message turns dark and tells you where the file went:

```
Ticket guardado en C:\Users\<tú>\AppData\Roaming\@arkom\desktop\tickets\T1-00000X.pdf
```

Open that file. Check it against what you sold:

| On the PDF | Should be |
|---|---|
| Top | **ARKOM** in the heavy brand type, on a blue line. It is the only blue on the page. |
| Under it | The three `PENDIENTE` lines — your shop data, still owed. |
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

The installer lands in `apps/desktop/release/Arkom POS Setup 0.9.0.exe` (~94 MB).

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
| A backup exists | `%APPDATA%\Arkom POS\backups\` has a file, written when the app closed. |
| Uninstall | *Settings → Apps → Arkom POS → Uninstall*. The program goes; `%APPDATA%\Arkom POS\` and its database **stay**. |

### Where the data lives

Paste this into the Explorer address bar (`AppData` is hidden):

```
%APPDATA%\Arkom POS
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

## 12. Final check

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
