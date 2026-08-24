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
  CatalogGroupsRequestSchema,
  CatalogGroupsResponseSchema,
  CatalogCodesRequestSchema,
  CatalogCodesResponseSchema,
  CatalogAddCodeRequestSchema,
  CatalogAddCodeResponseSchema,
  CatalogRemoveCodeRequestSchema,
  CatalogRemoveCodeResponseSchema,
  ScanResolveRequestSchema,
  ScanResolutionSchema,
  InventoryListRequestSchema,
  InventoryListResponseSchema,
  InventoryMovementsRequestSchema,
  InventoryMovementsResponseSchema,
  StockAddRequestSchema,
  StockAddResponseSchema,
  SupplierListRequestSchema,
  SupplierListResponseSchema,
  SupplierCreateRequestSchema,
  SupplierCreateResponseSchema,
  SaleCurrentRequestSchema,
  SaleCurrentResponseSchema,
  SaleAddLineRequestSchema,
  SaleAddLineResponseSchema,
  SaleSetQtyRequestSchema,
  SaleRemoveLineRequestSchema,
  SaleOverridePriceRequestSchema,
  SaleParkRequestSchema,
  SaleParkResponseSchema,
  SaleResumeRequestSchema,
  SaleStateSchema,
  SaleListParkedRequestSchema,
  SaleListParkedResponseSchema,
  SaleCompleteRequestSchema,
  CompletedSaleSchema,
  SalePeekRequestSchema,
  TicketPeekSchema,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { tillContext } from "./context";
import { addCode, getProduct, listCodes, listGroups, listProducts, removeCode, saveProduct } from "./repos/catalog";
import { resolveScanCode } from "./repos/scan";
import { addStock, listInventory, listMovements } from "./repos/inventory";
import { createSupplier, listSuppliers } from "./repos/suppliers";
import {
  addLine,
  complete,
  currentDraft,
  listParked,
  overridePrice,
  park,
  peek,
  removeLine,
  resume,
  setQty,
} from "./repos/sale";

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

  register("catalog:groups", CatalogGroupsRequestSchema, CatalogGroupsResponseSchema, () => {
    return listGroups(db, tillContext(db).ctx);
  });

  register("catalog:codes", CatalogCodesRequestSchema, CatalogCodesResponseSchema, ({ productId }) => {
    return listCodes(db, tillContext(db).ctx, productId);
  });

  register("catalog:addCode", CatalogAddCodeRequestSchema, CatalogAddCodeResponseSchema, (req) => {
    return addCode(db, tillContext(db).ctx, req);
  });

  register("catalog:removeCode", CatalogRemoveCodeRequestSchema, CatalogRemoveCodeResponseSchema, (req) => {
    return removeCode(db, tillContext(db).ctx, req.productId, req.codeId);
  });

  register("scan:resolve", ScanResolveRequestSchema, ScanResolutionSchema, ({ code }) => {
    return resolveScanCode(db, tillContext(db).ctx, code);
  });

  register("inventory:list", InventoryListRequestSchema, InventoryListResponseSchema, (filters) => {
    return listInventory(db, tillContext(db).ctx, filters);
  });

  register("inventory:movements", InventoryMovementsRequestSchema, InventoryMovementsResponseSchema, (req) => {
    return listMovements(db, tillContext(db).ctx, req);
  });

  register("stock:add", StockAddRequestSchema, StockAddResponseSchema, (input) => {
    return addStock(db, tillContext(db).ctx, input);
  });

  register("supplier:list", SupplierListRequestSchema, SupplierListResponseSchema, () => {
    return listSuppliers(db, tillContext(db).ctx);
  });

  register("supplier:create", SupplierCreateRequestSchema, SupplierCreateResponseSchema, ({ name }) => {
    return createSupplier(db, tillContext(db).ctx, name);
  });

  register("sale:current", SaleCurrentRequestSchema, SaleCurrentResponseSchema, () => {
    return currentDraft(db, tillContext(db).ctx);
  });

  register("sale:addLine", SaleAddLineRequestSchema, SaleAddLineResponseSchema, (req) => {
    return addLine(db, tillContext(db).ctx, req);
  });

  register("sale:setQty", SaleSetQtyRequestSchema, SaleStateSchema, (req) => {
    return setQty(db, tillContext(db).ctx, req);
  });

  register("sale:removeLine", SaleRemoveLineRequestSchema, SaleStateSchema, (req) => {
    return removeLine(db, tillContext(db).ctx, req);
  });

  register("sale:overridePrice", SaleOverridePriceRequestSchema, SaleStateSchema, (req) => {
    return overridePrice(db, tillContext(db).ctx, req);
  });

  register("sale:park", SaleParkRequestSchema, SaleParkResponseSchema, (req) => {
    return park(db, tillContext(db).ctx, req);
  });

  register("sale:resume", SaleResumeRequestSchema, SaleStateSchema, (req) => {
    return resume(db, tillContext(db).ctx, req);
  });

  register("sale:listParked", SaleListParkedRequestSchema, SaleListParkedResponseSchema, () => {
    return listParked(db, tillContext(db).ctx);
  });

  register("sale:complete", SaleCompleteRequestSchema, CompletedSaleSchema, (req) => {
    return complete(db, tillContext(db).ctx, req);
  });

  register("sale:peek", SalePeekRequestSchema, TicketPeekSchema, ({ docId }) => {
    return peek(db, tillContext(db).ctx, docId);
  });
}
