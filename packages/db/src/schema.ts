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
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

/* ---------------- enums: single source of truth ---------------- */
export const ITEM_TYPES = ["stocked", "serialized", "used_device", "service", "repair", "agency", "sim", "topup"] as const;
export const TAX_REGIMES = ["IVA21", "IVA10", "IVA4", "REBU", "EXEMPT"] as const; // P1 uses IVA21 (ADR-0007)
export const MOVEMENT_TYPES = ["purchase_in", "sale_out", "adjustment", "count_post", "repair_part_out", "tradein_in", "return_in", "transfer"] as const; // P1: first three
export const DOC_TYPES = ["ticket", "invoice", "credit_note"] as const; // P1: ticket only (ADR-0008)
export const DOC_STATUSES = ["draft", "parked", "completed"] as const;
export const LINE_TYPES = ["product", "serialized_unit", "repair", "tradein_credit", "agency", "sim", "topup"] as const; // P1: product, serialized_unit
export const TENDER_METHODS = ["cash", "card", "bizum", "transfer", "store_credit"] as const; // P1: all but store_credit
export const UNIT_STATUSES = ["in_stock", "reserved", "sold"] as const;

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
  createdAt: ts("created_at").notNull(),
}, (t) => [uniqueIndex("ux_group_tenant_name").on(t.tenantId, t.name)]);

export const suppliers = sqliteTable("suppliers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
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
  createdAt: ts("created_at").notNull(),
}, (t) => [
  uniqueIndex("ux_line_doc_no").on(t.documentId, t.lineNo),
  index("ix_line_product").on(t.productId),
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
  userId: text("user_id"),                 // nullable until auth (ADR-0010)
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
