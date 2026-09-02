/**
 * Arkom POS — Schema v1 (till side, SQLite).
 * Authority: docs/adr/. Money = integer cents (ADR-0006). IDs = UUIDv7 strings,
 * generated in @arkom/core (ADR-0006). Every business row carries tenancy keys
 * (ADR-0009). Postgres mirror for the cloud is generated from these same shapes
 * in Phase 2 — do not fork column names.
 *
 * Phase 1 note: some product columns are nullable ON PURPOSE (migrated rows may
 * arrive incomplete, req 3.3 flags them). Completeness is enforced at the domain
 * layer on every save (req 4.1) — never "fixed" by tightening the DB.
 */
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

/* ---------------- enums: single source of truth ---------------- */
export const ITEM_TYPES = ["stocked", "serialized", "used_device", "service", "repair", "agency", "sim", "topup"] as const;
export const TAX_REGIMES = ["IVA21", "IVA10", "IVA4", "REBU", "EXEMPT"] as const; // P1 uses IVA21 (ADR-0007)
export const MOVEMENT_TYPES = ["purchase_in", "sale_out", "adjustment", "count_post", "repair_part_out", "tradein_in", "return_in", "transfer"] as const; // P1: first three
/* "purchase" = used-device intake, own series (ADR-0013). "shift" numbers nothing in this
   table — it exists so the Z report borrows ADR-0008's series machinery instead of growing a
   second counter that can produce gaps (ADR-0015 §2). */
export const DOC_TYPES = ["ticket", "invoice", "credit_note", "purchase", "repair", "shift"] as const;
export const DOC_STATUSES = ["draft", "parked", "completed"] as const;
export const LINE_TYPES = ["product", "serialized_unit", "repair", "tradein_credit", "agency", "sim", "topup"] as const; // P1: product, serialized_unit
export const TENDER_METHODS = ["cash", "card", "bizum", "transfer", "store_credit", "deposit"] as const; // P1: all but store_credit
/* "held" = bought but NOT in stock: a unit row with no stock movement, so on-hand
   is 0 and the Sale screen never offers it (ADR-0013 §1). */
export const UNIT_STATUSES = ["in_stock", "reserved", "sold", "held"] as const;

/* ---------------- used devices (ADR-0013) ---------------- */
export const DEVICE_GRADES = ["A", "B", "C"] as const;
export const ID_DOC_TYPES = ["DNI", "NIE", "PASAPORTE"] as const;
/** Decides the resale tax regime months later: private ⇒ REBU (ADR-0007). */
export const ACQUISITION_CHANNELS = ["private_individual", "business"] as const;
export const PAYOUT_METHODS = ["cash", "transfer", "store_credit"] as const;
/**
 * How a repair deposit was taken, and how it is given back.
 *
 * The sale's tender list minus store credit: a voucher is money the shop already
 * owes, and holding a deposit "in credit" would be owing the same money twice.
 * Only `cash` reaches the drawer (ADR-0015 §5) — the rest are recorded so the Z
 * can report them by method and the shop can tick them off a bank statement.
 */
export const DEPOSIT_METHODS = ["cash", "card", "bizum", "transfer"] as const;
export const PHOTO_KINDS = ["front", "back", "extra", "seller_id"] as const;
export const VOUCHER_STATUSES = ["issued", "redeemed", "void"] as const;

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });

/* ---------------- identity & structure ---------------- */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const terminals = sqliteTable("terminals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(), // "Till 1"
  createdAt: ts("created_at").notNull(),
});

/* ---------------- catalog ---------------- */
export const productGroups = sqliteTable("product_groups", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), // Moviles, Protector, Cargador y Cable, Auriculares, Memoria y Ordenador
  sortOrder: integer("sort_order").notNull().default(0),
  /* sample data from first-run "Load demo data", removable until real selling
     starts. Only the three tables that OWN demo rows carry the flag — units,
     movements and codes are reachable from their product. */
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: ts("created_at").notNull(),
}, (t) => [uniqueIndex("ux_group_tenant_name").on(t.tenantId, t.name)]);

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: ts("created_at").notNull(),
}, (t) => [uniqueIndex("ux_supplier_tenant_name").on(t.tenantId, t.name)]);

export const products = sqliteTable("products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  barcode: text("barcode"), // scanner or auto-generated; nullable => flagged (req 3.3)
  groupId: text("group_id").references(() => productGroups.id), // nullable => flagged
  itemType: text("item_type", { enum: ITEM_TYPES }).notNull().default("stocked"),
  costCents: integer("cost_cents"), // nullable => flagged; required on save (req 4.1)
  priceCents: integer("price_cents"), // nullable => flagged; required on save
  taxRegime: text("tax_regime", { enum: TAX_REGIMES }), // nullable => flagged; required on save
  taxRateBp: integer("tax_rate_bp"), // 2100 etc.; set with regime
  reorderPoint: integer("reorder_point").notNull().default(0),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_product_tenant_name").on(t.tenantId, t.name),   // req 4.4 (name stays unique)
  // NOT unique: a real box EAN can legitimately sit on several variants, and the
  // shop resolves the ambiguity at scan time (PRD 4.4 amended — warn & confirm).
  index("ix_product_tenant_barcode").on(t.tenantId, t.barcode),
  index("ix_product_group").on(t.groupId),
]);

/**
 * Additional scannable codes per product. `products.barcode` remains the primary
 * code (the one printed on the label we generate); these are extra codes the same
 * item answers to — the manufacturer EAN, a wholesaler's code, an old SKU.
 */
export const productCodes = sqliteTable("product_codes", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  productId: text("product_id").notNull().references(() => products.id),
  code: text("code").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [
  // the same product may not hold one code twice; different products may share it
  uniqueIndex("ux_product_code_product_code").on(t.tenantId, t.productId, t.code),
  index("ix_product_code_tenant_code").on(t.tenantId, t.code),
]);

/* serialized stock: one row per physical phone (ADR-0004) */
export const units = sqliteTable("units", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  productId: text("product_id").notNull().references(() => products.id),
  imei: text("imei").notNull(),
  status: text("status", { enum: UNIT_STATUSES }).notNull().default("in_stock"),
  costCents: integer("cost_cents").notNull(),
  /* ---- used devices (ADR-0013); all nullable, so every pre-v0.11 row is valid ---- */
  /** the intake this unit came from; NULL for new stock bought from a supplier */
  purchaseId: text("purchase_id"),
  /** per-unit selling price. NULL = inherit the product's price, which is every
      existing row — used phones are priced individually. */
  salePriceCents: integer("sale_price_cents"),
  grade: text("grade", { enum: DEVICE_GRADES }),
  batteryPct: integer("battery_pct"),
  soldDocumentId: text("sold_document_id"), // set on sale; FK soft by convention (documents defined below)
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_unit_tenant_imei").on(t.tenantId, t.imei),
  index("ix_unit_product_status").on(t.productId, t.status),
]);

/* ---------------- stock ledger (ADR-0004) ---------------- */
export const stockMovements = sqliteTable("stock_movements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  productId: text("product_id").notNull().references(() => products.id),
  unitId: text("unit_id").references(() => units.id), // serialized moves
  movementType: text("movement_type", { enum: MOVEMENT_TYPES }).notNull(),
  qty: integer("qty").notNull(), // signed: +in / -out; sign validated against type in core
  unitCostCents: integer("unit_cost_cents"), // required for purchase_in (core enforces)
  supplierId: text("supplier_id").references(() => suppliers.id),
  documentId: text("document_id"),      // sale that caused it, if any
  documentLineId: text("document_line_id"),
  reason: text("reason"),               // required for adjustment (core enforces)
  userId: text("user_id"),              // nullable until auth (ADR-0010)
  createdAt: ts("created_at").notNull(),
}, (t) => [
  index("ix_move_product_created").on(t.productId, t.createdAt),
  index("ix_move_document").on(t.documentId),
]);

/* derived on-hand cache, updated in the same tx as the movement (ADR-0004) */
export const productStock = sqliteTable("product_stock", {
  productId: text("product_id").notNull().references(() => products.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  onHand: integer("on_hand").notNull().default(0), // CHECK >= 0 added in migration SQL
  updatedAt: ts("updated_at").notNull(),
}, (t) => [uniqueIndex("pk_product_stock").on(t.productId, t.locationId)]);

/* ---------------- documents & numbering (ADR-0007/0008) ---------------- */
export const numberSeries = sqliteTable("number_series", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  docType: text("doc_type", { enum: DOC_TYPES }).notNull(),
  prefix: text("prefix").notNull(),          // "T1-"
  nextNumber: integer("next_number").notNull().default(1),
}, (t) => [uniqueIndex("ux_series_terminal_doctype").on(t.terminalId, t.docType)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  docType: text("doc_type", { enum: DOC_TYPES }).notNull().default("ticket"),
  status: text("status", { enum: DOC_STATUSES }).notNull().default("draft"),
  seriesId: text("series_id").references(() => numberSeries.id), // set at completion
  number: integer("number"),                                      // set at completion
  docNumber: text("doc_number"),                                  // "T1-000123", set at completion
  parkedLabel: text("parked_label"),                              // req 2.8 park sale
  subtotalCents: integer("subtotal_cents").notNull().default(0),
  taxCents: integer("tax_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull().default(0),
  shiftId: text("shift_id"),   // nullable until shifts (ADR-0010)
  userId: text("user_id"),     // nullable until auth (ADR-0010)
  fiscalHash: text("fiscal_hash"),           // reserved (ADR-0007)
  prevFiscalHash: text("prev_fiscal_hash"),  // reserved
  fiscalStatus: text("fiscal_status"),       // reserved
  createdAt: ts("created_at").notNull(),
  completedAt: ts("completed_at"),
}, (t) => [
  uniqueIndex("ux_doc_series_number").on(t.seriesId, t.number), // gap-free per series
  index("ix_doc_status_created").on(t.status, t.createdAt),
  /* every report's hot path: completed documents in a window, dated by when the
     money moved rather than when someone started typing (ADR-0016 §1) */
  index("ix_doc_status_completed").on(t.status, t.completedAt),
]);

export const documentLines = sqliteTable("document_lines", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  lineNo: integer("line_no").notNull(),
  lineType: text("line_type", { enum: LINE_TYPES }).notNull().default("product"),
  productId: text("product_id").references(() => products.id),
  unitId: text("unit_id").references(() => units.id),
  description: text("description").notNull(), // snapshot of product name (ADR-0007 spirit)
  qty: integer("qty").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  priceOverridden: integer("price_overridden", { mode: "boolean" }).notNull().default(false),
  overrideReason: text("override_reason"),    // required when overridden (req 2.4, core enforces)
  taxRegime: text("tax_regime", { enum: TAX_REGIMES }).notNull(), // frozen snapshot (ADR-0007)
  taxRateBp: integer("tax_rate_bp").notNull(),
  baseCents: integer("base_cents").notNull(),
  taxCents: integer("tax_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  /**
   * What this line COST the shop, frozen at the moment of sale (ADR-0016 §2).
   *
   * The same reasoning ADR-0007 applied to tax. Joining `products.cost_cents` at
   * report time would make last month's margin move every time the shop receives
   * a delivery at a different price.
   *
   * PER UNIT, mirroring `unit_price_cents` beside it: the line's cost is
   * `unit_cost_cents × qty`, exactly as its revenue is `unit_price_cents × qty`.
   * Storing the extended figure instead would have to be re-derived every time
   * the stepper changes the quantity, and a division is a lossy way to recover a
   * number that was never lost.
   *
   * NULLABLE ON PURPOSE: NULL means "written before v0.14.0", and reports fall
   * back to the product's current cost flagged as an estimate. `NOT NULL DEFAULT
   * 0` would report every historical sale as pure profit — a plausible wrong
   * number, which is worse than an admitted gap. Nothing is backfilled.
   */
  unitCostCents: integer("unit_cost_cents"),
  createdAt: ts("created_at").notNull(),
}, (t) => [
  uniqueIndex("ux_line_doc_no").on(t.documentId, t.lineNo),
  index("ix_line_product").on(t.productId),
  index("ix_line_doc").on(t.documentId), // the reports join lines per document
]);

export const documentTenders = sqliteTable("document_tenders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  documentId: text("document_id").notNull().references(() => documents.id),
  method: text("method", { enum: TENDER_METHODS }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  cardReference: text("card_reference"), // standalone-terminal ref typed in (P1 card mode)
  createdAt: ts("created_at").notNull(),
}, (t) => [index("ix_tender_document").on(t.documentId)]);

/* ---------------- oplog: sync outbox + audit log (ADR-0005) ---------------- */
export const oplog = sqliteTable("oplog", {
  seq: integer("seq").primaryKey({ autoIncrement: true }), // local monotonic cursor
  opId: text("op_id").notNull(),                           // UUIDv7, idempotency key in cloud
  tenantId: text("tenant_id").notNull(),
  locationId: text("location_id").notNull(),
  terminalId: text("terminal_id").notNull(),
  entity: text("entity").notNull(),        // "product" | "document" | "stock_movement" | ...
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),        // "create" | "update" | "complete" | "park" | ...
  before: text("before", { mode: "json" }),
  after: text("after", { mode: "json" }),
  userId: text("user_id"),                 // NULL = pre-auth (ADR-0010/0012)
  /** set only when an action needed a second person's PIN (ADR-0012 §5) */
  authorizedByUserId: text("authorized_by_user_id"),
  createdAt: ts("created_at").notNull(),
}, (t) => [
  uniqueIndex("ux_oplog_opid").on(t.opId),
  index("ix_oplog_entity").on(t.entity, t.entityId),
]);

/* single-row sync cursor: highest seq acked by the cloud (Phase 2 uses it) */
export const syncCursor = sqliteTable("sync_cursor", {
  id: integer("id").primaryKey(), // always 1
  lastAckedSeq: integer("last_acked_seq").notNull().default(0),
  lastSyncAt: ts("last_sync_at"),
});

/* ---------------- settings: a per-tenant KV store (Ajustes) ----------------
 * Deliberately schemaless-in-a-column: Phase 1 needs the printer target and the
 * shop's legal block, Phase 2 will want fiscal region and sync endpoints, and
 * none of that is worth a migration each. Values are strings; the typed shape
 * lives in the IPC contract, which is where the renderer reads it anyway.
 * Changes are oplog'd like any other write (entity "setting", id = the key). */
export const settings = sqliteTable("settings", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);

/* ---------------- users: local PIN credentials (ADR-0012) ----------------
 * The till's ONLY authority. Phase 2 Supabase identities stay separate and are
 * joined later by a nullable cloud_user_id — a link, never a merge: the till
 * must authenticate with the router unplugged.
 *
 * `role` is text with NO check constraint on purpose. Adding a role (Technician,
 * when repairs land) must be one edit to the permission registry in core, not a
 * migration. Zod validates it in code, where it can be tested.
 *
 * Users are DEACTIVATED, never deleted — documents and oplog rows point here. */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  name: text("name").notNull(),
  role: text("role").notNull(),                    // "owner" | "cashier" | … (Zod, not CHECK)
  /**
   * Self-describing hash: `scrypt$…` or `$argon2id$…`.
   *
   * NULLABLE since v0.14.1. A technician is a name a repair can be assigned to,
   * not somebody who signs in: they have no PIN, and **a row with no PIN can
   * never log in** — the login list is filtered in main, not merely hidden in
   * the renderer. Giving one a PIN later turns them into an ordinary login user
   * with no other change, which is the shop-#2 path (ADR-0012 amendment).
   */
  pinHash: text("pin_hash"),
  /** JSON map of permission key → boolean, layered over the role's defaults. */
  permissionOverrides: text("permission_overrides", { mode: "json" }),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  /* persisted so a lockout survives killing the app — the obvious bypass, closed */
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  /** owners only; SHA-256 of the printed code (ADR-0012 §8) */
  recoveryCodeHash: text("recovery_code_hash"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_user_tenant_name").on(t.tenantId, t.name),
  index("ix_user_active").on(t.tenantId, t.active),
]);

/* ---------------- used-device purchases (ADR-0013) ----------------
 * One row per purchase, 1:1 with a `documents` row of doc_type "purchase" —
 * the document owns the gap-free number (ADR-0008), this owns the detail.
 *
 * The seller block is the second-hand register's required field set, captured
 * at intake so a future weekly export is a report rather than a request to
 * re-interview sixty customers. It is personal data: `usedDevices.viewSeller`
 * gates it, and the HANDLER withholds it — the UI does not merely hide it. */
export const usedPurchases = sqliteTable("used_purchases", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  /** the numbered purchase document */
  documentId: text("document_id").notNull().references(() => documents.id),
  /** the unit this intake created; set in the same transaction */
  unitId: text("unit_id"),
  productId: text("product_id").references(() => products.id),

  /* ---- device ---- */
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  storage: text("storage"),
  color: text("color"),
  grade: text("grade", { enum: DEVICE_GRADES }).notNull(),
  batteryPct: integer("battery_pct"),
  imei: text("imei").notNull(),
  accessories: text("accessories", { mode: "json" }), // {charger,box,cable,case}
  barcode: text("barcode"),

  /* ---- seller: personal data, permission-gated ---- */
  sellerName: text("seller_name").notNull(),
  sellerPhone: text("seller_phone"),
  sellerIdType: text("seller_id_type", { enum: ID_DOC_TYPES }).notNull(),
  sellerIdNumber: text("seller_id_number").notNull(),
  /** the register may want it; unused by the UI today, present so adding it is not a migration */
  sellerAddress: text("seller_address"),

  acquisitionChannel: text("acquisition_channel", { enum: ACQUISITION_CHANNELS })
    .notNull()
    .default("private_individual"),

  /* ---- money ---- */
  buyPriceCents: integer("buy_price_cents").notNull(),
  /** folded into the unit's cost at send-to-inventory, then frozen */
  refurbCostCents: integer("refurb_cost_cents").notNull().default(0),
  payoutMethod: text("payout_method", { enum: PAYOUT_METHODS }).notNull(),
  payoutReference: text("payout_reference"),

  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  /** captured now; the 15-day resale hold is a setting, default off */
  purchasedAt: ts("purchased_at").notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_purchase_document").on(t.documentId),
  index("ix_purchase_imei").on(t.tenantId, t.imei),
  index("ix_purchase_unit").on(t.unitId),
]);

/* Photos are FILES. The database stores a path relative to the photos root, so
 * the folder can be restored under a different user profile without rewriting
 * rows. Never blobs — see ADR-0013 §3 for what that would do to the backups. */
export const purchasePhotos = sqliteTable("purchase_photos", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  purchaseId: text("purchase_id").notNull().references(() => usedPurchases.id),
  kind: text("kind", { enum: PHOTO_KINDS }).notNull(),
  /** relative to userData/photos — e.g. "purchases/<id>/front.jpg" */
  path: text("path").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("ix_photo_purchase").on(t.purchaseId)]);

/* Store credit: money the shop already owes, redeemed as a TENDER on a sale —
 * never a negative line, which would corrupt the taxable base (ADR-0013 §4).
 * remainingCents is modelled so enabling partial redemption later is a
 * behaviour change rather than a migration; today it always equals amount. */
export const storeCreditVouchers = sqliteTable("store_credit_vouchers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  purchaseId: text("purchase_id").references(() => usedPurchases.id),
  amountCents: integer("amount_cents").notNull(),
  remainingCents: integer("remaining_cents").notNull(),
  status: text("status", { enum: VOUCHER_STATUSES }).notNull().default("issued"),
  /** the sale that consumed it */
  redeemedDocumentId: text("redeemed_document_id"),
  redeemedAt: ts("redeemed_at"),
  voidReason: text("void_reason"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  index("ix_voucher_status").on(t.tenantId, t.status),
  index("ix_voucher_purchase").on(t.purchaseId),
]);

/* ==================== repairs (ADR-0014) ==================== */

/**
 * Someone the shop knows by phone.
 *
 * Deduped on `phoneNormalized` — digits only, national prefix stripped — because
 * "671220918", "+34 671 22 09 18" and "0034671220918" are one person, and a shop
 * that ends up with three of them cannot answer "what have we done for them".
 */
export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  /** the dedupe key; see normalizePhone() in @arkom/core */
  phoneNormalized: text("phone_normalized").notNull(),
  note: text("note"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_customer_tenant_phone").on(t.tenantId, t.phoneNormalized),
  index("ix_customer_name").on(t.tenantId, t.name),
]);

export const REPAIR_STATUSES = [
  "received",
  "quoted",
  "waiting_part",
  "in_repair",
  "ready",
  "collected",
  "not_repaired",
] as const;

export const REPAIR_LINE_KINDS = ["inventory_part", "labor", "part_on_order"] as const;
export const REPAIR_APPROVAL_METHODS = ["in_person", "by_phone"] as const;
export const REPAIR_NOTIFY_METHODS = ["phone", "in_person", "other"] as const;
export const NOT_REPAIRED_REASONS = ["customer_declined", "unrepairable", "abandoned"] as const;
export const PROMISED_HALVES = ["morning", "afternoon"] as const;

/**
 * A device in the shop's hands.
 *
 * 1:1 with a `repair` document, which is where the R- number lives (ADR-0008) and
 * what the part movements reference. The customer's device is NEVER a unit row:
 * the shop is holding it, not owning it (ADR-0014 §3).
 */
export const repairTickets = sqliteTable("repair_tickets", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  /** the numbered R- document handed to the customer at intake */
  documentId: text("document_id").notNull().references(() => documents.id),
  customerId: text("customer_id").notNull().references(() => customers.id),

  /* ---- the device, as described. No unit, no stock, no valuation. ---- */
  deviceDescription: text("device_description").notNull(),
  imei: text("imei"), // nullable: not every device has one
  reportedFault: text("reported_fault").notNull(),
  conditionAtIntake: text("condition_at_intake"),
  damageScreen: integer("damage_screen", { mode: "boolean" }).notNull().default(false),
  damageBack: integer("damage_back", { mode: "boolean" }).notNull().default(false),
  damageDents: integer("damage_dents", { mode: "boolean" }).notNull().default(false),
  damageWater: integer("damage_water", { mode: "boolean" }).notNull().default(false),
  damageNote: text("damage_note"),
  accessories: text("accessories"),

  /**
   * The device's own passcode or pattern.
   *
   * Plaintext, because the technician has to read it back — the control is where
   * it GOES, not how it is stored (ADR-0014 §10). Never printed, never in an
   * oplog payload, never in a log line, masked in the UI, and excluded from
   * Phase 2 sync in plain form.
   */
  devicePasscode: text("device_passcode"),

  /* ---- what was agreed ---- */
  promisedDate: ts("promised_date"),
  promisedHalf: text("promised_half", { enum: PROMISED_HALVES }),
  assignedUserId: text("assigned_user_id"),
  depositCents: integer("deposit_cents").notNull().default(0),
  /** how it was taken. Pre-v0.13.0 rows default to cash, which is what they were */
  depositMethod: text("deposit_method", { enum: DEPOSIT_METHODS }).notNull().default("cash"),
  /* How much of the deposit went back, how, and in which shift — set only by
     markNotRepaired, the one path that refunds. The shift is stamped rather than
     inferred from a timestamp because a non-cash refund writes no cash movement
     to carry it, and a refund that belongs to no shift appears on no Z. */
  depositRefundedCents: integer("deposit_refunded_cents").notNull().default(0),
  depositRefundMethod: text("deposit_refund_method", { enum: DEPOSIT_METHODS }),
  depositRefundShiftId: text("deposit_refund_shift_id"),
  /** signed "repair up to X" authorization; NULL = none given */
  authorizedCapCents: integer("authorized_cap_cents"),
  /** snapshots, so changing a setting cannot reach back into a ticket (ADR-0014 §8) */
  diagnosisFeeCents: integer("diagnosis_fee_cents").notNull().default(0),
  warrantyMonths: integer("warranty_months").notNull().default(3),

  /* ---- the facts that entail the status ---- */
  readyAt: ts("ready_at"),
  notRepairedAt: ts("not_repaired_at"),
  notRepairedReason: text("not_repaired_reason", { enum: NOT_REPAIRED_REASONS }),
  /** the T1- sale that closed it — the cross-reference, stored both ways */
  collectionDocumentId: text("collection_document_id"),
  /**
   * CACHE of repairStatus(), never a source (ADR-0014 §1).
   *
   * Written in the same transaction as the fact that moved it, exactly as
   * product_stock is written with its movement. `db:audit` checks the two agree,
   * which is what stops a cache from quietly becoming a second truth.
   */
  status: text("status", { enum: REPAIR_STATUSES }).notNull().default("received"),

  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  uniqueIndex("ux_repair_document").on(t.documentId),
  index("ix_repair_status").on(t.tenantId, t.status),
  index("ix_repair_customer").on(t.customerId),
  index("ix_repair_assigned").on(t.assignedUserId),
]);

/**
 * What will be charged, and what it cost.
 *
 * An `inventory_part` line has already left the shelf — its consumption movement
 * is posted when the line is added. A `part_on_order` line has zero stock effect
 * until it is received. `labor` has no stock at all, which is why it is a line
 * kind rather than a product (a labor "product" would appear in Catálogo and in
 * stock counts).
 */
export const repairLines = sqliteTable("repair_lines", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  ticketId: text("ticket_id").notNull().references(() => repairTickets.id),
  kind: text("kind", { enum: REPAIR_LINE_KINDS }).notNull(),
  productId: text("product_id").references(() => products.id),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  /** snapshot at the moment it was taken; the charge may move, this may not */
  unitCostCents: integer("unit_cost_cents"),
  chargeCents: integer("charge_cents").notNull().default(0),

  /* ---- part_on_order only ---- */
  supplierText: text("supplier_text"),
  expectedCostCents: integer("expected_cost_cents"),
  orderedAt: ts("ordered_at"),
  receivedAt: ts("received_at"),

  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [index("ix_repair_line_ticket").on(t.ticketId)]);

/**
 * What the customer approved, and for how much.
 *
 * Rows, not a flag. Approval binds to an AMOUNT (ADR-0014 §2): if the quote later
 * rises above it the ticket falls back to Presupuestado and needs a second
 * approval — and both stay on the record, because "they approved 79 € on Monday
 * and 145 € on Wednesday" is the sentence that settles a dispute.
 */
export const repairApprovals = sqliteTable("repair_approvals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  ticketId: text("ticket_id").notNull().references(() => repairTickets.id),
  method: text("method", { enum: REPAIR_APPROVAL_METHODS }).notNull(),
  approvedTotalCents: integer("approved_total_cents").notNull(),
  userId: text("user_id"),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("ix_repair_approval_ticket").on(t.ticketId)]);

/**
 * "We called them."
 *
 * Nothing is sent from the till. The shape is what a Phase 2 cloud job would need
 * to send from — method, note, actor, timestamp — so the log is useful now as a
 * record and useful later as a queue.
 */
export const repairNotifications = sqliteTable("repair_notifications", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  ticketId: text("ticket_id").notNull().references(() => repairTickets.id),
  method: text("method", { enum: REPAIR_NOTIFY_METHODS }).notNull(),
  note: text("note"),
  userId: text("user_id"),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("ix_repair_notify_ticket").on(t.ticketId)]);

/** Intake photos. Files on disk, paths in rows — same rule as purchases (ADR-0013 §3). */
export const repairPhotos = sqliteTable("repair_photos", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  ticketId: text("ticket_id").notNull().references(() => repairTickets.id),
  kind: text("kind", { enum: PHOTO_KINDS }).notNull(),
  path: text("path").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("ix_repair_photo_ticket").on(t.ticketId)]);

export const CASH_MOVEMENT_REASONS = [
  "repair_deposit",
  /* the deposit stopped being money HELD for someone and became takings the
     collection document accounts for. The cash never moved; what changed is
     whose it is — and posting it keeps a ticket's rows netting to zero, which
     is what stops Caja counting the same €30 twice (ADR-0014 §7). */
  "repair_deposit_applied",
  "repair_deposit_refund",
  "used_purchase_payout",
  /* manual, typed by a human, with a concept saying why (ADR-0015 §9) */
  "paid_in",
  "paid_out",
] as const;

/**
 * Money in and out of the drawer that is NOT a sale.
 *
 * Introduced by the repairs slice (ADR-0014 §7) because a deposit is cash the
 * shop is holding for a customer, and at hand-back it may have to be given back.
 *
 * **The boundary, drawn deliberately:** sale takings and change stay OUT of this
 * table until the Cash screen slice. They are already fully recorded as document
 * tenders, and copying them here would create two answers to "what did we take
 * today" — one of which would be wrong the first time a copy was missed. What
 * lives here is what has no other home: deposits, their refunds, and used-device
 * payouts. When Caja lands, it opens the float and reconciles by reading tenders
 * AND this table, rather than a third ledger written later.
 */
export const cashMovements = sqliteTable("cash_movements", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),
  /** signed: + into the drawer, − out of it */
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason", { enum: CASH_MOVEMENT_REASONS }).notNull(),
  /** the R- or C- document this belongs to, when there is one */
  documentId: text("document_id"),
  ticketId: text("ticket_id"),
  /** why, in the shop's own words. Manual rows only (ADR-0015 §9) */
  concept: text("concept"),
  /** NULL = written before shifts existed (ADR-0010's convention, ADR-0015) */
  shiftId: text("shift_id"),
  userId: text("user_id"),
  createdAt: ts("created_at").notNull(),
}, (t) => [
  index("ix_cash_movement_created").on(t.tenantId, t.createdAt),
  index("ix_cash_movement_document").on(t.documentId),
  index("ix_cash_movement_shift").on(t.shiftId),
]);

/* ---------------- shifts: the drawer, opened and counted (ADR-0015) ----------------
 *
 * A shift belongs to the TILL, not to a person: two cashiers work one afternoon and the
 * drawer does not change hands when they do. Open and close each record who counted, and
 * that is the whole of the attribution a drawer needs.
 *
 * **There is no status column.** Open means `closed_at IS NULL` — the ADR-0014 discipline
 * applied to cash. And at most one open shift per till is a PARTIAL UNIQUE INDEX rather
 * than a check in code, because a code check loses races and the failure mode is two open
 * shifts computing overlapping expected-cash figures, both wrong, neither obviously so.
 */
export const shifts = sqliteTable("shifts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  locationId: text("location_id").notNull().references(() => locations.id),
  terminalId: text("terminal_id").notNull().references(() => terminals.id),

  openedByUserId: text("opened_by_user_id"),
  openedAt: ts("opened_at").notNull(),
  openingFloatCents: integer("opening_float_cents").notNull().default(0),
  /** {"<value in cents>": quantity} — evidence for the figure beside it (ADR-0015 §11) */
  openingBreakdown: text("opening_breakdown", { mode: "json" }),

  /** the ONLY status fact. NULL = open. */
  closedAt: ts("closed_at"),
  closedByUserId: text("closed_by_user_id"),
  countedCashCents: integer("counted_cash_cents"),
  closingBreakdown: text("closing_breakdown", { mode: "json" }),
  expectedCashCents: integer("expected_cash_cents"),
  /** counted − expected. Negative is SHORT. */
  varianceCents: integer("variance_cents"),
  varianceReason: text("variance_reason"),
  /** set only when the variance needed an owner's PIN (ADR-0012 §5) */
  approvedByUserId: text("approved_by_user_id"),

  zSeriesId: text("z_series_id").references(() => numberSeries.id),
  zNumber: integer("z_number"),
  zDocNumber: text("z_doc_number"), // "Z1-000007"
  /** the frozen Z. A reprint renders THIS, never a recomputation (ADR-0015 §7) */
  snapshot: text("snapshot", { mode: "json" }),

  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [
  index("ix_shift_terminal_opened").on(t.terminalId, t.openedAt),
  uniqueIndex("ux_shift_z_number").on(t.zSeriesId, t.zNumber), // gap-free, like documents
  /* THE guarantee, not a convenience: one open shift per till, decided by SQLite
     rather than by whichever code path happened to check first (ADR-0015 §1). */
  uniqueIndex("ux_shift_open_per_terminal").on(t.terminalId).where(sql`${t.closedAt} is null`),
]);
