/// <reference types="vite/client" />
import type {
  CatalogAddCodeRequest,
  CatalogAddCodeResponse,
  CatalogListRequest,
  CatalogSaveRequest,
  CatalogSaveResponse,
  CompletedSale,
  ProductCode,
  ScanResolution,
  EntityRef,
  InventoryListRequest,
  InventoryMovementsRequest,
  InventoryMovementsResponse,
  InventoryRow,
  MetaContextResponse,
  ParkedSale,
  ProductRow,
  SaleAddLineRequest,
  SaleAddLineResponse,
  SaleState,
  StockAddRequest,
  StockAddResponse,
  TenderDraft,
  TicketPeek,
  Settings,
  PrinterInfo,
  PrintTicketInput,
  PrintTicketResponse,
  SetupCompleteRequest,
  DemoStatus,
  DemoRemoveResponse,
  BackupStatus,
  BackupRunResponse,
} from "@arkom/core";

declare global {
  interface Window {
    /** Typed IPC bridge exposed by the preload script (the renderer's only I/O). */
    arkom: {
      invoke(channel: "meta:context", payload?: undefined): Promise<MetaContextResponse>;
      invoke(channel: "catalog:list", payload?: CatalogListRequest): Promise<ProductRow[]>;
      invoke(channel: "catalog:get", payload: { id: string }): Promise<ProductRow>;
      invoke(channel: "catalog:save", payload: CatalogSaveRequest): Promise<CatalogSaveResponse>;
      invoke(channel: "catalog:groups", payload?: undefined): Promise<EntityRef[]>;
      invoke(channel: "catalog:codes", payload: { productId: string }): Promise<ProductCode[]>;
      invoke(channel: "catalog:addCode", payload: CatalogAddCodeRequest): Promise<CatalogAddCodeResponse>;
      invoke(channel: "catalog:removeCode", payload: { productId: string; codeId: string }): Promise<ProductCode[]>;
      invoke(channel: "scan:resolve", payload: { code: string }): Promise<ScanResolution>;
      invoke(channel: "inventory:list", payload?: InventoryListRequest): Promise<InventoryRow[]>;
      invoke(channel: "inventory:movements", payload: InventoryMovementsRequest): Promise<InventoryMovementsResponse>;
      invoke(channel: "stock:add", payload: StockAddRequest): Promise<StockAddResponse>;
      invoke(channel: "supplier:list", payload?: undefined): Promise<EntityRef[]>;
      invoke(channel: "supplier:create", payload: { name: string }): Promise<EntityRef>;
      invoke(channel: "sale:current", payload?: undefined): Promise<SaleState | null>;
      invoke(channel: "sale:addLine", payload: SaleAddLineRequest): Promise<SaleAddLineResponse>;
      invoke(channel: "sale:setQty", payload: { docId: string; lineId: string; qty: number }): Promise<SaleState>;
      invoke(channel: "sale:removeLine", payload: { docId: string; lineId: string }): Promise<SaleState>;
      invoke(
        channel: "sale:overridePrice",
        payload: { docId: string; lineId: string; newPriceCents: number; reason: string },
      ): Promise<SaleState>;
      invoke(
        channel: "sale:park",
        payload: { docId: string; label?: string | null },
      ): Promise<{ docId: string; parkedLabel: string }>;
      invoke(channel: "sale:resume", payload: { docId: string }): Promise<SaleState>;
      invoke(channel: "sale:listParked", payload?: undefined): Promise<ParkedSale[]>;
      invoke(channel: "sale:complete", payload: { docId: string; tenders: TenderDraft[] }): Promise<CompletedSale>;
      invoke(channel: "sale:peek", payload: { docId: string }): Promise<TicketPeek>;
      invoke(channel: "settings:get", payload?: undefined): Promise<Settings>;
      invoke(channel: "settings:save", payload: Partial<Settings>): Promise<Settings>;
      invoke(channel: "print:printers", payload?: undefined): Promise<PrinterInfo[]>;
      invoke(channel: "print:ticket", payload: PrintTicketInput): Promise<PrintTicketResponse>;
      invoke(channel: "print:test", payload?: { target?: "auto" | "pdf" }): Promise<PrintTicketResponse>;
      invoke(
        channel: "print:reveal",
        payload: { path: string; mode: "open" | "folder" },
      ): Promise<{ ok: boolean }>;
      invoke(channel: "print:ticketsDir", payload?: undefined): Promise<{ path: string }>;
      invoke(channel: "setup:status", payload?: undefined): Promise<{ needed: boolean }>;
      invoke(
        channel: "setup:complete",
        payload: SetupCompleteRequest,
      ): Promise<{ tenantId: string; demoProducts: number; demoUnits: number }>;
      invoke(channel: "demo:status", payload?: undefined): Promise<DemoStatus>;
      invoke(channel: "demo:remove", payload?: undefined): Promise<DemoRemoveResponse>;
      invoke(channel: "backup:status", payload?: undefined): Promise<BackupStatus>;
      invoke(channel: "backup:now", payload?: undefined): Promise<BackupRunResponse>;
      invoke(channel: "backup:openFolder", payload?: undefined): Promise<{ ok: boolean }>;
      invoke(channel: "backup:pickFolder", payload?: undefined): Promise<{ path: string | null }>;
    };
  }
}

export {};
