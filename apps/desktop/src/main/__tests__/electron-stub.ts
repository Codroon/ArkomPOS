/**
 * A stand-in for `electron`, so the main process can be unit-tested.
 *
 * The guard is the most security-relevant code in the app and it lives in main,
 * which normally means it can only be exercised by launching a window. This
 * stub captures whatever `ipcMain.handle` registers, so a test can call a
 * channel exactly the way the renderer does — payload, approval and all — and
 * assert on what comes back.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Handler = (event: unknown, payload?: unknown, approval?: unknown) => unknown;

export const handlers = new Map<string, Handler>();

export const ipcMain = {
  handle(channel: string, fn: Handler) {
    handlers.set(channel, fn);
  },
  removeHandler(channel: string) {
    handlers.delete(channel);
  },
};

export const BrowserWindow = {
  getAllWindows: () => [] as unknown[],
};

/* One throwaway directory per run, so the tests that write real files (photos,
   PDFs) do so somewhere the OS will clean up rather than in the repo. */
const TEST_USER_DATA = mkdtempSync(join(tmpdir(), "arkom-userdata-"));

export const app = {
  isPackaged: false,
  getPath: () => TEST_USER_DATA,
  getAppPath: () => TEST_USER_DATA,
  getVersion: () => "0.10.0-test",
  on: () => undefined,
  whenReady: () => Promise.resolve(),
};

export const shell = {
  openPath: async () => "",
  showItemInFolder: () => undefined,
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
};

export const screen = { getAllDisplays: () => [] as unknown[] };
export const Menu = { setApplicationMenu: () => undefined };

export default { ipcMain, BrowserWindow, app, shell, dialog, screen, Menu };
