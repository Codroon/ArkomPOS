/**
 * IPC contract v1 — docs/design/system-design.md §4.
 * Every payload/result crossing the Electron bridge is a Zod schema defined here
 * and parsed on BOTH sides (main handler and renderer). Channels are added as
 * features land; the doc is updated in the same PR when the contract changes.
 */
import { z } from "zod";

/** Channels implemented so far (allowlisted in the preload bridge). */
export const IPC_CHANNELS = ["meta:context"] as const;
export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Typed error codes (§4) — the renderer maps codes to UI, never parses messages. */
export const ErrorCodeSchema = z.enum([
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
