/// <reference types="vite/client" />
import type { MetaContextResponse } from "@arkom/core";

declare global {
  interface Window {
    /** Typed IPC bridge exposed by the preload script (the renderer's only I/O). */
    arkom: {
      invoke(channel: "meta:context", payload?: undefined): Promise<MetaContextResponse>;
    };
  }
}

export {};
