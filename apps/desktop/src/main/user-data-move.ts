/**
 * The shop's data follows the product's new name — v1.1.0.
 *
 * Electron keeps a till's database, photographs and backups in a folder named
 * after the app. Renaming Arkom POS to Codroon POS therefore points a working
 * shop at an empty folder: the app starts, finds no tenant, and offers to set
 * up a till that has been selling for months. There is no worse first minute
 * after an upgrade.
 *
 * So the new name adopts the old folder, once, before anything opens the
 * database. It MOVES — nothing is copied and nothing is deleted, so a failure
 * halfway leaves the old folder where it was and the next launch tries again.
 * A folder that already exists under the new name is never touched: the shop
 * has been running on the new name and the old one is history.
 */
import { app } from "electron";
import { existsSync, readdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { bootStep } from "./boot-log";

/** What the product used to be called, newest first. */
const FORMER_NAMES = ["Arkom POS"];

export function adoptPreviousUserData(): string | null {
  const current = app.getPath("userData");
  const parent = dirname(current);
  const suffix = app.isPackaged ? "" : " (dev)";

  // a till that has already written something under the new name owns it
  if (existsSync(current) && readdirSync(current).length > 0) return null;

  for (const former of FORMER_NAMES) {
    const previous = join(parent, `${former}${suffix}`);
    /* Under a brand whose name IS a former name — the Arkom pilot is called
       what the product used to be called — these are the same folder. The
       guard above already covers a shop with data in it, but relying on that
       is safe by accident; this says so on purpose. */
    if (previous === current) continue;
    if (!existsSync(previous) || readdirSync(previous).length === 0) continue;
    try {
      renameSync(previous, current);
      bootStep(`adopted the data folder from "${former}${suffix}"`);
      return previous;
    } catch (err) {
      /* Locked by another process, or across volumes. Not fatal and not worth
         a copy: the app carries on with an empty folder rather than a half one,
         and DEPLOYMENT.md says how to move it by hand. */
      bootStep(`could not adopt "${former}${suffix}": ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
  return null;
}
