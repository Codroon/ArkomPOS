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

Anywhere you type a code, press **Enter** to submit it (that is what a scanner does).

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

1. Go to **Inventario**. The **Entrada de stock** panel at the bottom is always
   visible — notice Cantidad and Coste are greyed out until you pick an item.
2. In the panel's search box type `8412345009990` and press **Enter**.

✅ The item resolves and its name appears with a "Cambiar artículo" link;
   Cantidad and Coste become editable.

3. **Cantidad:** `10` · **Coste por unidad:** `8,00`
4. Click **Añadir a la lista** → the line appears on the right.
5. Choose a **Proveedor** (e.g. *Distribuidora Madrid Móvil*).
6. Click **Confirmar entrada · 80,00 €**.

✅ Toast "Entrada registrada · 1 línea", the row flashes, and *Cargador rápido 65W*
   now shows **10** in the table.

7. Click that row to open **Movimientos** on the right.

✅ One line: **ENTRADA**, **+10**, cost 8,00 €, Documento "—" (no sale involved), Usuario "—".
   Press **Esc** to close.

---

## 3. A code the app doesn't know (the rescue)

This is the case that used to fail: you scan the box, nothing matches, dead end.

1. In the **Entrada de stock** search box type `8412345007774` and press **Enter**.

✅ A window appears: *"Código no encontrado — Ningún artículo responde a 8412345007774"*,
   offering **Crear artículo nuevo** and **Asignar a un artículo existente**.

2. Click **Asignar a un artículo existente**.
3. Search `Cargador rápido` and click it in the list.

✅ The window closes, the item is now resolved in the panel, and the code has been
   added to it as an additional code. You never left the panel.

4. **Cantidad:** `4` · **Coste por unidad:** `8,00` → **Añadir a la lista** →
   Proveedor → **Confirmar entrada**.

✅ *Cargador rápido 65W* now shows **14**.

5. (Optional check) Type `8412345007774` in the panel again → it resolves straight to
   the same product. The code now belongs to it permanently.

---

## 4. Receiving phones (IMEI one by one)

The seed already contains **Apple iPhone 17 Pro Max 256GB Negro** — barcode
`0194253172567` — with **5 units** in stock. We'll receive 3 more.

1. In the **Entrada de stock** box type the **barcode** `0194253172567` → Enter.

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

5. **Añadir a la lista** → Proveedor → **Confirmar entrada · 3.597,00 €**.

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

1. **Inventario** → in the entry box type `8412345008887` → Enter.

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

## 7. Final check

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
