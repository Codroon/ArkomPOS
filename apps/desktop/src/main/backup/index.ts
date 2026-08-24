/**
 * Local backups.
 *
 * The shop's entire business lives in one SQLite file on one PC behind a
 * counter. There is no server and no sync yet (Phase 2), so this file is it —
 * which makes backup the least glamorous and most important thing in the app.
 *
 * Three rules it follows:
 *
 *   1. **Never copy the file.** The database runs in WAL mode, so the bytes on
 *      disk are not the database — a file copy of a live SQLite database is a
 *      way to produce a plausible-looking corrupt one. Every backup goes
 *      through SQLite's online backup API, which is safe against concurrent
 *      writes by design.
 *
 *   2. **A backup nobody opened is a rumour.** Each one is immediately reopened
 *      read-only, integrity-checked and queried. If it does not pass it is
 *      deleted rather than kept, because a folder of fourteen files where some
 *      are unusable is worse than one where all thirteen are.
 *
 *   3. **Restore is not a button.** Overwriting a live database from the UI is
 *      a way to lose a day's takings to a misclick. The procedure is three
 *      manual steps and lives in DEPLOYMENT.md.
 */
import { app } from "electron";
import Database from "better-sqlite3";
import { mkdir, readdir, stat, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { mutate, type MutationCtx } from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { rawSqlite, resolveDbPath } from "../db";
import { getSettings, saveSettings } from "../repos/settings";

/** Roughly a fortnight of daily backups — enough to notice and step back. */
export const KEEP_BACKUPS = 14;

const PREFIX = "arkom-";
const SUFFIX = ".db";

export function backupsDir(): string {
  return join(app.getPath("userData"), "backups");
}

/** arkom-20260824-2231.db — sortable, and readable by a human in a hurry. */
function stampedName(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${PREFIX}${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}${SUFFIX}`
  );
}

/**
 * Reopen the copy and prove it is a database. `integrity_check` walks the whole
 * file; the count that follows proves the schema survived, not just the pages.
 */
function verifyBackup(path: string): { ok: true; oplogRows: number } {
  const probe = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const result = probe.pragma("integrity_check") as { integrity_check: string }[];
    const verdict = result[0]?.integrity_check;
    if (verdict !== "ok") throw new Error(`integrity_check: ${verdict ?? "sin respuesta"}`);
    const { n } = probe.prepare("SELECT COUNT(*) n FROM oplog").get() as { n: number };
    return { ok: true, oplogRows: n };
  } finally {
    probe.close();
  }
}

/**
 * Remove the -wal/-shm files a probe leaves beside a backup.
 *
 * The copy inherits WAL journal mode, so merely opening it creates sidecars.
 * They matter more than tidiness: a backup should be ONE file you can drag to a
 * USB stick, and a stale -wal sitting next to a restored database is a way to
 * confuse SQLite about what the database actually contains. `.backup()` writes
 * a complete file, and the probe is read-only, so nothing is lost with them.
 */
async function dropSidecars(path: string): Promise<void> {
  await Promise.allSettled([unlink(`${path}-wal`), unlink(`${path}-shm`)]);
}

export interface BackupResult {
  path: string;
  atMs: number;
  sizeBytes: number;
  oplogRows: number;
  pruned: number;
  /** the USB stick or synced folder, when one is configured and reachable */
  secondaryPath: string | null;
  secondaryError: string | null;
}

async function pruneOld(dir: string): Promise<number> {
  const names = (await readdir(dir))
    .filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX))
    .sort(); // the stamp sorts chronologically
  const excess = names.slice(0, Math.max(0, names.length - KEEP_BACKUPS));
  for (const name of excess) {
    const victim = join(dir, name);
    await unlink(victim);
    await dropSidecars(victim); // or they outlive the backup they belonged to
  }
  return excess.length;
}

/**
 * Take one backup. `reason` is recorded so the trail distinguishes the nightly
 * run from the one someone took by hand before doing something risky.
 */
export async function runBackup(
  db: ArkomDb,
  ctx: MutationCtx,
  reason: "nightly" | "close" | "manual",
): Promise<BackupResult> {
  const dir = backupsDir();
  await mkdir(dir, { recursive: true });

  const at = new Date();
  const path = join(dir, stampedName(at));

  // SQLite's online backup — safe while the till is mid-sale
  await rawSqlite().backup(path);

  let oplogRows: number;
  try {
    oplogRows = verifyBackup(path).oplogRows;
    await dropSidecars(path);
  } catch (err) {
    // a copy that will not open is not a backup; do not leave it looking like one
    await unlink(path).catch(() => {});
    await dropSidecars(path);
    const message = err instanceof Error ? err.message : String(err);
    recordBackupRun(db, ctx, { ok: false, reason, error: message, atMs: at.getTime() });
    throw new Error(`La copia de seguridad no superó la verificación: ${message}`);
  }

  const { size } = await stat(path);
  const pruned = await pruneOld(dir);

  // second destination is best-effort: a USB stick that is not plugged in must
  // not turn a good local backup into a failed one
  const settings = getSettings(db, ctx);
  let secondaryPath: string | null = null;
  let secondaryError: string | null = null;
  if (settings.backupSecondaryPath) {
    try {
      await mkdir(settings.backupSecondaryPath, { recursive: true });
      const dest = join(settings.backupSecondaryPath, stampedName(at));
      await copyFile(path, dest);
      secondaryPath = dest;
    } catch (err) {
      secondaryError = err instanceof Error ? err.message : String(err);
    }
  }

  recordBackupRun(db, ctx, {
    ok: true,
    reason,
    atMs: at.getTime(),
    path,
    sizeBytes: size,
    oplogRows,
    pruned,
    secondaryPath,
    secondaryError,
  });

  // remembered so Ajustes can say when, without listing the folder
  saveSettings(db, ctx, {
    backupLastAtMs: at.getTime(),
    backupLastStatus: secondaryError ? `ok (2ª copia falló: ${secondaryError})` : "ok",
  });

  return {
    path,
    atMs: at.getTime(),
    sizeBytes: size,
    oplogRows,
    pruned,
    secondaryPath,
    secondaryError,
  };
}

/** Every run, good or bad, lands in the oplog like any other event. */
function recordBackupRun(db: ArkomDb, ctx: MutationCtx, after: Record<string, unknown>): void {
  try {
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      log({ entity: "backup", entityId: String(after.atMs ?? Date.now()), action: "run", before: null, after });
    });
  } catch (err) {
    // the backup itself matters more than the note about it
    console.error("[backup] could not write the oplog entry:", err);
  }
}

export interface BackupStatus {
  dir: string;
  databasePath: string;
  lastAtMs: number;
  lastStatus: string;
  count: number;
  secondaryPath: string;
  keep: number;
}

export async function backupStatus(db: ArkomDb, ctx: MutationCtx): Promise<BackupStatus> {
  const dir = backupsDir();
  let count = 0;
  try {
    count = (await readdir(dir)).filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX)).length;
  } catch {
    count = 0; // no folder yet — nothing has been backed up
  }
  const settings = getSettings(db, ctx);
  return {
    dir,
    databasePath: resolveDbPath(),
    lastAtMs: settings.backupLastAtMs,
    lastStatus: settings.backupLastStatus,
    count,
    secondaryPath: settings.backupSecondaryPath,
    keep: KEEP_BACKUPS,
  };
}

/* ------------------------------- scheduling ------------------------------- */

const NIGHTLY_HOUR = 3;
const NIGHTLY_MINUTE = 30;

let nightlyTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextNightly(from: Date): number {
  const next = new Date(from);
  next.setHours(NIGHTLY_HOUR, NIGHTLY_MINUTE, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next.getTime() - from.getTime();
}

/**
 * Nightly at 03:30 — after closing, before opening, and not on the hour, where
 * every other scheduled thing on a Windows machine already is.
 *
 * A till that is switched off overnight simply never fires this, which is why
 * the on-close backup exists as well: between them, a shop that turns the
 * machine off every night and one that leaves it on both get covered.
 */
export function startNightlyBackups(db: ArkomDb, getCtx: () => MutationCtx): void {
  const arm = () => {
    if (nightlyTimer) clearTimeout(nightlyTimer);
    nightlyTimer = setTimeout(() => {
      // getCtx() throws on a till that has not been set up. Inside the async
      // wrapper that is a rejection the catch handles; outside it, it would
      // escape the timer AND skip the re-arm, silently ending nightly backups
      // for the life of the process.
      void (async () => {
        await runBackup(db, getCtx(), "nightly");
      })()
        .catch((err) => console.error("[backup] nightly skipped:", err))
        .finally(arm);
    }, msUntilNextNightly(new Date()));
  };
  arm();
}

export function stopNightlyBackups(): void {
  if (nightlyTimer) clearTimeout(nightlyTimer);
  nightlyTimer = null;
}
