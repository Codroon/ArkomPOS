/**
 * Production hardening.
 *
 * The till sits on a counter in a shop, unattended, used by staff who are not
 * meant to be operating a browser. The point of this file is that the app
 * behaves like an appliance rather than a Chromium window someone can wander
 * out of.
 */
import { app, BrowserWindow, Menu, session, shell, type WebContents } from "electron";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

/* --------------------------------- logging -------------------------------- */

const LOG_NAME = "arkom.log";
const LOG_MAX_BYTES = 2 * 1024 * 1024; // ~2MB, then one rotation
const LOG_OLD = "arkom.log.1";

export function logsDir(): string {
  return join(app.getPath("userData"), "logs");
}

/**
 * Append one line, rotating at 2MB. Deliberately two files and no more: this
 * exists so that "it crashed yesterday" has an answer, not so the till keeps a
 * year of logs nobody will read.
 */
async function writeLine(line: string): Promise<void> {
  const dir = logsDir();
  await mkdir(dir, { recursive: true });
  const path = join(dir, LOG_NAME);
  try {
    const { size } = await stat(path);
    if (size > LOG_MAX_BYTES) await rename(path, join(dir, LOG_OLD));
  } catch {
    // no log yet — the append below creates it
  }
  await appendFile(path, line, "utf8");
}

function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function logEvent(kind: string, detail: unknown): void {
  const text =
    detail instanceof Error
      ? `${detail.name}: ${detail.message}\n${detail.stack ?? ""}`
      : typeof detail === "string"
        ? detail
        : JSON.stringify(detail);
  void writeLine(`[${stamp()}] ${kind}: ${text}\n\n`).catch(() => {
    // if logging fails there is nowhere left to report it
  });
}

/**
 * Catch what would otherwise vanish. An unhandled rejection in the main process
 * is invisible on a machine with no terminal attached, and "it just stopped
 * working" is not a bug report anyone can act on.
 */
export function installErrorLogging(): void {
  process.on("uncaughtException", (err) => logEvent("uncaughtException", err));
  process.on("unhandledRejection", (reason) => logEvent("unhandledRejection", reason));

  app.on("child-process-gone", (_e, details) => logEvent("child-process-gone", details));
  app.on("render-process-gone", (_e, _wc, details) => logEvent("render-process-gone", details));

  logEvent("start", `Codroon POS ${app.getVersion()} · packaged=${app.isPackaged}`);
}

/* -------------------------------- lockdown -------------------------------- */

/**
 * Remove the browser from around the app: no menu, no DevTools, no navigating
 * away, no new windows. Links that should open (there are none today, but there
 * will be) go to the system browser rather than inside the till.
 */
export function hardenApp(): void {
  // no application menu at all — its accelerators (Ctrl+R, Ctrl+Shift+I) are
  // the main way someone reloads or opens DevTools by accident
  Menu.setApplicationMenu(null);

  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.on("before-input-event", (event, input) => {
      if (!app.isPackaged) return; // dev keeps its tools
      const key = input.key.toLowerCase();
      const devtools =
        key === "f12" ||
        (input.control && input.shift && (key === "i" || key === "j" || key === "c")) ||
        (input.control && (key === "r" || key === "w"));
      if (devtools) event.preventDefault();
    });

    if (app.isPackaged) {
      contents.on("devtools-opened", () => contents.closeDevTools());
    }

    // nothing in Phase 1 navigates anywhere; anything that tries is a bug or an
    // attempt, and either way it does not happen inside the till window
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const current = contents.getURL();
      if (url !== current) event.preventDefault();
    });
  });

  installPermissionPolicy();
}

/**
 * What the renderer may ask the operating system for.
 *
 * Electron grants most permission requests by default. That was harmless while
 * nothing asked for anything; the used-device capture modal changes that, so
 * the policy becomes explicit rather than inherited.
 *
 * `media` is allowed because photographing a phone on the counter is the point
 * of that modal — and it is only ever a camera the shop's own staff pointed at
 * their own counter. Everything else is denied: a till has no business asking
 * for the location of the shop, sending notifications, or reading the
 * clipboard, and if one of those requests ever appears it is a bug worth
 * seeing in the log rather than a dialog worth granting.
 */
function installPermissionPolicy(): void {
  const allowed = new Set(["media"]);

  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    const ok = allowed.has(permission);
    if (!ok) logEvent("permission-denied", permission);
    callback(ok);
  });

  // the synchronous sibling: getUserMedia consults this one on some paths
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
}

/* ---------------------------- window geometry ---------------------------- */

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 860, maximized: false };

function statePath(): string {
  return join(app.getPath("userData"), "window-state.json");
}

/**
 * Remember size and position across restarts.
 *
 * Kept in its own JSON file rather than the settings table on purpose: it is a
 * property of this machine's screen, not of the shop, and it must be readable
 * before the database is open. It also must never stop the app starting, so
 * every failure here falls back to the default geometry.
 */
export async function loadWindowState(): Promise<WindowState> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(statePath(), "utf8")) as Partial<WindowState>;
    const state: WindowState = {
      width: Math.max(1280, Number(raw.width) || DEFAULT_STATE.width),
      height: Math.max(860, Number(raw.height) || DEFAULT_STATE.height),
      maximized: Boolean(raw.maximized),
    };
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      state.x = Number(raw.x);
      state.y = Number(raw.y);
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** Persist geometry on move/resize/close, debounced so dragging is not chatty. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const persist = async () => {
    try {
      const { writeFile } = await import("node:fs/promises");
      // a maximized window reports the maximized bounds; keep the restore size
      const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
      const state: WindowState = {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
      };
      await writeFile(statePath(), JSON.stringify(state), "utf8");
    } catch (err) {
      logEvent("window-state", err);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void persist(), 400);
  };

  // listed one by one: BrowserWindow.on is overloaded per event name, so a
  // loop over a union of names matches none of the overloads
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    void persist();
  });
}

/**
 * A window whose remembered position is off-screen (the shop unplugged the
 * second monitor) is a window nobody can find. Electron clamps to the nearest
 * display when x/y are omitted, so drop them if they land nowhere visible.
 */
export function visibleOnSomeDisplay(state: WindowState, displays: Electron.Display[]): boolean {
  if (state.x === undefined || state.y === undefined) return true;
  return displays.some((d) => {
    const a = d.workArea;
    return (
      state.x! < a.x + a.width &&
      state.x! + state.width > a.x &&
      state.y! < a.y + a.height &&
      state.y! + state.height > a.y
    );
  });
}
