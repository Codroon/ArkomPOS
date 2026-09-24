/**
 * Where a till keeps its cloud credential — ADR-0020 §1.
 *
 * Deliberately NOT a table. Every row in this database goes through `mutate()`
 * and therefore into the oplog, and the oplog is the thing we push to the
 * cloud: a device token stored as shop data would be uploaded to the service it
 * authenticates. The link is also not shop data by any other measure — it is
 * machine state, like the window position, and a shop that restores its
 * database onto a second PC should not find two tills sharing one identity.
 *
 * So it lives beside `window-state.json`, in userData, as a plain file:
 *
 *   url          where this till pushes
 *   deviceToken  the credential, scoped to ONE terminal (revocable from the account)
 *   lastAckedSeq the cursor; losing it costs a replay, never a duplicate (ADR-0005)
 *
 * Losing the file is safe by design: the till re-enrols and re-pushes, and the
 * cloud discards what it already has by `opId`.
 */
import { app } from "electron";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface CloudLink {
  url: string;
  deviceToken: string;
  tenantId: string;
  terminalId: string;
  accountName: string;
  shopName: string;
  enrolledAtMs: number;
  lastAckedSeq: number;
  lastPushAtMs: number | null;
  /** the last thing that went wrong, for the Ajustes panel to show honestly */
  lastError: string | null;
}

const FILE = (): string => join(app.getPath("userData"), "cloud-link.json");

let cache: CloudLink | null | undefined;

export function readLink(): CloudLink | null {
  if (cache !== undefined) return cache;
  try {
    const raw = readFileSync(FILE(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CloudLink>;
    cache =
      parsed.url && parsed.deviceToken && parsed.tenantId && parsed.terminalId
        ? {
            url: parsed.url,
            deviceToken: parsed.deviceToken,
            tenantId: parsed.tenantId,
            terminalId: parsed.terminalId,
            accountName: parsed.accountName ?? "",
            shopName: parsed.shopName ?? "",
            enrolledAtMs: parsed.enrolledAtMs ?? 0,
            lastAckedSeq: parsed.lastAckedSeq ?? 0,
            lastPushAtMs: parsed.lastPushAtMs ?? null,
            lastError: parsed.lastError ?? null,
          }
        : null;
  } catch {
    // no file, or one somebody edited into nonsense: an unlinked till
    cache = null;
  }
  return cache;
}

export function writeLink(link: CloudLink): void {
  cache = link;
  try {
    writeFileSync(FILE(), JSON.stringify(link, null, 2), "utf8");
  } catch (err) {
    /* A till that cannot persist its cursor still syncs — it just replays after
       a restart, which the cloud deduplicates. Never a reason to stop. */
    console.error("[sync] could not write cloud-link.json", err);
  }
}

/** Update a few fields without the caller restating the credential. */
export function patchLink(patch: Partial<CloudLink>): CloudLink | null {
  const current = readLink();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeLink(next);
  return next;
}

/** Unlink: the token is gone from this machine, the shop's data is untouched. */
export function clearLink(): void {
  cache = null;
  try {
    if (existsSync(FILE())) rmSync(FILE(), { force: true });
  } catch (err) {
    console.error("[sync] could not remove cloud-link.json", err);
  }
}

/** Test seam: forget what was read, so a fixture can change the file underneath. */
export function resetLinkCache(): void {
  cache = undefined;
}
