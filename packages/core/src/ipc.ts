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
] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Typed error codes (§4) — the renderer maps codes to UI, never parses messages. */
export const ErrorCodeSchema = z.enum([
  "DUPLICATE_NAME",
  "DUPLICATE_BARCODE",
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
});
export type CatalogSaveRequest = z.infer<typeof CatalogSaveRequestSchema>;
export const CatalogSaveResponseSchema = ProductRowSchema;
