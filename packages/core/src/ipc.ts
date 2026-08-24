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
  "settings:get",
  "settings:save",
  "print:printers",
  "print:ticket",
  "print:test",
  "print:reveal",
  "print:ticketsDir",
  "setup:status",
  "setup:complete",
  "demo:status",
  "demo:remove",
] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Typed error codes (§4) — the renderer maps codes to UI, never parses messages. */
export const ErrorCodeSchema = z.enum([
  "PRINT_FAILED",
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

/* ---------------------------------------------------- settings + printing --- */

/** Rolls the shop can load; the ticket renderer maps these to column counts. */
export const PaperWidthSchema = z.union([z.literal(80), z.literal(58)]);

/** The command sets node-thermal-printer speaks. Epson is the CT-S310S's mode. */
export const CommandSetSchema = z.enum(["epson", "star", "tanca", "daruma", "brother"]);

/**
 * Everything Ajustes stores. Persisted as a KV table, but it crosses the bridge
 * as one typed object — the renderer never assembles keys by hand.
 * `printerName: ""` means "no printer", which is a legitimate configuration:
 * the till still sells, and every ticket goes to PDF.
 */
export const SettingsSchema = z.object({
  printerName: z.string().max(200),
  paperWidthMm: PaperWidthSchema,
  commandSet: CommandSetSchema,
  shopLegalName: z.string().max(200),
  shopNif: z.string().max(40),
  shopAddress: z.string().max(300),
  ticketFooter: z.string().max(200),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SettingsGetRequestSchema = z.object({}).optional();
export const SettingsGetResponseSchema = SettingsSchema;
/** Partial save: Ajustes sends only the fields it touched, the repo merges. */
export const SettingsSaveRequestSchema = SettingsSchema.partial();
export const SettingsSaveResponseSchema = SettingsSchema;

export const PrintPrintersRequestSchema = z.object({}).optional();
/**
 * What the OS knows about a printer. No "is default" flag: Electron 37 dropped
 * it from PrinterInfo and the replacement is platform-specific, so the dropdown
 * lists what exists and the owner picks rather than us guessing wrong.
 */
export const PrinterInfoSchema = z.object({
  name: z.string(),
  displayName: z.string(),
});
export const PrintPrintersResponseSchema = z.array(PrinterInfoSchema);
export type PrinterInfo = z.infer<typeof PrinterInfoSchema>;

/**
 * `target` decides where a ticket goes:
 *   "auto" — the configured printer, failing with PRINT_FAILED if there is none
 *            or the spooler rejects it (the UI then offers Reintentar / PDF);
 *   "pdf"  — straight to a file, which is what "Guardar PDF" does and what the
 *            dev machine (no printer) uses for every check.
 * `copy` stamps COPIA and withholds the drawer pulse.
 */
export const PrintTicketRequestSchema = z.object({
  docId: z.string(),
  copy: z.boolean().default(false),
  target: z.enum(["auto", "pdf"]).default("auto"),
});
export const PrintTicketResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("printed"), printer: z.string() }),
  z.object({ kind: z.literal("pdf"), path: z.string() }),
]);
export type PrintTicketRequest = z.infer<typeof PrintTicketRequestSchema>;
/** What the renderer sends: `copy` and `target` get their defaults main-side. */
export type PrintTicketInput = z.input<typeof PrintTicketRequestSchema>;
export type PrintTicketResponse = z.infer<typeof PrintTicketResponseSchema>;

/**
 * "Imprimir prueba" in Ajustes. Renders a fixed sample ticket so the owner can
 * check paper, cut and the shop's legal block without ringing up a real sale —
 * and so nothing lands in the document table just to test a printer.
 */
export const PrintTestRequestSchema = z
  .object({ target: z.enum(["auto", "pdf"]).default("auto") })
  .default({ target: "auto" });
export const PrintTestResponseSchema = PrintTicketResponseSchema;
export type PrintTestRequest = z.infer<typeof PrintTestRequestSchema>;

/**
 * Open a saved ticket, or show it in the file manager.
 *
 * The tickets folder lives under userData, which on Windows sits inside a
 * hidden AppData tree — printing its path in a toast is not the same as the
 * owner being able to reach it. The main process resolves the path against the
 * tickets directory before handing it to the shell, so this cannot be used to
 * open anything else.
 */
export const PrintRevealRequestSchema = z.object({
  path: z.string().min(1),
  mode: z.enum(["open", "folder"]).default("open"),
});
export const PrintRevealResponseSchema = z.object({ ok: z.boolean() });

/** Where tickets are saved — shown in Ajustes with a button to open it. */
export const PrintTicketsDirRequestSchema = z.object({}).optional();
export const PrintTicketsDirResponseSchema = z.object({ path: z.string() });

/* --------------------------------------------- first run + demo data --- */

/**
 * First run. A client install has no seed step, so the app asks the shop who it
 * is once, and everything the answer produces lands in one transaction.
 */
export const SetupStatusRequestSchema = z.object({}).optional();
export const SetupStatusResponseSchema = z.object({ needed: z.boolean() });

export const SetupCompleteRequestSchema = z.object({
  shopLegalName: z.string().trim().min(1).max(200),
  shopNif: z.string().trim().min(1).max(40),
  shopAddress: z.string().trim().min(1).max(300),
  ticketFooter: z.string().trim().max(200),
  terminalName: z.string().trim().min(1).max(60),
  // ADR-0008: the series prefix is frozen once tickets start being issued
  seriesPrefix: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .regex(/^[A-Za-z0-9-]+$/, "Solo letras, números y guiones."),
  loadDemo: z.boolean(),
});
export const SetupCompleteResponseSchema = z.object({
  tenantId: z.string(),
  demoProducts: z.number().int(),
  demoUnits: z.number().int(),
});
export type SetupCompleteRequest = z.infer<typeof SetupCompleteRequestSchema>;

export const DemoStatusRequestSchema = z.object({}).optional();
export const DemoStatusResponseSchema = z.object({
  present: z.boolean(),
  products: z.number().int(),
  groups: z.number().int(),
  suppliers: z.number().int(),
  removable: z.boolean(),
  /** true once any ticket exists — demo rows are then load-bearing */
  blockedBySales: z.boolean(),
});
export type DemoStatus = z.infer<typeof DemoStatusResponseSchema>;

export const DemoRemoveRequestSchema = z.object({}).optional();
export const DemoRemoveResponseSchema = z.object({
  products: z.number().int(),
  groups: z.number().int(),
  suppliers: z.number().int(),
  units: z.number().int(),
  movements: z.number().int(),
  codes: z.number().int(),
});
export type DemoRemoveResponse = z.infer<typeof DemoRemoveResponseSchema>;
