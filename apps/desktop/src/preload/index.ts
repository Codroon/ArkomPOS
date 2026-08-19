/**
 * The only bridge between renderer and main (renderer never touches DB/Node).
 * Channels are allowlisted from the core IPC contract; anything else rejects.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@arkom/core";

const allowed = new Set<string>(IPC_CHANNELS);

contextBridge.exposeInMainWorld("arkom", {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!allowed.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
});
