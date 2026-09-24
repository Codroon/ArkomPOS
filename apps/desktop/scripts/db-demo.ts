/**
 * `pnpm db:demo` — fill a DEV till with enough of a shop to test against.
 *
 * Everything here goes through the SAME repo functions the screens call, so
 * every row lands in the oplog and syncs to the cloud by itself. A script that
 * wrote rows straight into SQLite would produce a till whose database looks
 * right and whose cloud is empty — which is exactly the bug this data exists to
 * hunt for.
 *
 * It is additive and idempotent-ish: run it twice and you get two batches of
 * products with different barcodes. It never deletes anything.
 *
 * NOT for a packaged build. A client install has no terminal and no demo step.
 */
import { imeiWithCheckDigit, type MutationCtx } from "@arkom/core";
import { schema as s, type ArkomDb } from "@arkom/db";
import { eq } from "drizzle-orm";
import { saveProduct, listGroups } from "../src/main/repos/catalog";
import { addStock } from "../src/main/repos/inventory";
import { logPurchase } from "../src/main/repos/used";
import {
  addLine,
  createTicket,
  markReady,
  recordApproval,
  upsertCustomer,
} from "../src/main/repos/repair";
import { logSend } from "../src/main/repos/transfer";
import { openShift, openShiftTx } from "../src/main/repos/shift";
import { listSuppliers, createSupplier } from "../src/main/repos/suppliers";

/* ----------------------------------------------------------- the catalogue */

interface Item {
  name: string;
  group: string;
  costCents: number;
  priceCents: number;
  qty: number;
}

/** Realistic stock for a Spanish phone shop, spread across every shelf. */
const CATALOGUE: Item[] = [
  // Móviles
  { name: "Samsung Galaxy A16 128GB Negro", group: "Móviles", costCents: 14500, priceCents: 19900, qty: 4 },
  { name: "Samsung Galaxy A35 256GB Azul", group: "Móviles", costCents: 24500, priceCents: 32900, qty: 3 },
  { name: "Xiaomi Redmi Note 14 256GB", group: "Móviles", costCents: 17500, priceCents: 24900, qty: 5 },
  { name: "Xiaomi Redmi 14C 128GB", group: "Móviles", costCents: 9500, priceCents: 13900, qty: 6 },
  { name: "Motorola Moto G85 256GB", group: "Móviles", costCents: 19500, priceCents: 26900, qty: 2 },
  { name: "Nokia 110 4G", group: "Móviles", costCents: 2200, priceCents: 3900, qty: 8 },
  { name: "Samsung Galaxy A06 64GB", group: "Móviles", costCents: 8500, priceCents: 12900, qty: 5 },
  { name: "Honor X8b 256GB", group: "Móviles", costCents: 16500, priceCents: 22900, qty: 2 },

  // Protectores
  { name: "Cristal templado iPhone 15", group: "Protectores", costCents: 120, priceCents: 990, qty: 40 },
  { name: "Cristal templado iPhone 14", group: "Protectores", costCents: 120, priceCents: 990, qty: 35 },
  { name: "Cristal templado Samsung A55", group: "Protectores", costCents: 120, priceCents: 990, qty: 30 },
  { name: "Cristal templado Xiaomi Redmi 13", group: "Protectores", costCents: 110, priceCents: 890, qty: 25 },
  { name: "Protector cámara iPhone 15 Pro", group: "Protectores", costCents: 150, priceCents: 1290, qty: 18 },
  { name: "Protector privacidad iPhone 13", group: "Protectores", costCents: 260, priceCents: 1690, qty: 12 },

  // Fundas y carcasas
  { name: "Funda silicona iPhone 15 Negra", group: "Fundas y carcasas", costCents: 180, priceCents: 1290, qty: 22 },
  { name: "Funda silicona iPhone 14 Azul", group: "Fundas y carcasas", costCents: 180, priceCents: 1290, qty: 18 },
  { name: "Funda libro Samsung A55", group: "Fundas y carcasas", costCents: 320, priceCents: 1990, qty: 14 },
  { name: "Funda antigolpes Xiaomi Redmi 14", group: "Fundas y carcasas", costCents: 240, priceCents: 1590, qty: 16 },
  { name: "Funda transparente Samsung A16", group: "Fundas y carcasas", costCents: 150, priceCents: 990, qty: 28 },
  { name: "Funda con anilla iPhone 13", group: "Fundas y carcasas", costCents: 260, priceCents: 1690, qty: 10 },

  // Cargadores y Cables
  { name: "Cable USB-C a USB-C 1m", group: "Cargadores y Cables", costCents: 190, priceCents: 899, qty: 45 },
  { name: "Cable Lightning 1m MFi", group: "Cargadores y Cables", costCents: 420, priceCents: 1490, qty: 30 },
  { name: "Cable USB-C a Lightning 2m", group: "Cargadores y Cables", costCents: 480, priceCents: 1790, qty: 20 },
  { name: "Cargador 20W USB-C", group: "Cargadores y Cables", costCents: 520, priceCents: 1590, qty: 26 },
  { name: "Cargador 65W GaN 2 puertos", group: "Cargadores y Cables", costCents: 1250, priceCents: 2990, qty: 12 },
  { name: "Cargador coche 30W", group: "Cargadores y Cables", costCents: 480, priceCents: 1490, qty: 15 },
  { name: "Adaptador USB-C a jack 3.5", group: "Cargadores y Cables", costCents: 140, priceCents: 690, qty: 30 },

  // Baterías externas
  { name: "Power bank 10000mAh", group: "Baterías externas", costCents: 890, priceCents: 1990, qty: 14 },
  { name: "Power bank 20000mAh PD", group: "Baterías externas", costCents: 1650, priceCents: 3490, qty: 8 },
  { name: "Power bank MagSafe 5000mAh", group: "Baterías externas", costCents: 1450, priceCents: 2990, qty: 6 },

  // Auriculares
  { name: "Auriculares TWS básicos", group: "Auriculares", costCents: 690, priceCents: 1790, qty: 20 },
  { name: "Auriculares TWS con cancelación", group: "Auriculares", costCents: 1890, priceCents: 3990, qty: 9 },
  { name: "Auriculares cable USB-C", group: "Auriculares", costCents: 320, priceCents: 990, qty: 24 },
  { name: "Auriculares deportivos Bluetooth", group: "Auriculares", costCents: 1150, priceCents: 2490, qty: 7 },

  // Altavoces
  { name: "Altavoz Bluetooth 10W", group: "Altavoces", costCents: 1250, priceCents: 2690, qty: 8 },
  { name: "Altavoz Bluetooth resistente agua", group: "Altavoces", costCents: 1890, priceCents: 3990, qty: 5 },

  // Relojes y wearables
  { name: "Smartwatch básico", group: "Relojes y wearables", costCents: 1890, priceCents: 3990, qty: 6 },
  { name: "Correa silicona 22mm", group: "Relojes y wearables", costCents: 190, priceCents: 990, qty: 18 },
  { name: "Pulsera actividad", group: "Relojes y wearables", costCents: 1290, priceCents: 2790, qty: 7 },

  // Memoria y Ordenador
  { name: "MicroSD 64GB", group: "Memoria y Ordenador", costCents: 420, priceCents: 1190, qty: 22 },
  { name: "MicroSD 128GB", group: "Memoria y Ordenador", costCents: 720, priceCents: 1790, qty: 16 },
  { name: "Pendrive USB 64GB", group: "Memoria y Ordenador", costCents: 390, priceCents: 1090, qty: 14 },
  { name: "Hub USB-C 4 puertos", group: "Memoria y Ordenador", costCents: 890, priceCents: 2190, qty: 8 },

  // Accesorios de foto y vídeo
  { name: "Trípode móvil 1m", group: "Accesorios de foto y vídeo", costCents: 690, priceCents: 1690, qty: 9 },
  { name: "Aro de luz 26cm", group: "Accesorios de foto y vídeo", costCents: 1190, priceCents: 2690, qty: 5 },
  { name: "Soporte coche ventilación", group: "Accesorios de foto y vídeo", costCents: 390, priceCents: 1190, qty: 12 },

  // Repuestos
  { name: "Pantalla iPhone 12 compatible", group: "Repuestos", costCents: 3900, priceCents: 8900, qty: 4 },
  { name: "Pantalla Samsung A52 compatible", group: "Repuestos", costCents: 3200, priceCents: 7900, qty: 3 },
  { name: "Batería iPhone 11", group: "Repuestos", costCents: 1200, priceCents: 3900, qty: 6 },
  { name: "Batería Samsung A33", group: "Repuestos", costCents: 1100, priceCents: 3500, qty: 5 },
  { name: "Conector de carga iPhone 13", group: "Repuestos", costCents: 850, priceCents: 2900, qty: 8 },
  { name: "Conector de carga tipo C genérico", group: "Repuestos", costCents: 450, priceCents: 1900, qty: 10 },
  { name: "Altavoz auricular iPhone 12", group: "Repuestos", costCents: 600, priceCents: 2200, qty: 6 },
];

/* --------------------------------------------------------- used devices -- */

const USED: Array<{
  brand: string;
  model: string;
  storage: string;
  color: string;
  grade: "A" | "B" | "C";
  battery: number;
  buy: number;
}> = [
  { brand: "Apple", model: "iPhone 12", storage: "128GB", color: "Negro", grade: "B", battery: 84, buy: 18000 },
  { brand: "Apple", model: "iPhone 13", storage: "128GB", color: "Azul", grade: "A", battery: 91, buy: 26000 },
  { brand: "Apple", model: "iPhone 11", storage: "64GB", color: "Blanco", grade: "C", battery: 78, buy: 12000 },
  { brand: "Samsung", model: "Galaxy S21", storage: "128GB", color: "Gris", grade: "B", battery: 86, buy: 14000 },
  { brand: "Samsung", model: "Galaxy A53", storage: "128GB", color: "Negro", grade: "B", battery: 88, buy: 9500 },
  { brand: "Xiaomi", model: "Redmi Note 11", storage: "128GB", color: "Azul", grade: "C", battery: 80, buy: 7000 },
  { brand: "Apple", model: "iPhone SE 2020", storage: "64GB", color: "Negro", grade: "C", battery: 76, buy: 8000 },
  { brand: "Samsung", model: "Galaxy A14", storage: "64GB", color: "Verde", grade: "A", battery: 95, buy: 8500 },
  { brand: "Google", model: "Pixel 6a", storage: "128GB", color: "Negro", grade: "B", battery: 83, buy: 13000 },
  { brand: "Apple", model: "iPhone XR", storage: "64GB", color: "Rojo", grade: "C", battery: 74, buy: 9000 },
];

/* -------------------------------------------------------------- repairs -- */

const FAULTS = [
  "Pantalla rota, táctil funciona",
  "No carga, conector sucio",
  "Batería dura poco",
  "Altavoz de llamada no se oye",
  "Cámara trasera borrosa",
  "Mojado, no enciende",
  "Botón de encendido atascado",
  "No hace red, sin cobertura",
];

const DEVICES = [
  "iPhone 12 negro", "iPhone 13 azul", "Samsung A52 blanco", "Xiaomi Redmi 10",
  "iPhone 11 rojo", "Samsung S21 gris", "Motorola G54", "Huawei P30 lite",
  "iPhone SE negro", "Samsung A14 verde", "Xiaomi Note 12", "Realme C55",
];

const CUSTOMERS = [
  ["Marta Ruiz", "600111222"], ["José Ferrer", "611222333"], ["Nadia El Amrani", "622333444"],
  ["Carlos Pérez", "633444555"], ["Lucía Gómez", "644555666"], ["Ahmed Tahiri", "655666777"],
  ["Elena Navarro", "666777888"], ["Pablo Serra", "677888999"], ["Fatima Zahra", "688999000"],
  ["David Ortega", "699000111"],
];

/** Deterministic pseudo-random, so two runs of the script differ predictably. */
function roller(seed: number) {
  let value = seed;
  return (max: number) => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value % max;
  };
}

/** A valid IMEI that will not collide with a previous run. */
const imeiFrom = (n: number) => imeiWithCheckDigit(String(35000000000000 + n).slice(0, 14));

export interface DemoResult {
  products: number;
  units: number;
  used: number;
  repairs: number;
  transfers: number;
  message: string;
}

export async function insertDemo(db: ArkomDb, ctx: MutationCtx): Promise<DemoResult> {
  const roll = roller(Date.now() & 0xffff);
  const stamp = Date.now() % 100000;

  /* Money and stock both want an open shift; receiving stock does not, but a
     repair with a deposit and a transfer do (CLAUDE.md). Open one if the till
     has none, and leave it open — closing it would produce a Z the shop did not
     ask for. */
  if (!openShift(db, ctx)) openShiftTx(db, ctx, { floatCents: 20000, breakdown: null });

  /* ---- a supplier to receive against ---- */
  const suppliers = listSuppliers(db, ctx);
  const supplierId = suppliers[0]?.id ?? createSupplier(db, ctx, "Distribuidora Levante").id;

  /* ---- the catalogue ---- */
  const groups = listGroups(db, ctx);
  const groupId = (name: string) =>
    groups.find((g) => g.name === name)?.id ?? groups[0]?.id ?? "";

  let products = 0;
  let units = 0;
  const created: Array<{ id: string; qty: number; costCents: number }> = [];

  /* names are unique per shop, so a second run adds only what is missing
     rather than failing halfway and leaving the repairs unseeded */
  const existing = new Set(
    db
      .select({ name: s.products.name })
      .from(s.products)
      .where(eq(s.products.tenantId, ctx.tenantId))
      .all()
      .map((row) => row.name.toLowerCase()),
  );

  for (const [index, item] of CATALOGUE.entries()) {
    if (existing.has(item.name.toLowerCase())) continue;
    const saved = saveProduct(db, ctx, {
      id: null,
      name: item.name,
      /* a barcode unique to this run, so re-running adds rather than warns */
      barcode: `20${String(stamp).padStart(5, "0")}${String(index).padStart(5, "0")}`,
      groupId: groupId(item.group),
      itemType: "stocked",
      costCents: item.costCents,
      priceCents: item.priceCents,
      taxRegime: "IVA21",
      reorderPoint: 2,
      lowStockThreshold: 2,
      confirmed: true,
    } as Parameters<typeof saveProduct>[2]);

    if (saved.kind !== "saved") continue;
    products += 1;
    created.push({ id: saved.product.id, qty: item.qty, costCents: item.costCents });
  }

  if (created.length === 0) console.log("  catalogue already present — skipping to the rest");

  /* ---- stock, in a few deliveries rather than one giant one ---- */
  for (let batch = 0; batch < created.length; batch += 10) {
    const slice = created.slice(batch, batch + 10);
    addStock(db, ctx, {
      /* the supplier rides on each entry, not on the delivery: one receiving
         session can legitimately cover two suppliers */
      entries: slice.map((row) => ({
        supplierId,
        productId: row.id,
        qty: row.qty,
        unitCostCents: row.costCents,
      })),
    });
    units += slice.reduce((sum, row) => sum + row.qty, 0);
  }

  /* ---- used devices ---- */
  let used = 0;
  for (const [index, device] of USED.entries()) {
    try {
      await logPurchase(db, ctx, {
        device: {
          brand: device.brand,
          model: device.model,
          storage: device.storage,
          color: device.color,
          grade: device.grade,
          batteryPct: device.battery,
          imei: imeiFrom(stamp * 100 + index),
          accessories: { charger: index % 2 === 0, box: index % 3 === 0, cable: true, case: false },
        },
        seller: {
          name: CUSTOMERS[index % CUSTOMERS.length]![0]!,
          phone: CUSTOMERS[index % CUSTOMERS.length]![1]!,
          idType: "DNI",
          idNumber: `${10000000 + index}Z`,
          channel: "private_individual",
        },
        photos: [],
        buyPriceCents: device.buy,
        payout: index % 3 === 0 ? "store_credit" : "cash",
        payoutReference: null,
        barcode: null,
        /* the cashier's physical-check box: main refuses the purchase without
           it, and a seeder that skipped it would be testing a path no shop uses */
        gateConfirmed: true,
        /* most go straight on the shelf; every third is held, which is what the
           holding report exists to show */
        ...(index % 3 === 0
          ? { action: "hold" as const }
          : { action: "inventory" as const, sellPriceCents: Math.round(device.buy * 1.6) }),
      });
      used += 1;
    } catch (err) {
      console.warn(`  used device skipped (${device.model}): ${(err as Error).message}`);
    }
  }

  /* ---- repair tickets, across every state a workshop actually holds ---- */
  let repairs = 0;
  let ready = 0;
  for (let index = 0; index < 34; index += 1) {
    const [name, phone] = CUSTOMERS[index % CUSTOMERS.length]!;
    try {
      const customer = upsertCustomer(db, ctx, { name: name!, phone: phone! });
      const ticket = await createTicket(db, ctx, {
        customerId: customer.id,
        deviceDescription: DEVICES[index % DEVICES.length]!,
        imei: index % 3 === 0 ? imeiFrom(stamp * 1000 + index) : null,
        reportedFault: FAULTS[index % FAULTS.length]!,
        conditionAtIntake: null,
        damage: {
          screen: index % 4 === 0,
          back: index % 7 === 0,
          dents: index % 5 === 0,
          water: index % 11 === 0,
        },
        accessories: index % 4 === 0 ? "Funda y cargador" : null,
        photos: [],
        depositCents: index % 5 === 0 ? 2000 : 0,
        ...(index % 5 === 0 ? { depositMethod: "cash" as const } : {}),
      });

      repairs += 1;

      /* about two thirds get quoted; of those, some are finished and some are
         still on the bench — which is what a real board looks like */
      const stage = roll(3);
      if (stage >= 1) {
        addLine(db, ctx, {
          ticketId: ticket.ticketId,
          kind: "labor",
          description: "Mano de obra",
          chargeCents: 2000 + roll(4) * 500,
        });
      }
      if (stage === 2) {
        /* A quoted repair cannot be marked ready until the customer has agreed
           to the amount (ADR-0014): the till refuses, correctly. Record the
           approval the counter would have taken, then finish it. */
        recordApproval(db, ctx, ticket.ticketId, index % 2 === 0 ? "in_person" : "by_phone");
        markReady(db, ctx, ticket.ticketId);
        ready += 1;
      }
    } catch (err) {
      /* the TICKET is already written by this point; only the extra step
         failed, so say that rather than claiming the repair was skipped */
      console.warn(`  repair #${index} created, later step failed: ${(err as Error).message}`);
    }
  }

  /* ---- transfers: the Western Union counter ---- */
  let transfers = 0;
  for (let index = 0; index < 8; index += 1) {
    try {
      logSend(db, ctx, {
        mtcn: String(1000000000 + stamp + index),
        senderName: CUSTOMERS[index % CUSTOMERS.length]![0]!,
        receiverName: ["Amina B.", "Luis M.", "Sory D.", "Ana P."][index % 4]!,
        countryCode: ["MA", "CO", "SN", "EC"][index % 4]!,
        principalCents: 10000 + roll(40) * 1000,
        feeCents: 500 + roll(10) * 100,
        method: index % 2 === 0 ? "cash" : "card",
      });
      transfers += 1;
    } catch (err) {
      console.warn(`  transfer skipped (#${index}): ${(err as Error).message}`);
    }
  }

  return {
    products,
    units,
    used,
    repairs,
    transfers,
    message:
      `Demo data added: ${products} products (${units} units in stock), ` +
      `${used} used devices, ${repairs} repair tickets (${ready} ready to collect), ` +
      `${transfers} transfers. ` +
      `Every row went through mutate(), so it will sync on the next push.`,
  };
}
