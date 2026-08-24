/**
 * IPC contract v1 — docs/design/system-design.md §4.
 * Every payload/result crossing the Electron bridge is a Zod schema defined here
 * and parsed on BOTH sides (main handler and renderer). Channels are added as
 * features land; the doc is updated in the same PR when the contract changes.
 */
import { z } from "zod";

/** Channels implemented so far (allowlisted in the preload bridge). */
export const IPC_CHANNELS = [
  "meta:context",
  "catalog:list",
  "catalog:get",
  "catalog:save",
  "catalog:groups",
  "catalog:codes",
  "catalog:addCode",
  "catalog:removeCode",
  "scan:resolve",
  "inventory:list",
  "inventory:movements",
  "stock:add",
  "supplier:list",
  "supplier:create",
  "sale:current",
  "sale:addLine",
  "sale:setQty",
  "sale:removeLine",
  "sale:overridePrice",
  "sale:park",
  "sale:resume",
  "sale:listParked",
  "sale:complete",
  "sale:peek",
] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Typed error codes (§4) — the renderer maps codes to UI, never parses messages. */
export const ErrorCodeSchema = z.enum([
  "DUPLICATE_NAME",
  "DUPLICATE_BARCODE",
  "DUPLICATE_IMEI",
  "NEGATIVE_STOCK",
  "UNIT_NOT_AVAILABLE",
  "TENDER_MISMATCH",
  "VALIDATION",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const IpcErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  field: z.string().optional(),
});
export type IpcError = z.infer<typeof IpcErrorSchema>;

/* ---- meta:context — {} → {tenant, location, terminal} (injected config) ---- */

export const EntityRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type EntityRef = z.infer<typeof EntityRefSchema>;

export const MetaContextRequestSchema = z.object({}).optional();
export const MetaContextResponseSchema = z.object({
  tenant: EntityRefSchema,
  location: EntityRefSchema,
  terminal: EntityRefSchema,
});
export type MetaContextResponse = z.infer<typeof MetaContextResponseSchema>;

/* ---- catalog:* — §4 rows 1–3 ---- */

/** Item types selectable in Phase 1 (the schema enum keeps the full domain). */
export const CatalogItemTypeSchema = z.enum(["stocked", "serialized"]);
export type CatalogItemType = z.infer<typeof CatalogItemTypeSchema>;

/** Tax regimes offered in Phase 1 (ADR-0007: IVA21 only; others visible-disabled). */
export const TaxRegimeP1Schema = z.enum(["IVA21"]);

export const CatalogListRequestSchema = z
  .object({
    search: z.string().optional(),
    groupId: z.string().optional(),
    itemType: CatalogItemTypeSchema.optional(),
    lowStockOnly: z.boolean().optional(),
    missingDataOnly: z.boolean().optional(),
  })
  .optional();
export type CatalogListRequest = z.infer<typeof CatalogListRequestSchema>;

export const ProductRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  barcode: z.string().nullable(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  itemType: z.string(),
  costCents: z.number().int().nullable(),
  priceCents: z.number().int().nullable(),
  taxRegime: z.string().nullable(),
  taxRateBp: z.number().int().nullable(),
  onHand: z.number().int(),
  reorderPoint: z.number().int(),
  lowStockThreshold: z.number().int(),
  active: z.boolean(),
});
export type ProductRow = z.infer<typeof ProductRowSchema>;

export const CatalogListResponseSchema = z.array(ProductRowSchema);
export const CatalogGetRequestSchema = z.object({ id: z.string() });
export const CatalogGetResponseSchema = ProductRowSchema;

export const CatalogGroupsRequestSchema = z.object({}).optional();
export const CatalogGroupsResponseSchema = z.array(EntityRefSchema);

/** req 4.1: cost, PVP, IVA and group are REQUIRED on every save (schema-level). */
export const CatalogSaveRequestSchema = z.object({
  id: z.string().nullish(), // present → update
  name: z.string().trim().min(1).max(200),
  barcode: z.string().trim().max(64).nullish(), // blank → core auto-EAN (req 4.2)
  groupId: z.string().min(1),
  itemType: CatalogItemTypeSchema,
  costCents: z.number().int().min(0),
  priceCents: z.number().int().min(0),
  taxRegime: TaxRegimeP1Schema,
  reorderPoint: z.number().int().min(0), // req 4.5
  lowStockThreshold: z.number().int().min(0), // req 4.5
  active: z.boolean(),
  /** re-send with true to accept a shared-barcode warning (req 4.4 amended) */
  confirmed: z.boolean().optional(),
});
export type CatalogSaveRequest = z.infer<typeof CatalogSaveRequestSchema>;

/** A product named in a shared-code warning. */
export const ProductRefSchema = z.object({ productId: z.string(), name: z.string() });
export type ProductRef = z.infer<typeof ProductRefSchema>;

/**
 * req 4.4 (amended): a duplicate barcode WARNS instead of blocking — real box
 * EANs legitimately sit on sibling variants. The client re-sends with
 * confirmed:true to go ahead. Duplicate NAMES are still a hard block.
 */
export const CatalogSaveResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), product: ProductRowSchema }),
  z.object({ kind: z.literal("barcodeWarning"), code: z.string(), conflicts: z.array(ProductRefSchema) }),
]);
export type CatalogSaveResponse = z.infer<typeof CatalogSaveResponseSchema>;

/* ---- product codes (additional scannable codes) ---- */

export const ProductCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  createdAtMs: z.number().int(),
});
export type ProductCode = z.infer<typeof ProductCodeSchema>;

export const CatalogCodesRequestSchema = z.object({ productId: z.string() });
export const CatalogCodesResponseSchema = z.array(ProductCodeSchema);

export const CatalogAddCodeRequestSchema = z.object({
  productId: z.string(),
  code: z.string().trim().min(1).max(64),
  confirmed: z.boolean().optional(),
});
export type CatalogAddCodeRequest = z.infer<typeof CatalogAddCodeRequestSchema>;
export const CatalogAddCodeResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added"), codes: z.array(ProductCodeSchema) }),
  z.object({ kind: z.literal("sharedWarning"), code: z.string(), conflicts: z.array(ProductRefSchema) }),
]);
export type CatalogAddCodeResponse = z.infer<typeof CatalogAddCodeResponseSchema>;

export const CatalogRemoveCodeRequestSchema = z.object({ productId: z.string(), codeId: z.string() });
export const CatalogRemoveCodeResponseSchema = z.array(ProductCodeSchema);

/* ---- scan:resolve — one code, one answer (or a picker) ---- */

export const ScanProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  itemType: z.string(),
  priceCents: z.number().int().nullable(),
  onHand: z.number().int(),
  active: z.boolean(),
});
export const ScanUnitSchema = z.object({
  unitId: z.string(),
  imei: z.string(),
  status: z.string(),
});
const ScanProductMatchSchema = z.object({
  kind: z.literal("product"),
  product: ScanProductSchema,
  matchedVia: z.enum(["primary", "alias"]),
});
const ScanUnitMatchSchema = z.object({
  kind: z.literal("unit"),
  unit: ScanUnitSchema,
  product: ScanProductSchema,
});
export const ScanMatchSchema = z.discriminatedUnion("kind", [ScanProductMatchSchema, ScanUnitMatchSchema]);
export const ScanResolutionSchema = z.discriminatedUnion("kind", [
  ScanProductMatchSchema,
  ScanUnitMatchSchema,
  z.object({ kind: z.literal("ambiguous"), code: z.string(), matches: z.array(ScanMatchSchema) }),
  z.object({
    kind: z.literal("none"),
    code: z.string(),
    unavailableUnit: z
      .object({ imei: z.string(), status: z.string(), productName: z.string() })
      .optional(),
  }),
]);
export const ScanResolveRequestSchema = z.object({ code: z.string() });

/* ---- inventory:* + stock:add + supplier:* — §4 ---- */

export const InventoryListRequestSchema = z
  .object({
    search: z.string().optional(),
    groupId: z.string().optional(),
    itemType: CatalogItemTypeSchema.optional(),
    lowStockOnly: z.boolean().optional(),
  })
  .optional();
export type InventoryListRequest = z.infer<typeof InventoryListRequestSchema>;

export const InventoryRowSchema = z.object({
  productId: z.string(),
  name: z.string(),
  barcode: z.string().nullable(),
  groupId: z.string().nullable(),
  groupName: z.string().nullable(),
  itemType: z.string(),
  onHand: z.number().int(),
  reorderPoint: z.number().int(),
  lowStockThreshold: z.number().int(),
  costCents: z.number().int().nullable(),
  /** stocked: onHand × cost (0 when cost unknown) · serialized: Σ in-stock unit costs */
  valuationCents: z.number().int(),
  active: z.boolean(),
});
export type InventoryRow = z.infer<typeof InventoryRowSchema>;
export const InventoryListResponseSchema = z.array(InventoryRowSchema);

export const InventoryMovementsRequestSchema = z.object({
  productId: z.string(),
  cursor: z.string().nullish(), // keyset: movement id (UUIDv7 = time-ordered)
});
export type InventoryMovementsRequest = z.infer<typeof InventoryMovementsRequestSchema>;

export const MovementRowSchema = z.object({
  id: z.string(),
  createdAtMs: z.number().int(),
  movementType: z.string(),
  qty: z.number().int(),
  unitCostCents: z.number().int().nullable(),
  documentId: z.string().nullable(), // link target for the ticket peek
  documentNumber: z.string().nullable(),
  imei: z.string().nullable(),
  userId: z.string().nullable(), // "—" until auth (ADR-0010)
});
export type MovementRow = z.infer<typeof MovementRowSchema>;
export const InventoryMovementsResponseSchema = z.object({
  rows: z.array(MovementRowSchema),
  nextCursor: z.string().nullable(),
});
export type InventoryMovementsResponse = z.infer<typeof InventoryMovementsResponseSchema>;

/**
 * One staged entry line. A stocked line carries `qty`; a SERIALIZED line
 * carries `expectedQty` plus exactly that many `imeis` — the panel captures
 * them in a loop and the server refuses any mismatch (req 6.1).
 */
export const StockAddEntrySchema = z
  .object({
    productId: z.string().optional(),
    barcode: z.string().optional(),
    unitCostCents: z.number().int().min(0), // req 6.2
    supplierId: z.string().min(1), // req 6.3
    qty: z.number().int().min(1).optional(), // stocked lines
    expectedQty: z.number().int().min(1).optional(), // serialized lines
    imeis: z.array(z.string()).optional(),
  })
  .refine((e) => e.productId || e.barcode, { message: "productId or barcode required" })
  .refine((e) => (e.qty == null) !== (e.expectedQty == null), {
    message: "exactly one of qty (stocked) or expectedQty (serialized) is required",
  })
  .refine((e) => e.expectedQty == null || (e.imeis?.length ?? 0) === e.expectedQty, {
    message: "a serialized line needs one IMEI per expected unit",
    path: ["imeis"],
  });
export type StockAddEntry = z.infer<typeof StockAddEntrySchema>;

export const StockAddRequestSchema = z.object({
  entries: z.array(StockAddEntrySchema).min(1),
});
export type StockAddRequest = z.infer<typeof StockAddRequestSchema>;

export const StockAddResponseSchema = z.object({
  lineCount: z.number().int(),
  productIds: z.array(z.string()),
});
export type StockAddResponse = z.infer<typeof StockAddResponseSchema>;

/* ---- sale:* — §4. Drafts are real documents, created lazily on the first
   addLine; totals are ALWAYS computed server-side (the renderer never
   recomputes money) and travel inside SaleState. ---- */

export const TenderMethodSchema = z.enum(["cash", "card", "bizum", "transfer"]);

export const SaleLineRowSchema = z.object({
  id: z.string(),
  lineNo: z.number().int(),
  lineType: z.string(), // "product" | "serialized_unit" in P1
  productId: z.string().nullable(),
  unitId: z.string().nullable(),
  description: z.string(),
  barcode: z.string().nullable(),
  imei: z.string().nullable(),
  qty: z.number().int(),
  unitPriceCents: z.number().int(),
  priceOverridden: z.boolean(),
  overrideReason: z.string().nullable(),
  originalPriceCents: z.number().int().nullable(), // catalog PVP for the "PVP original" sub-line
  taxRegime: z.string(),
  taxRateBp: z.number().int(),
  baseCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
});
export type SaleLineRow = z.infer<typeof SaleLineRowSchema>;

export const SaleStateSchema = z.object({
  docId: z.string(),
  status: z.enum(["draft", "parked"]),
  lines: z.array(SaleLineRowSchema),
  subtotalCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
});
export type SaleState = z.infer<typeof SaleStateSchema>;

export const SaleCurrentRequestSchema = z.object({}).optional();
export const SaleCurrentResponseSchema = SaleStateSchema.nullable();

export const SaleAddLineRequestSchema = z
  .object({
    docId: z.string().nullish(), // null → lazy-create (or attach to the terminal's draft)
    barcode: z.string().optional(), // scan text: product barcode or a direct IMEI
    productId: z.string().optional(),
    unitId: z.string().optional(),
    qty: z.number().int().min(1).optional(),
  })
  .refine((r) => r.barcode || r.productId || r.unitId, { message: "barcode, productId or unitId required" });
export type SaleAddLineRequest = z.infer<typeof SaleAddLineRequestSchema>;

export const UnitPickOptionSchema = z.object({
  unitId: z.string(),
  imei: z.string(),
  createdAtMs: z.number().int(), // cost-in date shown in the pick modal
});
export const SaleAddLineResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state"), state: SaleStateSchema }),
  z.object({
    kind: z.literal("unitPick"),
    productId: z.string(),
    productName: z.string(),
    units: z.array(UnitPickOptionSchema),
  }),
]);
export type SaleAddLineResponse = z.infer<typeof SaleAddLineResponseSchema>;

export const SaleSetQtyRequestSchema = z.object({
  docId: z.string(),
  lineId: z.string(),
  qty: z.number().int().min(1),
});
export const SaleRemoveLineRequestSchema = z.object({ docId: z.string(), lineId: z.string() });
export const SaleOverridePriceRequestSchema = z.object({
  docId: z.string(),
  lineId: z.string(),
  newPriceCents: z.number().int().min(0),
  reason: z.string().trim().min(1), // req 2.4: gated with reason
});

export const SaleParkRequestSchema = z.object({
  docId: z.string(),
  label: z.string().trim().max(60).nullish(), // default: time stamp, set server-side
});
export const SaleParkResponseSchema = z.object({ docId: z.string(), parkedLabel: z.string() });
export const SaleResumeRequestSchema = z.object({ docId: z.string() });
export const SaleListParkedRequestSchema = z.object({}).optional();
export const ParkedSaleSchema = z.object({
  docId: z.string(),
  label: z.string(),
  lineCount: z.number().int(),
  totalCents: z.number().int(),
  createdAtMs: z.number().int(),
});
export const SaleListParkedResponseSchema = z.array(ParkedSaleSchema);
export type ParkedSale = z.infer<typeof ParkedSaleSchema>;

export const SaleTenderSchema = z.object({
  method: TenderMethodSchema,
  amountCents: z.number().int().min(1),
  cardReference: z.string().nullish(),
});
export const SaleCompleteRequestSchema = z.object({
  docId: z.string(),
  tenders: z.array(SaleTenderSchema).min(1),
});
export const CompletedSaleSchema = z.object({
  docId: z.string(),
  docNumber: z.string(),
  number: z.number().int(),
  totalCents: z.number().int(),
  changeCents: z.number().int(),
  completedAtMs: z.number().int(),
});
export type CompletedSale = z.infer<typeof CompletedSaleSchema>;

export const SalePeekRequestSchema = z.object({ docId: z.string() });
export const TicketPeekSchema = z.object({
  docId: z.string(),
  docNumber: z.string().nullable(),
  status: z.string(),
  completedAtMs: z.number().int().nullable(),
  lines: z.array(
    z.object({
      description: z.string(),
      qty: z.number().int(),
      unitPriceCents: z.number().int(),
      totalCents: z.number().int(),
      imei: z.string().nullable(),
      priceOverridden: z.boolean(),
    }),
  ),
  subtotalCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  tenders: z.array(z.object({ method: z.string(), amountCents: z.number().int(), cardReference: z.string().nullable() })),
  changeCents: z.number().int(),
});
export type TicketPeek = z.infer<typeof TicketPeekSchema>;

export const SupplierListRequestSchema = z.object({}).optional();
export const SupplierListResponseSchema = z.array(EntityRefSchema);
export const SupplierCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type SupplierCreateRequest = z.infer<typeof SupplierCreateRequestSchema>;
export const SupplierCreateResponseSchema = EntityRefSchema;
