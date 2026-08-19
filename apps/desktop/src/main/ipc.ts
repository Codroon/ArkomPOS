/**
 * IPC handlers — contract in docs/design/system-design.md §4, schemas in
 * @arkom/core ipc.ts. Every request AND response is Zod-parsed here; failures
 * cross the bridge as typed envelopes (the renderer maps codes, never strings).
 * Handlers do no business math — that lives in core; writes go through mutate().
 */
import { ipcMain } from "electron";
import { z, ZodError } from "zod";
import {
  AppError,
  appError,
  toBridgeError,
  MetaContextRequestSchema,
  MetaContextResponseSchema,
  CatalogListRequestSchema,
  CatalogListResponseSchema,
  CatalogGetRequestSchema,
  CatalogGetResponseSchema,
  CatalogSaveRequestSchema,
  CatalogSaveResponseSchema,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { tillContext } from "./context";
import { getProduct, listProducts, saveProduct } from "./repos/catalog";

function asBridgeError(err: unknown): Error {
  if (err instanceof AppError) return toBridgeError(err);
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    const field = issue && issue.path.length > 0 ? issue.path.join(".") : undefined;
    return toBridgeError(appError("VALIDATION", issue?.message ?? "Datos no válidos.", field));
  }
  console.error("[ipc] unexpected error:", err);
  return err instanceof Error ? err : new Error(String(err));
}

function register<Req, Res>(
  channel: string,
  reqSchema: z.ZodType<Req>,
  resSchema: z.ZodType<Res>,
  handler: (req: Req) => Res,
): void {
  ipcMain.handle(channel, (_event, payload: unknown) => {
    try {
      return resSchema.parse(handler(reqSchema.parse(payload)));
    } catch (err) {
      throw asBridgeError(err);
    }
  });
}

export function registerIpcHandlers(db: ArkomDb): void {
  register("meta:context", MetaContextRequestSchema, MetaContextResponseSchema, () => {
    return tillContext(db).meta;
  });

  register("catalog:list", CatalogListRequestSchema, CatalogListResponseSchema, (filters) => {
    return listProducts(db, tillContext(db).ctx, filters);
  });

  register("catalog:get", CatalogGetRequestSchema, CatalogGetResponseSchema, ({ id }) => {
    return getProduct(db, tillContext(db).ctx, id);
  });

  register("catalog:save", CatalogSaveRequestSchema, CatalogSaveResponseSchema, (input) => {
    return saveProduct(db, tillContext(db).ctx, input);
  });
}
