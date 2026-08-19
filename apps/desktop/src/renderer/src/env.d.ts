/// <reference types="vite/client" />
import type {
  CatalogListRequest,
  CatalogSaveRequest,
  EntityRef,
  MetaContextResponse,
  ProductRow,
} from "@arkom/core";

declare global {
  interface Window {
    /** Typed IPC bridge exposed by the preload script (the renderer's only I/O). */
    arkom: {
      invoke(channel: "meta:context", payload?: undefined): Promise<MetaContextResponse>;
      invoke(channel: "catalog:list", payload?: CatalogListRequest): Promise<ProductRow[]>;
      invoke(channel: "catalog:get", payload: { id: string }): Promise<ProductRow>;
      invoke(channel: "catalog:save", payload: CatalogSaveRequest): Promise<ProductRow>;
      invoke(channel: "catalog:groups", payload?: undefined): Promise<EntityRef[]>;
    };
  }
}

export {};
