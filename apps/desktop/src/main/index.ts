import { app, BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { initDb } from "./db";
import { registerIpcHandlers } from "./ipc";
import { runBackup, startNightlyBackups, stopNightlyBackups } from "./backup";
import { tillContext } from "./context";
import { isSetupNeeded } from "./setup";
import { installKdf } from "./auth/kdf";
import { setIdleLimitMinutes, startIdleWatcher, stopIdleWatcher } from "./auth/session";
import { getSettings } from "./repos/settings";
import {
  hardenApp,
  installErrorLogging,
  loadWindowState,
  logEvent,
  trackWindowState,
  visibleOnSomeDisplay,
} from "./hardening";

/**
 * Name the app before anything asks Electron for a path.
 *
 * userData defaults to the package name, which put the shop's database, tickets
 * and backups under %APPDATA%@arkomdesktop — a path that looks like a
 * mistake and that a client would never find. Dev gets its own suffix so a
 * developer's tickets and backups never mix with a real till's.
 */
app.setName(app.isPackaged ? "Arkom POS" : "Arkom POS (dev)");

/** How long the app will wait for the closing backup before letting go. */
const CLOSE_BACKUP_TIMEOUT_MS = 10_000;

/** before-quit fires again after app.quit(); this stops the second pass. */
let quitting = false;

// dev-only: ARKOM_DEBUG_PORT opens Chrome DevTools Protocol for scripted
// driving/screenshots of the running app (never set in packaged builds)
if (!app.isPackaged && process.env.ARKOM_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.ARKOM_DEBUG_PORT);
}

/**
 * Graphite 900. The only hex outside tokens.css: this paints the native window
 * before the renderer has loaded, and the main process cannot read CSS tokens.
 * Keep it equal to --color-inverse.
 */
const GRAPHITE_900 = "#15181B";

/** The Arkom mark, for the taskbar, Alt-Tab and the window itself. */
function brandIcon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.ico")
    : join(__dirname, "../../build/icon.ico");
}

// 00-foundations: fixed desktop layout, min window 1280×860 (till hardware)
async function createWindow(): Promise<void> {
  const state = await loadWindowState();
  // a remembered position on a monitor that is no longer plugged in would put
  // the window somewhere nobody can reach it
  const placed = visibleOnSomeDisplay(state, screen.getAllDisplays());

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(placed && state.x !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 1280,
    minHeight: 860,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: GRAPHITE_900, // the topbar's colour, so the flash on open is the brand
    title: "Arkom POS",
    icon: brandIcon(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (state.maximized) win.maximize();
  trackWindowState(win);

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
  // someone double-clicking the shortcut again should get the till they already
  // have, not nothing at all
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    installErrorLogging();
    hardenApp();
    installKdf();

    const db = initDb();
    registerIpcHandlers(db);
    await createWindow();

    // the till may not be configured yet, so the context is read per run rather
    // than captured here — first run creates the tenant this depends on
    startNightlyBackups(db, () => tillContext(db).ctx);

    /* The shop's own idle limit, if it has one. Read defensively: a till that
       has never been configured has no tenant to read settings for, and failing
       to boot over a preference would be the wrong trade. */
    try {
      setIdleLimitMinutes(getSettings(db, tillContext(db).ctx).idleLockMinutes);
    } catch {
      // unconfigured till: the built-in default stands until first run completes
    }
    startIdleWatcher();

    /**
     * Back up on the way out. The nightly run covers a till left switched on;
     * this covers the far more common shop that turns the machine off at close.
     * Between them, both habits are protected.
     *
     * before-quit is synchronous, so the quit is held while the backup runs and
     * released either way — a failed backup must never trap the app open. The
     * timeout is the same promise: a stuck copy loses the backup, not the exit.
     */
    app.on("before-quit", (event) => {
      if (quitting) return;
      event.preventDefault();
      quitting = true;
      stopNightlyBackups();
      stopIdleWatcher();

      const guard = new Promise((resolve) => setTimeout(resolve, CLOSE_BACKUP_TIMEOUT_MS));

      /*
       * Everything here is inside the async wrapper on purpose. tillContext()
       * THROWS on a till that has not been set up yet, and it used to be called
       * while building the argument list — synchronously, after
       * preventDefault(), so the throw escaped the handler and app.quit() was
       * never reached. A freshly installed till could not be closed at all.
       * Found on the packaged clean-machine walk; the rule it earns is that
       * nothing in this handler may throw before app.quit() is guaranteed.
       */
      const backup = (async () => {
        // no shop yet means no data worth copying, and no identity to ask for
        if (isSetupNeeded(db)) return;
        await runBackup(db, tillContext(db).ctx, "close");
      })().catch((err) => logEvent("backup-on-close", err));

      Promise.race([backup, guard]).finally(() => app.quit());
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
