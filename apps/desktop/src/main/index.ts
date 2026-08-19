import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { initDb } from "./db";
import { registerIpcHandlers } from "./ipc";

// dev-only: ARKOM_DEBUG_PORT opens Chrome DevTools Protocol for scripted
// driving/screenshots of the running app (never set in packaged builds)
if (!app.isPackaged && process.env.ARKOM_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.ARKOM_DEBUG_PORT);
}

// 00-foundations: fixed desktop layout, min window 1280×860 (till hardware)
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1280,
    minHeight: 860,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: "#e8e8ea",
    title: "Arkom POS",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    // surface renderer console in the dev terminal (this repo is driven from a CLI)
    win.webContents.on("console-message", (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
  }

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// single instance — two tills on one PC would fight over the SQLite file
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const db = initDb();
    registerIpcHandlers(db);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
