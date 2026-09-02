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
  "backup:status",
  "backup:now",
  "backup:openFolder",
  "backup:pickFolder",
  "auth:users",
  "auth:login",
  "auth:session",
  "auth:logout",
  "auth:lock",
  "auth:unlock",
  "auth:activity",
  "auth:recover",
  "auth:printRecovery",
  "setup:owner",
  "users:list",
  "users:create",
  "users:update",
  "users:resetPin",
  "users:technicians",
  "used:checkImei",
  "used:log",
  "used:print",
  "used:list",
  "used:get",
  "used:setReview",
  "used:setRefurbCost",
  "used:sendToInventory",
  "used:findVoucher",
  "used:voidVoucher",
  "used:peek",
  "customer:search",
  "customer:upsert",
  "repair:create",
  "repair:get",
  "repair:addLine",
  "repair:removeLine",
  "repair:setLineCharge",
  "repair:recordApproval",
  "repair:receivePart",
  "repair:partsToOrder",
  "repair:list",
  "repair:photos",
  "repair:revealPasscode",
  "repair:edit",
  "repair:assign",
  "repair:peek",
  "workshop:board",
  "repair:markReady",
  "repair:notify",
  "repair:collect",
  "repair:markNotRepaired",
  "repair:print",
  "cash:current",
  "cash:open",
  "cash:movements",
  "cash:paidIn",
  "cash:paidOut",
  "cash:preview",
  "cash:close",
  "cash:history",
  "cash:get",
  "cash:print",
  "reports:hub",
  "reports:sales",
  "reports:salesDetail",
  "reports:repairsOpen",
  "reports:repairsClosed",
  "reports:used",
  "reports:valuation",
  "reports:deadStock",
  "reports:export",
] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Typed error codes (§4) — the renderer maps codes to UI, never parses messages. */
export const ErrorCodeSchema = z.enum([
  /* auth (ADR-0012). APPROVAL_REQUIRED is the unusual one: it is an invitation
     to retry with an approver's PIN, not a refusal. */
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "APPROVAL_REQUIRED",
  "INVALID_PIN",
  "USER_LOCKED",
  "WEAK_PIN",
  "LAST_OWNER",
  "PRINT_FAILED",
  "DUPLICATE_NAME",
  "DUPLICATE_BARCODE",
  "DUPLICATE_IMEI",
  "NEGATIVE_STOCK",
  "UNIT_NOT_AVAILABLE",
  "TENDER_MISMATCH",
  /* No shift is open on this till (ADR-0015 §9). The second code that is an
     invitation rather than a refusal: the Sale screen answers it by offering to
     open one inline, because blocking a sale to teach someone about process is
     how a till gets bypassed with a paper notebook. */
  "SHIFT_REQUIRED",
  /* The device is flagged as needing review and nobody has said they looked
     (ADR-0013 amendment). Like SHIFT_REQUIRED, an invitation rather than a
     refusal: the UI answers it with a confirmation, not an error. */
  "REVIEW_REQUIRED",
  "VALIDATION",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/* ---- used devices: the vocabulary, declared up here so every schema below
     can reach it whatever order the file grows in (ADR-0013) ---- */
export const DeviceGradeSchema = z.enum(["A", "B", "C"]);
export const IdDocTypeSchema = z.enum(["DNI", "NIE", "PASAPORTE"]);
export const PayoutMethodSchema = z.enum(["cash", "transfer", "store_credit"]);
/** How a repair deposit is taken and given back (ADR-0015 §5). */
export const DepositMethodSchema = z.enum(["cash", "card", "bizum", "transfer"]);
export type DepositMethod = z.infer<typeof DepositMethodSchema>;
export const AcquisitionChannelSchema = z.enum(["private_individual", "business"]);
export const PhotoKindSchema = z.enum(["front", "back", "extra", "seller_id"]);
export const VoucherStatusSchema = z.enum(["issued", "redeemed", "void"]);

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
/**
 * What the catalogue EDITOR can set. `used_device` is deliberately absent: a
 * used product is created by buying a phone, never by typing one in.
 */
export const CatalogItemTypeSchema = z.enum(["stocked", "serialized"]);
/** What a catalogue row may CARRY, which includes rows the editor cannot make. */
export const ProductItemTypeSchema = z.enum(["stocked", "serialized", "used_device"]);
export type CatalogItemType = z.infer<typeof CatalogItemTypeSchema>;

/** Tax regimes offered in Phase 1 (ADR-0007: IVA21 only; others visible-disabled). */
export const TaxRegimeP1Schema = z.enum(["IVA21"]);

/**
 * includeUsed decides whether second-hand products appear.
 *
 * They are real, sellable products — but they are created by the buy screen,
 * one per model, and the owner never maintains them. Catálogo is the list of
 * things the shop looks after, so it asks without them; the Sale screen asks
 * with them, because a bought phone that cannot be found is a phone that
 * cannot be sold (ADR-0013, catalogue noise).
 */
export const CatalogListRequestSchema = z
  .object({
    search: z.string().optional(),
    groupId: z.string().optional(),
    itemType: CatalogItemTypeSchema.optional(),
    lowStockOnly: z.boolean().optional(),
    missingDataOnly: z.boolean().optional(),
    /* second-hand products are hidden from the management list by default; the
       Sale screen asks for them (ADR-0013, catalogue noise) */
    includeUsed: z.boolean().optional(),
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
  itemType: ProductItemTypeSchema,
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
  documentId: z.string().nullable(), // link target for the peek
  documentNumber: z.string().nullable(),
  /** "ticket" | "purchase" — which peek the link opens */
  documentType: z.string().nullable(),
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

export const TenderMethodSchema = z.enum(["cash", "card", "bizum", "transfer", "store_credit"]);

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
  /* Used devices differ from each other in the two ways that decide which one
     the cashier hands over, so the picker — not the product tile — is where
     they belong: two phones of the same model are rarely the same grade or the
     same price. Null on new stock, which is priced by its product. */
  grade: DeviceGradeSchema.nullable().default(null),
  salePriceCents: z.number().int().nullable().default(null),
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
  /** required for store_credit: which voucher this pays with */
  voucherId: z.string().nullish(),
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
      /* what the line was sold under. A REBU line prints the regime mention and
         contributes no VAT to the breakdown (ADR-0007 snapshot, ADR-0013 §5). */
      taxRegime: z.string().nullable().default(null),
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
  /** a USB stick or synced folder; "" = local backups only */
  backupSecondaryPath: z.string().max(500),
  /** status, written by the backup runner rather than edited in Ajustes */
  backupLastAtMs: z.number().int(),
  backupLastStatus: z.string().max(300),
  /**
   * Minutes of inactivity before the till locks itself. 0 = never.
   *
   * A counter is not a desk: the screen is left facing the shop while someone
   * fetches a phone from the back, and the lock is what stops the next person
   * selling under the last one's name. Configurable because five minutes is
   * right for a busy Saturday and maddening on a quiet Tuesday (ADR-0012).
   */
  idleLockMinutes: z.number().int().min(0).max(240),
  /* ---- repairs (ADR-0014). All four are the client's pending answers, so they
     land as data the owner edits rather than as code anyone has to change. ---- */
  /** printed on the intake receipt and snapshotted onto every ticket */
  repairWarrantyMonths: z.number().int().min(0).max(60),
  /** 0 = the shop does not charge one. Only chargeable if it was ANNOUNCED */
  repairDiagnosisFeeCents: z.number().int().min(0),
  /** what the deposit field is prefilled with; 0 = ask every time */
  repairDepositSuggestionCents: z.number().int().min(0),
  /** whether the intake screen offers the repair-up-to-cap authorization */
  repairCapEnabled: z.boolean(),
  /** margin the selling-price modal prefills with, in whole percent (ADR-0013) */
  usedMarginPct: z.number().int().min(0).max(500),
  /** dead stock: no completed sale line in this many days (ADR-0016) */
  deadStockDays: z.number().int().min(1).max(3650),
  /* ---- cash (ADR-0015). The client's answers about their own drawer, as data. ---- */
  /** prefilled when opening a shift; the shop can still count something else */
  cashDefaultFloatCents: z.number().int().min(0),
  /** |variance| above this needs an owner's PIN to close. A reason is ALWAYS needed */
  cashVarianceToleranceCents: z.number().int().min(0),
  /** a manual paid-in/out above this runs the approval modal */
  cashMovementApprovalCents: z.number().int().min(0),
  /** one-tap concepts for the movement dialog; free text is always allowed */
  cashConcepts: z.array(z.string().max(80)).max(20),
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
export const SetupStatusResponseSchema = z.object({
  needed: z.boolean(),
  /** shop exists but has no users — a v0.9.0 till that just upgraded (spec I2) */
  ownerNeeded: z.boolean(),
});

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

/* ------------------------------------------------------------- backups --- */

export const BackupStatusRequestSchema = z.object({}).optional();
export const BackupStatusResponseSchema = z.object({
  dir: z.string(),
  databasePath: z.string(),
  lastAtMs: z.number().int(),
  lastStatus: z.string(),
  count: z.number().int(),
  secondaryPath: z.string(),
  keep: z.number().int(),
});
export type BackupStatus = z.infer<typeof BackupStatusResponseSchema>;

export const BackupRunRequestSchema = z.object({}).optional();
export const BackupRunResponseSchema = z.object({
  path: z.string(),
  atMs: z.number().int(),
  sizeBytes: z.number().int(),
  oplogRows: z.number().int(),
  pruned: z.number().int(),
  secondaryPath: z.string().nullable(),
  secondaryError: z.string().nullable(),
});
export type BackupRunResponse = z.infer<typeof BackupRunResponseSchema>;

export const BackupOpenFolderRequestSchema = z.object({}).optional();
export const BackupOpenFolderResponseSchema = z.object({ ok: z.boolean() });

/** Native folder picker for the second destination — typing a path invites typos. */
export const BackupPickFolderRequestSchema = z.object({}).optional();
export const BackupPickFolderResponseSchema = z.object({ path: z.string().nullable() });

/* ------------------------------------------------------ auth (ADR-0012) --- */

export const RoleSchema = z.enum(["owner", "cashier", "technician"]);

/** A PIN in flight. Never stored in a state object, never echoed back. */
export const PinSchema = z.string().regex(/^\d{4,6}$/, "El PIN debe tener entre 4 y 6 dígitos.");

/**
 * All the renderer ever learns about the session. No hash, no overrides map,
 * no recovery code — just who is here and what they may do (ADR-0012 §4).
 */
export const SessionInfoSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.string(),
  permissions: z.array(z.string()),
  /** true while the idle/manual lock overlay should cover everything */
  locked: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** A tile on the Login screen. Deliberately not a user row. */
export const LoginUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  lockedUntilMs: z.number().int().nullable(),
});
export type LoginUser = z.infer<typeof LoginUserSchema>;

export const AuthUsersRequestSchema = z.object({}).optional();
export const AuthUsersResponseSchema = z.array(LoginUserSchema);

export const AuthLoginRequestSchema = z.object({ userId: z.string(), pin: PinSchema });
export const AuthLoginResponseSchema = SessionInfoSchema;

export const AuthSessionRequestSchema = z.object({}).optional();
export const AuthSessionResponseSchema = SessionInfoSchema.nullable();

export const AuthLogoutRequestSchema = z.object({}).optional();
export const AuthLogoutResponseSchema = z.object({ ok: z.boolean(), parkedDocId: z.string().nullable() });

export const AuthLockRequestSchema = z.object({}).optional();
export const AuthLockResponseSchema = z.object({ ok: z.boolean() });

export const AuthUnlockRequestSchema = z.object({ pin: PinSchema });
export const AuthUnlockResponseSchema = SessionInfoSchema;

/** Throttled idle-timer ping. Carries nothing — its arrival is the message. */
export const AuthActivityRequestSchema = z.object({}).optional();
export const AuthActivityResponseSchema = z.object({ ok: z.boolean() });

export const AuthRecoverRequestSchema = z.object({
  userId: z.string(),
  code: z.string().min(8).max(20),
  newPin: PinSchema,
});
export const AuthRecoverResponseSchema = z.object({ recoveryCode: z.string() });

/* ---- users administration (users.manage) ---- */

export const UserRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  active: z.boolean(),
  overrides: z.record(z.string(), z.boolean()),
  lastLoginAtMs: z.number().int().nullable(),
  lockedUntilMs: z.number().int().nullable(),
});
export type UserRow = z.infer<typeof UserRowSchema>;

/** Names a repair can be assigned to — technicians only (ADR-0014 amendment). */
export const UsersTechniciansResponseSchema = z.array(z.object({ id: z.string(), name: z.string() }));
export type TechnicianRef = z.infer<typeof UsersTechniciansResponseSchema>[number];

export const UsersListRequestSchema = z.object({}).optional();
export const UsersListResponseSchema = z.array(UserRowSchema);

export const UsersCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: RoleSchema,
  pin: PinSchema,
  overrides: z.record(z.string(), z.boolean()).default({}),
});
/** A new owner gets a recovery code, shown exactly once (ADR-0012 §8). */
export const UsersCreateResponseSchema = z.object({
  user: UserRowSchema,
  recoveryCode: z.string().nullable(),
});

export const UsersUpdateRequestSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(80).optional(),
  role: RoleSchema.optional(),
  overrides: z.record(z.string(), z.boolean()).optional(),
  active: z.boolean().optional(),
});
export const UsersUpdateResponseSchema = UserRowSchema;

export const UsersResetPinRequestSchema = z.object({
  id: z.string(),
  newPin: PinSchema,
  /** required when changing your OWN pin (ADR-0012 / spec G5) */
  currentPin: PinSchema.optional(),
});
export const UsersResetPinResponseSchema = z.object({ ok: z.boolean() });

/* ---- first-run owner creation ---- */

export const SetupOwnerRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pin: PinSchema,
});
export const SetupOwnerResponseSchema = z.object({
  user: UserRowSchema,
  recoveryCode: z.string(),
});

/** Prints the recovery code on the thermal printer, or falls back to PDF. */
export const AuthPrintRecoveryRequestSchema = z.object({ code: z.string(), name: z.string() });
export const AuthPrintRecoveryResponseSchema = PrintTicketResponseSchema;

/* ---- used devices (ADR-0013) ---- */

/**
 * The gate's database half.
 *
 * Format is checked in the renderer with the same `isValidImei` the rest of
 * the app uses — no round trip to be told a typo is a typo. This channel
 * answers the question the renderer cannot: has this device been through the
 * shop before, as a unit or as a purchase still on hold?
 *
 * `existing` names what was found so the screen can link to it. It carries no
 * seller data: a cashier without `usedDevices.viewSeller` must not learn who
 * sold us a phone by typing its IMEI.
 */
export const UsedImeiConflictSchema = z.object({
  kind: z.enum(["unit", "purchase"]),
  id: z.string(),
  /** what to show on the link — a product name or a purchase number */
  label: z.string(),
});
export type UsedImeiConflict = z.infer<typeof UsedImeiConflictSchema>;

export const UsedCheckImeiRequestSchema = z.object({
  imei: z.string().trim().min(1).max(20),
});
export const UsedCheckImeiResponseSchema = z.object({
  /** false for a bad check digit OR a device already known */
  ok: z.boolean(),
  rejection: z.enum(["format", "duplicate_unit", "duplicate_purchase"]).nullable(),
  existing: UsedImeiConflictSchema.nullable(),
});
export type UsedCheckImeiResponse = z.infer<typeof UsedCheckImeiResponseSchema>;

/* ---- used:log — the purchase, in one transaction ---- */


/**
 * A photo on its way in.
 *
 * The renderer has already resized it to a JPEG data URL, because a purchase id
 * does not exist until the purchase is logged and staging files before then
 * leaks photographs of somebody's ID document for every intake a cashier starts
 * and abandons. Capped so a malformed payload cannot exhaust memory in main.
 */
export const UsedPhotoInputSchema = z.object({
  kind: PhotoKindSchema,
  dataUrl: z
    .string()
    .max(4_000_000)
    .refine((v) => v.startsWith("data:image/jpeg;base64,"), "Solo se aceptan fotos JPEG."),
});

export const UsedDeviceInputSchema = z.object({
  brand: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(80),
  storage: z.string().trim().max(20).nullable().default(null),
  color: z.string().trim().max(40).nullable().default(null),
  grade: DeviceGradeSchema,
  batteryPct: z.number().int().min(0).max(100).nullable().default(null),
  imei: z.string().trim().min(15).max(20),
  accessories: z.object({
    charger: z.boolean(),
    box: z.boolean(),
    cable: z.boolean(),
    case: z.boolean(),
  }),
});

export const UsedSellerInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).nullable().default(null),
  idType: IdDocTypeSchema,
  idNumber: z.string().trim().min(1).max(40),
  channel: AcquisitionChannelSchema.default("private_individual"),
});

export const UsedLogRequestSchema = z.object({
  device: UsedDeviceInputSchema,
  seller: UsedSellerInputSchema,
  photos: z.array(UsedPhotoInputSchema).max(6).default([]),
  buyPriceCents: z.number().int().min(0),
  payout: PayoutMethodSchema,
  payoutReference: z.string().trim().max(80).nullable().default(null),
  barcode: z.string().trim().max(32).nullable().default(null),
  /** the cashier ticked the physical-check box. Main refuses without it (V4). */
  gateConfirmed: z.boolean(),
  action: z.enum(["hold", "inventory"]),
  /** required for action "inventory": what it goes on the shelf at */
  sellPriceCents: z.number().int().min(0).optional(),
  /** carried when a suggested price was overridden — routes through approval */
  reason: z.string().trim().max(200).optional(),
});
export type UsedLogRequest = z.infer<typeof UsedLogRequestSchema>;

export const UsedLogResponseSchema = z.object({
  purchaseId: z.string(),
  docNumber: z.string(),
  unitId: z.string(),
  productId: z.string(),
  voucherId: z.string().nullable(),
  status: z.enum(["held", "in_stock"]),
});
export type UsedLogResponse = z.infer<typeof UsedLogResponseSchema>;

/** Print (or reprint) a purchase document and its shelf label. */
export const UsedPrintRequestSchema = z.object({
  purchaseId: z.string(),
  what: z.enum(["document", "label"]),
  target: z.enum(["auto", "pdf"]).default("auto"),
  /** a reprint stamps COPIA and needs usedDevices.viewSeller (ADR-0013 §6) */
  copy: z.boolean().default(false),
});
export type UsedPrintRequest = z.infer<typeof UsedPrintRequestSchema>;
export const UsedPrintResponseSchema = PrintTicketResponseSchema;

/* ---- the used-devices screen ---- */

/** Derived, never stored — the chip can never disagree with the unit. */
export const UsedDeviceStateSchema = z.enum(["held", "needs_review", "in_stock", "sold"]);

export const UsedDeviceRowSchema = z.object({
  purchaseId: z.string(),
  docNumber: z.string(),
  unitId: z.string().nullable(),
  brand: z.string(),
  model: z.string(),
  storage: z.string().nullable(),
  color: z.string().nullable(),
  grade: DeviceGradeSchema,
  imei: z.string(),
  barcode: z.string().nullable(),
  purchasedAtMs: z.number(),
  buyPriceCents: z.number().int(),
  refurbCostCents: z.number().int(),
  state: UsedDeviceStateSchema,
  /** the shelf price, once it has one */
  sellPriceCents: z.number().int().nullable(),
  /** the sale that sold it, for the link on a sold row */
  soldDocumentId: z.string().nullable(),
  soldDocNumber: z.string().nullable(),
});
export type UsedDeviceRow = z.infer<typeof UsedDeviceRowSchema>;

export const UsedListRequestSchema = z
  .object({
    state: UsedDeviceStateSchema.optional(),
    /** IMEI, model, purchase number or barcode — one box, like the rest of the app */
    search: z.string().trim().max(60).optional(),
  })
  .optional();

export const UsedListResponseSchema = z.object({
  rows: z.array(UsedDeviceRowSchema),
  /** the counts strip: every state, whatever the current filter */
  counts: z.object({
    held: z.number().int(),
    needs_review: z.number().int(),
    in_stock: z.number().int(),
    sold: z.number().int(),
  }),
});

export const UsedPhotoSchema = z.object({
  id: z.string(),
  kind: PhotoKindSchema,
  /** a data URL: the renderer never reads the disk (system-design §2) */
  dataUrl: z.string(),
});

/**
 * The seller block.
 *
 * Absent from the payload — not merely hidden — for anyone without
 * usedDevices.viewSeller (ADR-0012 §5, ADR-0013 §6). A field the renderer never
 * receives cannot be leaked by a CSS mistake or an inspector.
 */
export const UsedSellerBlockSchema = z.object({
  name: z.string(),
  phone: z.string().nullable(),
  idType: IdDocTypeSchema,
  idNumber: z.string(),
  channel: AcquisitionChannelSchema,
});

export const UsedTimelineEntrySchema = z.object({
  atMs: z.number(),
  entity: z.string(),
  action: z.string(),
  actorName: z.string().nullable(),
  approverName: z.string().nullable(),
});

export const UsedDeviceDetailSchema = UsedDeviceRowSchema.extend({
  batteryPct: z.number().int().nullable(),
  accessories: z.object({
    charger: z.boolean(),
    box: z.boolean(),
    cable: z.boolean(),
    case: z.boolean(),
  }),
  payout: PayoutMethodSchema,
  payoutReference: z.string().nullable(),
  voucher: z
    .object({ id: z.string(), status: VoucherStatusSchema, amountCents: z.number().int() })
    .nullable(),
  unitCostCents: z.number().int(),
  needsReview: z.boolean(),
  /** true while the device is still held: refurb cost is editable only then */
  editable: z.boolean(),
  photos: z.array(UsedPhotoSchema),
  /** present only with usedDevices.viewSeller */
  seller: UsedSellerBlockSchema.nullable(),
  canViewSeller: z.boolean(),
  timeline: z.array(UsedTimelineEntrySchema),
});
export type UsedDeviceDetail = z.infer<typeof UsedDeviceDetailSchema>;

export const UsedGetRequestSchema = z.object({ purchaseId: z.string() });

export const UsedSetReviewRequestSchema = z.object({
  purchaseId: z.string(),
  needsReview: z.boolean(),
});

export const UsedSetRefurbCostRequestSchema = z.object({
  purchaseId: z.string(),
  refurbCostCents: z.number().int().min(0),
});

export const UsedSendToInventoryRequestSchema = z.object({
  purchaseId: z.string(),
  sellPriceCents: z.number().int().min(1),
  /**
   * Somebody has looked at the review flag and is shelving it anyway.
   *
   * A flagged device refuses with `REVIEW_REQUIRED` until this is true, and the
   * confirmation is recorded in the same transaction that clears the flag — so
   * "who decided this was fine" is answerable afterwards (ADR-0013 amendment).
   */
  reviewConfirmed: z.boolean().default(false),
});
export const UsedSendToInventoryResponseSchema = z.object({
  unitId: z.string(),
  sellPriceCents: z.number().int(),
  unitCostCents: z.number().int(),
});

/* ---- the voucher finder (Sale screen) ---- */

export const VoucherRowSchema = z.object({
  id: z.string(),
  /** the purchase it came from — what is printed on the slip the customer holds */
  docNumber: z.string(),
  amountCents: z.number().int(),
  remainingCents: z.number().int(),
  status: VoucherStatusSchema,
  issuedAtMs: z.number(),
  /**
   * Present only with usedDevices.viewSeller. The handoff drew the seller's name
   * in the finder; that would have made this box a way to read the second-hand
   * register, so the number on the slip is the identification and the name is a
   * courtesy for those already allowed to see it.
   */
  sellerName: z.string().nullable(),
});
export type VoucherRow = z.infer<typeof VoucherRowSchema>;

export const UsedFindVoucherRequestSchema = z.object({
  /** a purchase number, a scanned slip, or part of one */
  search: z.string().trim().min(1).max(60),
  /** the ticket it would pay for: an oversized voucher is refused, not part-spent */
  saleTotalCents: z.number().int().min(0),
});
export const UsedFindVoucherResponseSchema = z.object({
  rows: z.array(VoucherRowSchema.extend({ refusal: z.enum(["not_issued", "empty"]).nullable() })),
});

export const UsedVoidVoucherRequestSchema = z.object({
  voucherId: z.string(),
  reason: z.string().trim().min(1).max(200),
});
export const UsedVoidVoucherResponseSchema = z.object({ ok: z.boolean() });

/** The purchase document as it prints, for reading on screen. */
export const UsedPeekRequestSchema = z.object({
  /** either identifier: the movements drawer has the document, the list has the purchase */
  purchaseId: z.string().optional(),
  documentId: z.string().optional(),
});
/**
 * The purchase, as the screen shows it.
 *
 * Deliberately NOT the printed document. The sale ticket's peek is a structured
 * summary — labelled rows, aligned money, the app's own type — and a purchase
 * opened from the same drawer should read the same way. A monospaced copy of the
 * receipt was the first attempt and it made one link in that drawer open a
 * screen and the other open a picture of paper.
 *
 * The declaration and the signature rule are absent on purpose: they exist so a
 * person can sign them, and nobody signs a screen. Reimprimir is right there for
 * when the paper is what is wanted.
 */
export const UsedPeekResponseSchema = z.object({
  purchaseId: z.string(),
  docNumber: z.string(),
  purchasedAtMs: z.number(),
  cashierName: z.string(),
  device: z.object({
    brand: z.string(),
    model: z.string(),
    storage: z.string().nullable(),
    color: z.string().nullable(),
    grade: DeviceGradeSchema,
    batteryPct: z.number().int().nullable(),
    imei: z.string(),
    /** the ones that came with it, already filtered */
    accessories: z.array(z.enum(["charger", "box", "cable", "case"])),
  }),
  seller: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    idType: IdDocTypeSchema,
    idNumber: z.string(),
  }),
  buyPriceCents: z.number().int(),
  payout: PayoutMethodSchema,
  payoutReference: z.string().nullable(),
  voucher: z
    .object({ amountCents: z.number().int(), status: VoucherStatusSchema, remainingCents: z.number().int() })
    .nullable(),
});
export type UsedPeek = z.infer<typeof UsedPeekResponseSchema>;

/* ---- repairs (ADR-0014) ---- */

export const RepairStatusSchema = z.enum([
  "received",
  "quoted",
  "waiting_part",
  "in_repair",
  "ready",
  "collected",
  "not_repaired",
]);
export const RepairLineKindSchema = z.enum(["inventory_part", "labor", "part_on_order"]);
export const RepairApprovalMethodSchema = z.enum(["in_person", "by_phone"]);
export const RepairNotifyMethodSchema = z.enum(["phone", "in_person", "other"]);
export const NotRepairedReasonSchema = z.enum(["customer_declined", "unrepairable", "abandoned"]);
export const PromisedHalfSchema = z.enum(["morning", "afternoon"]);

/* ---- customers ---- */

export const CustomerRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  note: z.string().nullable(),
  /** how many repairs this person has left with the shop — context at the counter */
  repairCount: z.number().int().default(0),
});
export type CustomerRow = z.infer<typeof CustomerRowSchema>;

export const CustomerSearchRequestSchema = z.object({ query: z.string().trim().max(60) });
export const CustomerSearchResponseSchema = z.object({ rows: z.array(CustomerRowSchema) });

export const CustomerUpsertRequestSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(1).max(40),
  note: z.string().trim().max(300).nullish(),
});
export const CustomerUpsertResponseSchema = CustomerRowSchema;
export type CustomerUpsertRequest = z.infer<typeof CustomerUpsertRequestSchema>;

/* ---- intake ---- */

export const RepairDamageSchema = z.object({
  screen: z.boolean(),
  back: z.boolean(),
  dents: z.boolean(),
  water: z.boolean(),
});

export const RepairDocDeviceSchema = z.object({
  description: z.string(),
  imei: z.string().nullable(),
  reportedFault: z.string(),
  conditionAtIntake: z.string().nullable(),
  damage: RepairDamageSchema,
  damageNote: z.string().nullable(),
  accessories: z.string().nullable(),
});

export const RepairCreateRequestSchema = z.object({
  customerId: z.string(),
  deviceDescription: z.string().trim().min(1).max(200),
  /** optional: not every device has one, and a receipt is not the place to insist */
  imei: z.string().trim().max(20).nullish(),
  reportedFault: z.string().trim().min(1).max(500),
  conditionAtIntake: z.string().trim().max(500).nullish(),
  damage: RepairDamageSchema,
  damageNote: z.string().trim().max(300).nullish(),
  accessories: z.string().trim().max(200).nullish(),
  /**
   * The device's own passcode.
   *
   * Travels in on this one channel and never travels back out anywhere it could
   * be printed or logged (ADR-0014 §10).
   */
  devicePasscode: z.string().max(80).nullish(),
  photos: z.array(UsedPhotoInputSchema).max(6).default([]),
  promisedDate: z.number().int().nullish(),
  promisedHalf: PromisedHalfSchema.nullish(),
  depositCents: z.number().int().min(0).default(0),
  /* how it was taken. The sale's tenders minus store credit: a voucher is money
     the shop already owes, and holding a deposit in credit would owe it twice. */
  depositMethod: DepositMethodSchema.default("cash"),
  authorizedCapCents: z.number().int().min(0).nullish(),
  assignedUserId: z.string().nullish(),
});

export const RepairCreateResponseSchema = z.object({
  ticketId: z.string(),
  docNumber: z.string(),
  customerName: z.string(),
  depositCents: z.number().int(),
});
export type RepairCreateRequest = z.infer<typeof RepairCreateRequestSchema>;
export type RepairCreateResponse = z.infer<typeof RepairCreateResponseSchema>;

/** Print (or reprint) one of the repair documents. */
export const RepairPrintRequestSchema = z.object({
  ticketId: z.string(),
  what: z.enum(["intake", "quote", "receipt", "return"]),
  target: z.enum(["auto", "pdf"]).default("auto"),
  copy: z.boolean().default(false),
});
/* ---- the ticket as the screen sees it ---- */

export const RepairLineRowSchema = z.object({
  id: z.string(),
  kind: RepairLineKindSchema,
  productId: z.string().nullable(),
  description: z.string(),
  qty: z.number().int(),
  /** snapshot from when the part was taken; the charge moves, this does not */
  unitCostCents: z.number().int().nullable(),
  chargeCents: z.number().int(),
  supplierText: z.string().nullable(),
  expectedCostCents: z.number().int().nullable(),
  orderedAt: z.number().int().nullable(),
  receivedAt: z.number().int().nullable(),
});
export type RepairLineRow = z.infer<typeof RepairLineRowSchema>;

export const RepairApprovalRowSchema = z.object({
  id: z.string(),
  method: RepairApprovalMethodSchema,
  approvedTotalCents: z.number().int(),
  userName: z.string().nullable(),
  createdAt: z.number().int(),
});

export const RepairNotificationRowSchema = z.object({
  id: z.string(),
  method: RepairNotifyMethodSchema,
  note: z.string().nullable(),
  userName: z.string().nullable(),
  createdAt: z.number().int(),
});

/**
 * A photo REFERENCE, not the photo.
 *
 * Every mutation on this screen returns the whole detail, and shipping four
 * base64 JPEGs back on each charge edit would be a megabyte per keystroke-ish
 * action for pictures that never change. The images come once, from
 * `repair:photos`, when the screen opens.
 */
export const RepairPhotoRefSchema = z.object({ id: z.string(), kind: PhotoKindSchema });

export const RepairRefusalSchema = z.enum([
  "terminal",
  "no_lines",
  "not_authorized",
  "waiting_part",
  "already_ready",
  "not_ready",
  "unresolved_parts",
  "no_reason",
]);

/** Which actions the facts allow, and the reason when they do not. */
export const RepairActionsSchema = z.object({
  quote: RepairRefusalSchema.nullable(),
  approve: RepairRefusalSchema.nullable(),
  receive_part: RepairRefusalSchema.nullable(),
  mark_ready: RepairRefusalSchema.nullable(),
  collect: RepairRefusalSchema.nullable(),
  mark_not_repaired: RepairRefusalSchema.nullable(),
});

export const RepairDetailSchema = z.object({
  id: z.string(),
  docNumber: z.string(),
  documentId: z.string(),
  status: RepairStatusSchema,

  customer: z.object({
    id: z.string(),
    name: z.string(),
    phone: z.string(),
    note: z.string().nullable(),
  }),

  device: RepairDocDeviceSchema,
  /**
   * The device's own passcode — the technician cannot open the phone without it.
   *
   * It reaches the SCREEN and nothing else: no print payload carries it, no
   * oplog entry records it, and the UI masks it behind a tap (ADR-0014 §10).
   */
  devicePasscode: z.string().nullable(),

  promisedAt: z.number().int().nullable(),
  promisedHalf: PromisedHalfSchema.nullable(),
  assignedUserId: z.string().nullable(),
  assignedUserName: z.string().nullable(),

  depositCents: z.number().int(),
  authorizedCapCents: z.number().int().nullable(),
  diagnosisFeeCents: z.number().int(),
  warrantyMonths: z.number().int(),

  readyAt: z.number().int().nullable(),
  notRepairedAt: z.number().int().nullable(),
  notRepairedReason: NotRepairedReasonSchema.nullable(),
  collectionDocumentId: z.string().nullable(),
  collectionDocNumber: z.string().nullable(),

  createdAt: z.number().int(),
  updatedAt: z.number().int(),

  lines: z.array(RepairLineRowSchema),
  approvals: z.array(RepairApprovalRowSchema),
  notifications: z.array(RepairNotificationRowSchema),
  photos: z.array(RepairPhotoRefSchema),

  /* ---- derived in core, sent down so the screen never re-derives it ---- */
  quoteTotalCents: z.number().int(),
  margin: z.object({
    costCents: z.number().int(),
    chargeCents: z.number().int(),
    marginCents: z.number().int(),
    marginPct: z.number().nullable(),
  }),
  authorization: z.object({
    authorized: z.boolean(),
    source: z.enum(["approval", "cap"]).nullable(),
    coveredCents: z.number().int(),
  }),
  overdue: z.boolean(),
  actions: RepairActionsSchema,
});
export type RepairDetail = z.infer<typeof RepairDetailSchema>;

export const RepairGetRequestSchema = z.object({ ticketId: z.string() });

/* ---- quote lines ---- */

export const RepairAddLineRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("labor"),
    ticketId: z.string(),
    description: z.string().trim().min(1).max(200),
    chargeCents: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("inventory_part"),
    ticketId: z.string(),
    productId: z.string(),
    qty: z.number().int().min(1).max(99),
    /** blank = the shop's sale price for that product, which is the usual answer */
    chargeCents: z.number().int().min(0).nullish(),
  }),
  z.object({
    kind: z.literal("part_on_order"),
    ticketId: z.string(),
    description: z.string().trim().min(1).max(200),
    qty: z.number().int().min(1).max(99),
    supplierText: z.string().trim().max(120).nullish(),
    expectedCostCents: z.number().int().min(0).nullish(),
    chargeCents: z.number().int().min(0),
  }),
]);
export type RepairAddLineRequest = z.infer<typeof RepairAddLineRequestSchema>;

export const RepairRemoveLineRequestSchema = z.object({
  ticketId: z.string(),
  lineId: z.string(),
});

export const RepairSetLineChargeRequestSchema = z.object({
  ticketId: z.string(),
  lineId: z.string(),
  chargeCents: z.number().int().min(0),
  /**
   * Why the charge is going DOWN after the customer already approved it.
   *
   * Required only in that direction, and enforced in main: the customer agreed
   * to a number, and settling quietly below it is money nobody can account for
   * (ADR-0014 §9a).
   */
  reason: z.string().trim().max(200).nullish(),
});

export const RepairRecordApprovalRequestSchema = z.object({
  ticketId: z.string(),
  method: RepairApprovalMethodSchema,
});

export const RepairReceivePartRequestSchema = z.object({
  ticketId: z.string(),
  lineId: z.string(),
  /** what it actually cost, which is rarely exactly what was expected */
  unitCostCents: z.number().int().min(0),
  qty: z.number().int().min(1).max(99),
  /** which catalogue article it is, when the ordered line named none */
  productId: z.string().nullish(),
});

/** Every open ordered line across every ticket — the buying list. */
export const OrderedPartRowSchema = z.object({
  lineId: z.string(),
  ticketId: z.string(),
  docNumber: z.string(),
  customerName: z.string(),
  deviceDescription: z.string(),
  description: z.string(),
  qty: z.number().int(),
  supplierText: z.string().nullable(),
  expectedCostCents: z.number().int().nullable(),
  orderedAt: z.number().int().nullable(),
  promisedAt: z.number().int().nullable(),
  /** whole days since it was ordered — the column that sorts this screen */
  daysWaiting: z.number().int(),
});
export type OrderedPartRow = z.infer<typeof OrderedPartRowSchema>;

export const RepairPartsToOrderRequestSchema = z.object({}).optional();
export const RepairPartsToOrderResponseSchema = z.object({ rows: z.array(OrderedPartRowSchema) });

/* ---- the list ---- */

export const RepairListRowSchema = z.object({
  ticketId: z.string(),
  docNumber: z.string(),
  status: RepairStatusSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  deviceDescription: z.string(),
  imei: z.string().nullable(),
  reportedFault: z.string(),
  technicianName: z.string().nullable(),
  promisedAt: z.number().int().nullable(),
  promisedHalf: PromisedHalfSchema.nullable(),
  createdAt: z.number().int(),
  /** whole days since the device came in — the column a shop actually scans */
  daysOpen: z.number().int(),
  overdue: z.boolean(),
  quoteTotalCents: z.number().int(),
});
export type RepairListRow = z.infer<typeof RepairListRowSchema>;

export const RepairListRequestSchema = z
  .object({
    status: RepairStatusSchema.nullish(),
    technicianId: z.string().nullish(),
    /** the literal "none" asks for the unassigned ones, which is a real filter */
    unassignedOnly: z.boolean().nullish(),
    overdueOnly: z.boolean().nullish(),
    search: z.string().trim().max(80).nullish(),
  })
  .optional();

export const RepairListResponseSchema = z.object({
  rows: z.array(RepairListRowSchema),
  /** over EVERYTHING, whatever the filter — otherwise the strip is a maze */
  counts: z.record(RepairStatusSchema, z.number().int()),
  openCount: z.number().int(),
});

/* ---- photos, fetched once when the ficha opens ---- */

export const RepairPhotosRequestSchema = z.object({ ticketId: z.string() });
export const RepairPhotosResponseSchema = z.object({
  photos: z.array(z.object({ id: z.string(), kind: PhotoKindSchema, dataUrl: z.string() })),
});

/**
 * Looking at the passcode.
 *
 * Returns nothing but `ok`: the value already travelled down with the ficha, and
 * a channel that returns it again would be a second place to leak it from. What
 * this call is FOR is the oplog entry — who looked, and when. The reveal is the
 * record (ADR-0014 §10).
 */
export const RepairRevealPasscodeRequestSchema = z.object({ ticketId: z.string() });
export const RepairRevealPasscodeResponseSchema = z.object({ ok: z.boolean() });

/* ---- editing what was taken down at the counter ---- */

export const RepairEditRequestSchema = z.object({
  ticketId: z.string(),
  deviceDescription: z.string().trim().min(1).max(200).optional(),
  imei: z.string().trim().max(20).nullish(),
  reportedFault: z.string().trim().min(1).max(500).optional(),
  conditionAtIntake: z.string().trim().max(500).nullish(),
  damage: RepairDamageSchema.optional(),
  damageNote: z.string().trim().max(300).nullish(),
  accessories: z.string().trim().max(200).nullish(),
  devicePasscode: z.string().max(80).nullish(),
  promisedDate: z.number().int().nullish(),
  promisedHalf: PromisedHalfSchema.nullish(),
});

export const RepairAssignRequestSchema = z.object({
  ticketId: z.string(),
  /** null is *Sin asignar*, which is a state and not an absence */
  userId: z.string().nullable(),
});

/* ---- the board ---- */

export const BoardCardSchema = z.object({
  ticketId: z.string(),
  docNumber: z.string(),
  deviceDescription: z.string(),
  reportedFault: z.string(),
  customerName: z.string(),
  technicianName: z.string().nullable(),
  promisedAt: z.number().int().nullable(),
  promisedHalf: PromisedHalfSchema.nullable(),
  overdue: z.boolean(),
  /** days in the CURRENT status, which is what a board is asking about */
  daysInStatus: z.number().int(),
});

export const WorkshopBoardRequestSchema = z
  .object({ technicianId: z.string().nullish(), unassignedOnly: z.boolean().nullish() })
  .optional();

export const WorkshopBoardResponseSchema = z.object({
  columns: z.array(z.object({ status: RepairStatusSchema, cards: z.array(BoardCardSchema) })),
  openCount: z.number().int(),
});
export type WorkshopBoard = z.infer<typeof WorkshopBoardResponseSchema>;

/* ---- the peek, for the Documento link on a repair_part_out movement ---- */

export const RepairPeekRequestSchema = z.object({ ticketId: z.string() });
export const RepairPeekSchema = z.object({
  ticketId: z.string(),
  docNumber: z.string(),
  status: RepairStatusSchema,
  createdAt: z.number().int(),
  customerName: z.string(),
  customerPhone: z.string(),
  deviceDescription: z.string(),
  imei: z.string().nullable(),
  reportedFault: z.string(),
  technicianName: z.string().nullable(),
  lines: z.array(
    z.object({
      kind: RepairLineKindSchema,
      description: z.string(),
      qty: z.number().int(),
      chargeCents: z.number().int(),
    }),
  ),
  totalCents: z.number().int(),
  depositCents: z.number().int(),
});
export type RepairPeek = z.infer<typeof RepairPeekSchema>;

/* ---- hand-back ---- */

export const RepairMarkReadyRequestSchema = z.object({ ticketId: z.string() });

export const RepairNotifyRequestSchema = z.object({
  ticketId: z.string(),
  method: RepairNotifyMethodSchema,
  note: z.string().trim().max(300).nullish(),
});

/**
 * Cobro y entrega.
 *
 * No total in the payload. The collection settles at exactly the ticket's
 * charged total (ADR-0014 §9a): a number typed into a payment dialog would mean
 * the document says one thing and the ticket says another, with the difference
 * invisible. The deposit is applied by main as a `deposit` tender — it is not
 * in this list, and it is not removable.
 */
export const RepairCollectRequestSchema = z.object({
  ticketId: z.string(),
  tenders: z.array(SaleTenderSchema).default([]),
});

export const RepairCollectResponseSchema = z.object({
  docId: z.string(),
  docNumber: z.string(),
  totalCents: z.number().int(),
  depositAppliedCents: z.number().int(),
  changeCents: z.number().int(),
});
export type RepairCollectResponse = z.infer<typeof RepairCollectResponseSchema>;

/**
 * Closing a ticket without repairing the device.
 *
 * Every consumed part must be resolved before this can run — returned to the
 * shelf or charged for. A part that went into a device does not simply vanish
 * when the ticket closes (ADR-0014 §3), and this is the one place the UI blocks
 * on bookkeeping.
 */
export const RepairMarkNotRepairedRequestSchema = z.object({
  ticketId: z.string(),
  reason: NotRepairedReasonSchema,
  resolutions: z
    .array(z.object({ lineId: z.string(), action: z.enum(["return", "charge"]) }))
    .default([]),
  depositAction: z.enum(["refund", "apply_fee"]).default("refund"),
  /** how the money goes back; defaults to however it was taken */
  refundMethod: DepositMethodSchema.optional(),
  /** refused unless the intake snapshot is non-zero — a fee not announced, not charged */
  chargeDiagnosisFee: z.boolean().default(false),
});

export const RepairMarkNotRepairedResponseSchema = z.object({
  detail: RepairDetailSchema,
  diagnosisFeeCents: z.number().int(),
  depositAppliedCents: z.number().int(),
  depositRefundedCents: z.number().int(),
  dueCents: z.number().int(),
});
export type RepairMarkNotRepairedResponse = z.infer<typeof RepairMarkNotRepairedResponseSchema>;

export const RepairPrintResponseSchema = PrintTicketResponseSchema;
export type RepairPrintRequest = z.infer<typeof RepairPrintRequestSchema>;

/* ============================ cash / shifts (ADR-0015) ============================ */

/**
 * A denomination count: quantities keyed by the coin or note's value in cents.
 *
 * The total is the stored authority and this is the evidence for it, so the
 * domain refuses a pair that disagrees (`assertBreakdownMatches`). Two numbers
 * that can drift is what this design rejects everywhere else.
 */
export const BreakdownSchema = z.record(z.string(), z.number().int().min(0));

export const ShiftStateSchema = z.object({
  id: z.string(),
  zDocNumber: z.string().nullable(),
  openedAtMs: z.number().int(),
  openedByName: z.string().nullable(),
  openingFloatCents: z.number().int(),
  openingBreakdown: BreakdownSchema.nullable(),
  closedAtMs: z.number().int().nullable(),
  closedByName: z.string().nullable(),
  countedCashCents: z.number().int().nullable(),
  expectedCashCents: z.number().int().nullable(),
  varianceCents: z.number().int().nullable(),
  varianceReason: z.string().nullable(),
  approvedByName: z.string().nullable(),
  /** hours the shift has been open — the top bar warns past 20 (handoff) */
  openHours: z.number(),
});
export type ShiftState = z.infer<typeof ShiftStateSchema>;

export const CashCurrentResponseSchema = ShiftStateSchema.nullable();

export const CashOpenRequestSchema = z.object({
  floatCents: z.number().int().min(0),
  breakdown: BreakdownSchema.nullable().default(null),
});

/* ---- the figures, shared by the X preview, the close and the stored Z ---- */

const MethodAmountSchema = z.object({ method: z.string(), amountCents: z.number().int() });
const MethodCountSchema = z.object({ method: z.string(), count: z.number().int(), amountCents: z.number().int() });

export const ShiftTotalsSchema = z.object({
  openingFloatCents: z.number().int(),
  salesCashCents: z.number().int(),
  movementsCashCents: z.number().int(),
  expectedCashCents: z.number().int(),

  netSalesCents: z.number().int(),
  taxCents: z.number().int(),
  usedSalesCents: z.number().int(),
  grossSalesCents: z.number().int(),

  tendersByMethod: z.array(MethodAmountSchema),
  tendersTotalCents: z.number().int(),
  /** non-zero means the till has a bug, and the Z prints it rather than hiding it */
  tenderImbalanceCents: z.number().int(),

  movementsByReason: z.array(
    z.object({ reason: z.string(), count: z.number().int(), amountCents: z.number().int() }),
  ),
  depositsByMethod: z.array(MethodCountSchema),
  refundsByMethod: z.array(MethodCountSchema),
  payoutsByMethod: z.array(MethodCountSchema),
  byMethod: z.array(
    z.object({
      method: z.string(),
      inCents: z.number().int(),
      outCents: z.number().int(),
      netCents: z.number().int(),
    }),
  ),

  series: z.array(
    z.object({
      docType: z.string(),
      count: z.number().int(),
      firstNumber: z.string().nullable(),
      lastNumber: z.string().nullable(),
    }),
  ),
  usedPurchaseCount: z.number().int(),
  repairsCollectedCount: z.number().int(),
  parkedCount: z.number().int(),
});
export type ShiftTotalsPayload = z.infer<typeof ShiftTotalsSchema>;

/** The X: the same figures a close would freeze, plus who would be freezing them. */
export const CashPreviewResponseSchema = z.object({
  shift: ShiftStateSchema,
  totals: ShiftTotalsSchema,
});
export type CashPreviewResponse = z.infer<typeof CashPreviewResponseSchema>;

export const CashCloseRequestSchema = z.object({
  countedCents: z.number().int().min(0),
  breakdown: BreakdownSchema.nullable().default(null),
  /** required for ANY non-zero variance, not merely a large one (ADR-0015 §10) */
  reason: z.string().max(300).nullable().default(null),
});

export const CashCloseResponseSchema = z.object({
  shiftId: z.string(),
  zDocNumber: z.string(),
  countedCents: z.number().int(),
  expectedCents: z.number().int(),
  varianceCents: z.number().int(),
});
export type CashCloseResponse = z.infer<typeof CashCloseResponseSchema>;

/* ---- movements ---- */

export const CashMovementRowSchema = z.object({
  id: z.string(),
  atMs: z.number().int(),
  reason: z.string(),
  /** false for repair_deposit_applied: it is bookkeeping, not a drawer event */
  movesCash: z.boolean(),
  amountCents: z.number().int(),
  concept: z.string().nullable(),
  userName: z.string().nullable(),
  documentId: z.string().nullable(),
  docNumber: z.string().nullable(),
  ticketId: z.string().nullable(),
  /** what the Concepto column shows for an automatic row */
  label: z.string(),
});
export type CashMovementRow = z.infer<typeof CashMovementRowSchema>;

export const CashMovementsRequestSchema = z.object({ shiftId: z.string().optional() });
export const CashMovementsResponseSchema = z.object({
  rows: z.array(CashMovementRowSchema),
  inCents: z.number().int(),
  outCents: z.number().int(),
  netCents: z.number().int(),
});
export type CashMovementsResponse = z.infer<typeof CashMovementsResponseSchema>;

/** Always positive: the channel decides the sign, never a minus the cashier typed. */
export const CashManualRequestSchema = z.object({
  amountCents: z.number().int().positive(),
  concept: z.string().trim().min(1).max(200),
});

/* ---- history ---- */

export const ShiftListRowSchema = z.object({
  id: z.string(),
  zDocNumber: z.string().nullable(),
  openedAtMs: z.number().int(),
  closedAtMs: z.number().int().nullable(),
  openedByName: z.string().nullable(),
  closedByName: z.string().nullable(),
  expectedCashCents: z.number().int().nullable(),
  countedCashCents: z.number().int().nullable(),
  varianceCents: z.number().int().nullable(),
  approvedByName: z.string().nullable(),
});
export type ShiftListRow = z.infer<typeof ShiftListRowSchema>;

export const CashHistoryRequestSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) });
export const CashHistoryResponseSchema = z.object({ rows: z.array(ShiftListRowSchema) });

export const CashGetRequestSchema = z.object({ shiftId: z.string() });
/** The STORED snapshot, never a recomputation (ADR-0015 §7). */
export const CashGetResponseSchema = z.object({
  shift: ShiftStateSchema,
  totals: ShiftTotalsSchema.nullable(),
  movements: z.array(CashMovementRowSchema),
});
export type CashGetResponse = z.infer<typeof CashGetResponseSchema>;

export const CashPrintRequestSchema = z.object({
  shiftId: z.string().optional(),
  what: z.enum(["z", "x"]),
  /** the staff language at the moment of printing (ADR-0015 amendment) */
  locale: z.enum(["es", "en"]).default("es"),
  target: z.enum(["auto", "pdf"]).default("auto"),
  copy: z.boolean().default(false),
});

/* ============================== reports (ADR-0016) ============================== */

export const DatePresetSchema = z.enum(["today", "yesterday", "week", "month", "lastMonth", "custom"]);
export const SalesGroupBySchema = z.enum(["day", "group", "product", "user", "method"]);

/** Half-open [from, to) on local day boundaries (ADR-0016 §5). */
export const DateRangeSchema = z.object({
  fromMs: z.number().int(),
  toMs: z.number().int(),
});

/**
 * How much of a cost figure was a guess.
 *
 * Present on every cost-bearing response, so a margin can never be read — or
 * exported — without whether it was estimated (ADR-0016 §2).
 */
export const CostEstimateSchema = z.object({
  exactLines: z.number().int(),
  estimatedLines: z.number().int(),
});

export const ReportsHubResponseSchema = z.object({
  salesNetCents: z.number().int(),
  repairsOpen: z.number().int(),
  repairsOverdue: z.number().int(),
  usedUnits: z.number().int().nullable(),
  usedCostCents: z.number().int().nullable(),
  valuationCents: z.number().int().nullable(),
  deadStockCount: z.number().int().nullable(),
  thresholdDays: z.number().int(),
});
export type ReportsHubResponse = z.infer<typeof ReportsHubResponseSchema>;

/* ---- sales ---- */

export const ReportsSalesRequestSchema = DateRangeSchema.extend({
  shiftId: z.string().nullable().default(null),
  groupBy: SalesGroupBySchema.default("day"),
});

export const SalesReportRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  qty: z.number().int(),
  netCents: z.number().int(),
  taxCents: z.number().int(),
  grossCents: z.number().int(),
  /* absent for a caller without reports.costs; NULL when the row contains a
     line written before v0.14.0, whose cost the till never recorded */
  estimated: z.boolean().optional(),
  costCents: z.number().int().nullable().optional(),
  marginCents: z.number().int().nullable().optional(),
  marginPct: z.number().nullable().optional(),
});
export type SalesReportRow = z.infer<typeof SalesReportRowSchema>;

export const ReportsSalesResponseSchema = z.object({
  summary: z.object({
    tickets: z.number().int(),
    netCents: z.number().int(),
    taxCents: z.number().int(),
    grossCents: z.number().int(),
    averageTicketCents: z.number().int(),
    usedSalesCents: z.number().int(),
  }),
  rows: z.array(SalesReportRowSchema),
  estimate: CostEstimateSchema.nullable(),
  withCosts: z.boolean(),
  shifts: z.array(z.object({ id: z.string(), zDocNumber: z.string().nullable(), atMs: z.number().int() })),
});
export type ReportsSalesResponse = z.infer<typeof ReportsSalesResponseSchema>;

export const ReportsSalesDetailRequestSchema = DateRangeSchema.extend({
  shiftId: z.string().nullable().default(null),
  kind: z.enum(["day", "user", "product"]),
  key: z.string(),
});
export const ReportsSalesDetailResponseSchema = z.object({
  rows: z.array(
    z.object({
      documentId: z.string(),
      docNumber: z.string().nullable(),
      atMs: z.number().int().nullable(),
      description: z.string(),
      qty: z.number().int(),
      totalCents: z.number().int(),
    }),
  ),
});
export type ReportsSalesDetailResponse = z.infer<typeof ReportsSalesDetailResponseSchema>;

/* ---- repairs ---- */

export const ReportsRepairsOpenRequestSchema = z.object({
  status: z.string().nullable().default(null),
  technicianId: z.string().nullable().default(null),
});
export const ReportsRepairsOpenResponseSchema = z.object({
  summary: z.object({
    open: z.number().int(),
    overdue: z.number().int(),
    waitingOnCustomer: z.number().int(),
    oldest: z.object({ docNumber: z.string().nullable(), days: z.number().int() }).nullable(),
  }),
  rows: z.array(
    z.object({
      ticketId: z.string(),
      docNumber: z.string().nullable(),
      customerName: z.string(),
      device: z.string(),
      status: z.string(),
      daysInStatus: z.number().int(),
      daysSinceIntake: z.number().int(),
      technicianName: z.string().nullable(),
      promisedAtMs: z.number().int().nullable(),
      promisedHalf: z.string().nullable(),
      overdue: z.boolean(),
    }),
  ),
  technicians: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type ReportsRepairsOpenResponse = z.infer<typeof ReportsRepairsOpenResponseSchema>;

export const ReportsRepairsClosedRequestSchema = DateRangeSchema.extend({
  byTechnician: z.boolean().default(false),
});
export const ReportsRepairsClosedResponseSchema = z.object({
  summary: z.object({
    collected: z.number().int(),
    revenueCents: z.number().int(),
    partsCostCents: z.number().int(),
    laborCents: z.number().int(),
    marginCents: z.number().int(),
    averageTurnaroundDays: z.number().nullable(),
    notRepaired: z.number().int(),
  }),
  rows: z.array(
    z.object({
      key: z.string(),
      ticketId: z.string().nullable(),
      docNumber: z.string().nullable(),
      label: z.string(),
      device: z.string(),
      intakeAtMs: z.number().int().nullable(),
      collectedAtMs: z.number().int().nullable(),
      turnaroundDays: z.number().int().nullable(),
      count: z.number().int(),
      revenueCents: z.number().int(),
      partsCostCents: z.number().int(),
      marginCents: z.number().int(),
      technicianName: z.string().nullable(),
    }),
  ),
  notRepaired: z.array(z.object({ reason: z.string().nullable(), count: z.number().int() })),
});
export type ReportsRepairsClosedResponse = z.infer<typeof ReportsRepairsClosedResponseSchema>;

/* ---- used holding ---- */

export const ReportsUsedRequestSchema = z.object({
  status: z.string().nullable().default(null),
  grade: z.string().nullable().default(null),
});
export const ReportsUsedResponseSchema = z.object({
  summary: z.array(z.object({ state: z.string(), count: z.number().int(), costCents: z.number().int() })),
  totalCostCents: z.number().int(),
  storeCredit: z.object({ count: z.number().int(), totalCents: z.number().int() }),
  rows: z.array(
    z.object({
      purchaseId: z.string(),
      docNumber: z.string().nullable(),
      model: z.string(),
      grade: z.string().nullable(),
      state: z.string(),
      costCents: z.number().int(),
      salePriceCents: z.number().int().nullable(),
      daysHeld: z.number().int(),
    }),
  ),
});
export type ReportsUsedResponse = z.infer<typeof ReportsUsedResponseSchema>;

/* ---- valuation ---- */

export const ReportsValuationRequestSchema = z.object({ groupId: z.string().nullable().default(null) });
export const ReportsValuationResponseSchema = z.object({
  totalCents: z.number().int(),
  groups: z.array(
    z.object({
      groupId: z.string().nullable(),
      groupName: z.string(),
      qty: z.number().int(),
      valueCents: z.number().int(),
    }),
  ),
  products: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      groupName: z.string(),
      onHand: z.number().int(),
      unitCostCents: z.number().int().nullable(),
      valueCents: z.number().int(),
    }),
  ),
});
export type ReportsValuationResponse = z.infer<typeof ReportsValuationResponseSchema>;

/* ---- dead stock ---- */

export const ReportsDeadStockRequestSchema = z.object({ groupId: z.string().nullable().default(null) });
export const ReportsDeadStockResponseSchema = z.object({
  thresholdDays: z.number().int(),
  totalCostCents: z.number().int(),
  rows: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      groupName: z.string(),
      onHand: z.number().int(),
      costTiedUpCents: z.number().int(),
      lastSaleAtMs: z.number().int().nullable(),
      daysSinceSale: z.number().int().nullable(),
    }),
  ),
});
export type ReportsDeadStockResponse = z.infer<typeof ReportsDeadStockResponseSchema>;

/* ---- export ---- */

export const ReportsExportRequestSchema = z.object({
  report: z.enum(["sales", "repairsOpen", "repairsClosed", "used", "valuation", "deadStock"]),
  /** the SAME filters the screen is showing; the query is re-run, never trusted */
  filters: z.record(z.string(), z.unknown()).default({}),
});
export const ReportsExportResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), path: z.string(), rows: z.number().int() }),
  z.object({ kind: z.literal("cancelled") }),
]);
export type ReportsExportResponse = z.infer<typeof ReportsExportResponseSchema>;
