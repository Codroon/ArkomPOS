/**
 * "The shop's data moved under you" — main to renderer, ADR-0024 §3.
 *
 * A sale at the other counter used to reach this till's database within a few
 * seconds and reach its SCREEN only when somebody navigated: Inventario kept
 * showing the old on-hand until it was reopened. Now, when the inbox lands rows
 * from a sibling, every window is told which kinds of thing changed and the
 * screens showing them read again.
 *
 * It carries entity names and nothing else — the screen asks main for the data
 * through its usual guarded channel, so nothing here bypasses a permission.
 */
import { BrowserWindow } from "electron";

export const SHOP_CHANGED = "shop:changed";

export function announceShopChanged(entities: readonly string[]): void {
  if (entities.length === 0) return;
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(SHOP_CHANGED, { entities: [...new Set(entities)] });
    }
  } catch {
    /* no window yet, or shutting down: the next navigation reads fresh anyway */
  }
}
