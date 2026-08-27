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
});
