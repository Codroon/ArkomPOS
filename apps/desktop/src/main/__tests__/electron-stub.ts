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

/**
 * Enough of a window to render a PDF, and no more.
 *
 * The renderer measures the page then asks Chromium for bytes. A test cannot
 * have Chromium, but it can have the SHAPE — which is the right amount of
 * pretending: what these tests assert is that the file lands at the path the
 * shop chose, not that Chromium can draw. A real PDF is proved by opening one.
 */
export class BrowserWindow {
  static getAllWindows(): unknown[] {
    return [];
  }
  webContents = {
    async loadURL(): Promise<void> {},
    async executeJavaScript(): Promise<number | boolean> {
      return 240;
    },
    async printToPDF(): Promise<Buffer> {
      // a real PDF header, so anything sniffing the file sees what it expects
      return Buffer.from("%PDF-1.4 arkom test render");
    },
  };
  async loadURL(): Promise<void> {}
  destroy(): void {}
}

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

/**
 * The save dialog, scriptable.
 *
 * `nextSavePath` is what the next "Guardar PDF…" will choose; leaving it null
 * is the shop pressing Cancel, which is a decision the code has to handle and
 * not an error it can throw at.
 */
export let nextSavePath: string | null = null;
export function setNextSavePath(path: string | null): void {
  nextSavePath = path;
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: async () => (nextSavePath ? { canceled: false, filePath: nextSavePath } : { canceled: true, filePath: undefined }),
};

export const screen = { getAllDisplays: () => [] as unknown[] };
export const Menu = { setApplicationMenu: () => undefined };

export default { ipcMain, BrowserWindow, app, shell, dialog, screen, Menu };
