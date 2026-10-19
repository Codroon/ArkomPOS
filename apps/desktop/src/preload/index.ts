/**
 * The only bridge between renderer and main (renderer never touches DB/Node).
 * Channels are allowlisted from the core IPC contract; anything else rejects.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@arkom/core";

const allowed = new Set<string>(IPC_CHANNELS);

contextBridge.exposeInMainWorld("arkom", {
  /**
   * `approval` rides alongside the payload rather than inside it, so adding the
   * approval layer cost zero changes to the ~30 request schemas. The guard in
   * main consumes it; handlers never see it (ADR-0012 §5).
   */
  invoke: (channel: string, payload?: unknown, approval?: unknown): Promise<unknown> => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload, approval);
  },

  /** Session changes are pushed, so the UI never polls for who is logged in. */
  onSessionChanged: (fn: (session: unknown) => void): (() => void) => {
    const listener = (_e: unknown, session: unknown) => fn(session);
    ipcRenderer.on("auth:changed", listener);
    return () => ipcRenderer.removeListener("auth:changed", listener);
  },

  /**
   * The shop's shared data moved under this window — a sibling till's sale,
   * delivery or repair just landed (ADR-0024 §3). Carries entity names only;
   * the screen reads the data again through its own guarded channel.
   */
  onShopChanged: (fn: (change: { entities: string[] }) => void): (() => void) => {
    const listener = (_e: unknown, change: { entities: string[] }) => fn(change);
    ipcRenderer.on("shop:changed", listener);
    return () => ipcRenderer.removeListener("shop:changed", listener);
  },
});
