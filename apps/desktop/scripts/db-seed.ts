/**
 * Seed data (dev + demo) — docs/design/system-design.md §8.
 * Tenant "Arkom Demo", location "Tienda", terminal "Till 1" + ticket series "T1-";
 * 5 groups, ~29 products (4 serialized phone models with example IMEI units),
 * 2 suppliers, opening purchase_in movements so inventory is non-empty.
 *
 * Lives in apps/desktop (not packages/db): it needs @arkom/core for UUIDv7 and
 * §2's dependency rule keeps db importing only drizzle — apps compose packages.
 *
 * All writes go through core's mutate() envelope (§3/ADR-0005): one
 * transaction, an oplog "create" entry per business row, enforced by core.
 *
 * Group names follow the ES seed list in docs/design/handoff/00-foundations.md
 * (accented Spanish), which refines the shorthand list in system-design §8.
 */
import {
  ean13WithCheckDigit,
  imeiWithCheckDigit,
  mutate,
  toOplogJson,
  uuidv7,
  type MutationCtx,
} from "@arkom/core";
import { schema as s, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../src/main/mutate-runner";

/* ---------------------------- seed dataset ---------------------------- */

type ProductSpec = {
  name: string;
  group: string;
  itemType?: "stocked" | "serialized";
  costCents: number | null;
  priceCents: number | null;
  barcode?: string | null; // default: auto EAN-13; explicit null = missing (req 3.3 demo)
  taxed?: boolean; // default true → IVA21/2100; false = missing tax data (req 3.3 demo)
  reorderPoint?: number;
  lowStockThreshold?: number;
  openingQty?: number; // stocked only
};

const GROUPS = ["Móviles", "Protectores", "Cargadores y Cables", "Auriculares", "Memoria y Ordenador"] as const;

const SUPPLIERS = ["Distribuidora Madrid Móvil", "TecnoImport Levante"] as const;

// ~29 products across the groups (4 serialized phone models incl. example units w/ IMEIs).
// Two rows are deliberately incomplete so the catalog's missing-data flags (req 3.3)
// have something to show: one without barcode, one without cost/tax.
const PRODUCTS: ProductSpec[] = [
  // Móviles — serialized (2 example units each, seeded below)
  { name: "Samsung Galaxy A16 128GB Negro", group: "Móviles", itemType: "serialized", costCents: 13500, priceCents: 18900, reorderPoint: 2, lowStockThreshold: 1 },
  { name: "Xiaomi Redmi Note 13 256GB Azul", group: "Móviles", itemType: "serialized", costCents: 16500, priceCents: 22900, reorderPoint: 2, lowStockThreshold: 1 },
  { name: "Apple iPhone 13 128GB Medianoche", group: "Móviles", itemType: "serialized", costCents: 28900, priceCents: 38900, reorderPoint: 1, lowStockThreshold: 1 },
  // the phone the manual walkthrough receives and sells: real-looking box EAN, 5 units in stock
  { name: "Apple iPhone 17 Pro Max 256GB Negro", group: "Móviles", itemType: "serialized", costCents: 119900, priceCents: 149900, barcode: "0194253172567", reorderPoint: 2, lowStockThreshold: 1 },
  // Protectores
  { name: "Protector cristal templado iPhone 13", group: "Protectores", costCents: 180, priceCents: 990, openingQty: 24, reorderPoint: 6, lowStockThreshold: 3 },
  { name: "Protector cristal templado iPhone 15", group: "Protectores", costCents: 200, priceCents: 1090, openingQty: 18, reorderPoint: 6, lowStockThreshold: 3 },
  { name: "Protector cristal templado Galaxy A16", group: "Protectores", costCents: 170, priceCents: 990, openingQty: 20, reorderPoint: 6, lowStockThreshold: 3 },
  { name: "Protector cristal templado Redmi Note 13", group: "Protectores", costCents: 170, priceCents: 990, openingQty: 15, reorderPoint: 6, lowStockThreshold: 3 },
  { name: "Funda transparente iPhone 13", group: "Protectores", costCents: 250, priceCents: 1290, openingQty: 12, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Funda silicona Galaxy A16", group: "Protectores", costCents: 280, priceCents: 1290, openingQty: 10, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Funda libro Galaxy A16", group: "Protectores", costCents: 320, priceCents: 1490, openingQty: 5, reorderPoint: 3, lowStockThreshold: 2, barcode: null },
  // sibling accessories: each has its OWN box code, and the walkthrough gives them
  // a shared one on purpose — this is the everyday case the picker exists for
  { name: "Protector iPhone 15 Pro Max", group: "Protectores", costCents: 500, priceCents: 1490, barcode: "8412345001567", openingQty: 12, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Protector iPhone 16 Pro Max", group: "Protectores", costCents: 550, priceCents: 1590, barcode: "8412345001635", openingQty: 9, reorderPoint: 4, lowStockThreshold: 2 },
  // Cargadores y Cables
  { name: "Cargador 20W USB-C", group: "Cargadores y Cables", costCents: 480, priceCents: 1490, openingQty: 16, reorderPoint: 5, lowStockThreshold: 3 },
  { name: "Cargador 30W USB-C GaN", group: "Cargadores y Cables", costCents: 750, priceCents: 1990, openingQty: 8, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Cable USB-C a USB-C 1m", group: "Cargadores y Cables", costCents: 210, priceCents: 890, openingQty: 30, reorderPoint: 8, lowStockThreshold: 4 },
  { name: "Cable Lightning 1m", group: "Cargadores y Cables", costCents: 260, priceCents: 990, openingQty: 22, reorderPoint: 8, lowStockThreshold: 4 },
  { name: "Cable micro-USB 1m", group: "Cargadores y Cables", costCents: 120, priceCents: 590, openingQty: 14, reorderPoint: 5, lowStockThreshold: 3 },
  { name: "Cargador coche dual USB 24W", group: "Cargadores y Cables", costCents: 390, priceCents: 1290, openingQty: 9, reorderPoint: 3, lowStockThreshold: 2 },
  { name: "Base carga inalámbrica 15W", group: "Cargadores y Cables", costCents: 620, priceCents: 1890, openingQty: 6, reorderPoint: 2, lowStockThreshold: 1 },
  // Auriculares
  { name: "Auriculares TWS Bluetooth 5.3", group: "Auriculares", costCents: 850, priceCents: 2490, openingQty: 12, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Auriculares cable jack 3.5mm", group: "Auriculares", costCents: 220, priceCents: 890, openingQty: 20, reorderPoint: 6, lowStockThreshold: 3 },
  { name: "Auriculares diadema Bluetooth", group: "Auriculares", costCents: 1400, priceCents: 3490, openingQty: 5, reorderPoint: 2, lowStockThreshold: 1 },
  { name: "Manos libres USB-C", group: "Auriculares", costCents: 300, priceCents: 1190, openingQty: 10, reorderPoint: 4, lowStockThreshold: 2 },
  // Memoria y Ordenador
  { name: "Tarjeta microSD 64GB", group: "Memoria y Ordenador", costCents: 420, priceCents: 1190, openingQty: 15, reorderPoint: 5, lowStockThreshold: 3 },
  { name: "Tarjeta microSD 128GB", group: "Memoria y Ordenador", costCents: 780, priceCents: 1890, openingQty: 10, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Pendrive USB 3.0 64GB", group: "Memoria y Ordenador", costCents: 380, priceCents: 1090, openingQty: 12, reorderPoint: 4, lowStockThreshold: 2 },
  { name: "Ratón inalámbrico", group: "Memoria y Ordenador", costCents: 520, priceCents: 1490, openingQty: 7, reorderPoint: 3, lowStockThreshold: 2 },
  { name: "Hub USB-C 4 puertos", group: "Memoria y Ordenador", costCents: null, priceCents: 2190, taxed: false, reorderPoint: 2, lowStockThreshold: 1 },
];

// example units per serialized model (name → 14-digit IMEI bases; Luhn digit appended)
const UNIT_IMEI_BASES: Record<string, string[]> = {
  "Samsung Galaxy A16 128GB Negro": ["35693810442003", "35693810442011"],
  "Xiaomi Redmi Note 13 256GB Azul": ["86209104778120", "86209104778138"],
  "Apple iPhone 13 128GB Medianoche": ["35328711990245", "35328711990252"],
  // 5 identical phones — same model, colour and storage, told apart only by IMEI
  "Apple iPhone 17 Pro Max 256GB Negro": [
    "35347406000012",
    "35347406000020",
    "35347406000038",
    "35347406000046",
    "35347406000053",
  ],
};

/* ------------------------------- seeding ------------------------------- */

/** Ajustes seed — printer off (everything goes to PDF), shop data still owed. */
const SETTINGS_PLACEHOLDERS: Record<string, string> = {
  printerName: "",
  paperWidthMm: "80",
  commandSet: "epson",
  shopLegalName: "PENDIENTE — Razón social",
  shopNif: "PENDIENTE — NIF",
  shopAddress: "PENDIENTE — Dirección fiscal",
  ticketFooter: "Precios claros. Sin letra pequeña.",
};

export function seed(db: ArkomDb): { seeded: boolean; message: string } {
  const existing = db.select({ id: s.tenants.id }).from(s.tenants).limit(1).all();
  if (existing.length > 0) {
    return { seeded: false, message: "Database already seeded (tenants table is not empty) — nothing done." };
  }

  const now = new Date();
  const tenantId = uuidv7();
  const locationId = uuidv7();
  const terminalId = uuidv7();
  let unitCount = 0;

  const ctx: MutationCtx = { tenantId, locationId, terminalId, userId: null };
  mutate(makeMutateRunner(db), ctx, (tx, log) => {
    const logCreate = (entity: string, entityId: string, after: Record<string, unknown>) => {
      log({ entity, entityId, action: "create", before: null, after: toOplogJson(after) });
    };

    const tenant = { id: tenantId, name: "Arkom Demo", createdAt: now };
    tx.insert(s.tenants).values(tenant).run();
    logCreate("tenant", tenant.id, tenant);

    const location = { id: locationId, tenantId, name: "Tienda", createdAt: now };
    tx.insert(s.locations).values(location).run();
    logCreate("location", location.id, location);

    const terminal = { id: terminalId, tenantId, locationId, name: "Till 1", createdAt: now };
    tx.insert(s.terminals).values(terminal).run();
    logCreate("terminal", terminal.id, terminal);

    const series = {
      id: uuidv7(),
      tenantId,
      locationId,
      terminalId,
      docType: "ticket" as const,
      prefix: "T1-",
      nextNumber: 1,
    };
    tx.insert(s.numberSeries).values(series).run();
    logCreate("number_series", series.id, series);

    const groupIds = new Map<string, string>();
    GROUPS.forEach((name, i) => {
      const group = { id: uuidv7(), tenantId, name, sortOrder: i, createdAt: now };
      tx.insert(s.productGroups).values(group).run();
      logCreate("product_group", group.id, group);
      groupIds.set(name, group.id);
    });

    const supplierIds: string[] = [];
    for (const name of SUPPLIERS) {
      const supplier = { id: uuidv7(), tenantId, name, createdAt: now };
      tx.insert(s.suppliers).values(supplier).run();
      logCreate("supplier", supplier.id, supplier);
      supplierIds.push(supplier.id);
    }

    let barcodeSerial = 0;
    PRODUCTS.forEach((spec, idx) => {
      const productId = uuidv7();
      const taxed = spec.taxed !== false;
      // explicit barcode = a real box code · null = deliberately missing (req 3.3)
      // · undefined = internal code from our own series
      const barcode =
        spec.barcode === null
          ? null
          : (spec.barcode ?? ean13WithCheckDigit(`8437123${String(++barcodeSerial).padStart(5, "0")}`));
      const product = {
        id: productId,
        tenantId,
        name: spec.name,
        barcode,
        groupId: groupIds.get(spec.group)!,
        itemType: (spec.itemType ?? "stocked") as "stocked" | "serialized",
        costCents: spec.costCents,
        priceCents: spec.priceCents,
        taxRegime: taxed ? ("IVA21" as const) : null, // P1 = IVA21 only (ADR-0007)
        taxRateBp: taxed ? 2100 : null,
        reorderPoint: spec.reorderPoint ?? 0,
        lowStockThreshold: spec.lowStockThreshold ?? 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(s.products).values(product).run();
      logCreate("product", productId, product);

      const supplierId = supplierIds[idx % supplierIds.length]!;
      let onHand = 0;

      if (product.itemType === "serialized") {
        // one unit row + one +1 purchase_in movement per physical phone (ADR-0004)
        for (const base of UNIT_IMEI_BASES[spec.name] ?? []) {
          const unit = {
            id: uuidv7(),
            tenantId,
            locationId,
            productId,
            imei: imeiWithCheckDigit(base),
            status: "in_stock" as const,
            costCents: spec.costCents!,
            soldDocumentId: null,
            createdAt: now,
            updatedAt: now,
          };
          tx.insert(s.units).values(unit).run();
          logCreate("unit", unit.id, unit);
          unitCount += 1;

          const movement = {
            id: uuidv7(),
            tenantId,
            locationId,
            terminalId,
            productId,
            unitId: unit.id,
            movementType: "purchase_in" as const,
            qty: 1,
            unitCostCents: spec.costCents!,
            supplierId,
            documentId: null,
            documentLineId: null,
            reason: null,
            userId: null,
            createdAt: now,
          };
          tx.insert(s.stockMovements).values(movement).run();
          logCreate("stock_movement", movement.id, movement);
          onHand += 1;
        }
      } else if (spec.openingQty && spec.costCents != null) {
        const movement = {
          id: uuidv7(),
          tenantId,
          locationId,
          terminalId,
          productId,
          unitId: null,
          movementType: "purchase_in" as const,
          qty: spec.openingQty,
          unitCostCents: spec.costCents,
          supplierId,
          documentId: null,
          documentLineId: null,
          reason: null,
          userId: null,
          createdAt: now,
        };
        tx.insert(s.stockMovements).values(movement).run();
        logCreate("stock_movement", movement.id, movement);
        onHand = spec.openingQty;
      }

      // derived on-hand cache, same tx as the movements (ADR-0004); not oplogged (derivable)
      tx.insert(s.productStock).values({ productId, locationId, onHand, updatedAt: now }).run();
    });

    /* Ajustes defaults. The shop's real fiscal data is blocking for go-live but
       not for build (PRD open question 1), so the seed says PENDIENTE out loud:
       a test ticket then shows exactly which fields are still owed by the
       client, which no plausible-looking placeholder would. */
    for (const [key, value] of Object.entries(SETTINGS_PLACEHOLDERS)) {
      tx.insert(s.settings).values({ tenantId, key, value, updatedAt: now }).run();
      logCreate("setting", key, { key, value });
    }

    // single-row sync cursor (Phase 2 uses it)
    tx.insert(s.syncCursor).values({ id: 1, lastAckedSeq: 0, lastSyncAt: null }).run();
  });

  return {
    seeded: true,
    message: `Seeded: Arkom Demo / Tienda / Till 1 (T1-), ${GROUPS.length} groups, ${PRODUCTS.length} products, ${unitCount} IMEI units, ${SUPPLIERS.length} suppliers, opening stock, Ajustes placeholders + oplog.`,
  };
}
