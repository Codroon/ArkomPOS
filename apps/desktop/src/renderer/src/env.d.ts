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
  SessionInfo,
  LoginUser,
  UserRow,
  UsedCheckImeiResponse,
  UsedLogRequest,
  UsedLogResponse,
} from "@arkom/core";

declare global {
  /** Injected at build time from apps/desktop/package.json. */
  const __APP_VERSION__: string;

  interface Window {
    /** Typed IPC bridge exposed by the preload script (the renderer's only I/O). */
    arkom: {
      invoke(channel: "meta:context", payload?: undefined): Promise<MetaContextResponse>;
      invoke(channel: "catalog:list", payload?: CatalogListRequest): Promise<ProductRow[]>;
      invoke(channel: "catalog:get", payload: { id: string }): Promise<ProductRow>;
      invoke(
        channel: "catalog:save",
        payload: CatalogSaveRequest,
        approval?: { userId: string; pin: string },
      ): Promise<CatalogSaveResponse>;
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
        approval?: { userId: string; pin: string },
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
      invoke(channel: "setup:status", payload?: undefined): Promise<{ needed: boolean; ownerNeeded: boolean }>;
      invoke(
        channel: "setup:complete",
        payload: SetupCompleteRequest,
      ): Promise<{ tenantId: string; demoProducts: number; demoUnits: number }>;
      invoke(channel: "demo:status", payload?: undefined): Promise<DemoStatus>;
      invoke(channel: "demo:remove", payload?: undefined): Promise<DemoRemoveResponse>;
      invoke(channel: "auth:users", payload?: undefined): Promise<LoginUser[]>;
      invoke(channel: "auth:login", payload: { userId: string; pin: string }): Promise<SessionInfo>;
      invoke(channel: "auth:session", payload?: undefined): Promise<SessionInfo | null>;
      invoke(channel: "auth:logout", payload?: undefined): Promise<{ ok: boolean; parkedDocId: string | null }>;
      invoke(channel: "auth:lock", payload?: undefined): Promise<{ ok: boolean }>;
      invoke(channel: "auth:unlock", payload: { pin: string }): Promise<SessionInfo>;
      invoke(channel: "auth:activity", payload?: undefined): Promise<{ ok: boolean }>;
      invoke(
        channel: "auth:recover",
        payload: { userId: string; code: string; newPin: string },
      ): Promise<{ recoveryCode: string }>;
      invoke(
        channel: "auth:printRecovery",
        payload: { code: string; name: string },
      ): Promise<PrintTicketResponse>;
      invoke(
        channel: "setup:owner",
        payload: { name: string; pin: string },
      ): Promise<{ user: UserRow; recoveryCode: string }>;
      invoke(
        channel: "used:checkImei",
        payload: { imei: string },
      ): Promise<UsedCheckImeiResponse>;
      invoke(
        channel: "used:log",
        payload: UsedLogRequest,
        approval?: { userId: string; pin: string },
      ): Promise<UsedLogResponse>;
      invoke(
        channel: "used:print",
        payload: { purchaseId: string; what: "document" | "label"; target?: "auto" | "pdf"; copy?: boolean },
      ): Promise<PrintTicketResponse>;
      invoke(channel: "users:list", payload?: undefined): Promise<UserRow[]>;
      invoke(
        channel: "users:create",
        payload: { name: string; role: string; pin: string; overrides?: Record<string, boolean> },
      ): Promise<{ user: UserRow; recoveryCode: string | null }>;
      invoke(
        channel: "users:update",
        payload: { id: string; name?: string; role?: string; overrides?: Record<string, boolean>; active?: boolean },
      ): Promise<UserRow>;
      invoke(
        channel: "users:resetPin",
        payload: { id: string; newPin: string; currentPin?: string },
      ): Promise<{ ok: boolean }>;
      /** Session changes are pushed from main; returns an unsubscribe. */
      onSessionChanged(fn: (session: unknown) => void): () => void;
      invoke(channel: "backup:status", payload?: undefined): Promise<BackupStatus>;
      invoke(channel: "backup:now", payload?: undefined): Promise<BackupRunResponse>;
      invoke(channel: "backup:openFolder", payload?: undefined): Promise<{ ok: boolean }>;
      invoke(channel: "backup:pickFolder", payload?: undefined): Promise<{ path: string | null }>;
    };
  }
}

export {};
