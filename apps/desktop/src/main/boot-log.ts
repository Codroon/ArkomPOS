/**
 * The log of last resort — v1.0.0.
 *
 * Everything else in this app logs through `installErrorLogging()`, which runs
 * inside `app.whenReady()`. A failure BEFORE that — a module that throws while
 * loading, a native binding that will not bind, a missing resource in the
 * packaged bundle — leaves the shop with a window that never appears, an exit
 * code of zero and not one line anywhere saying why. That is what happened on
 * the v1.0.0 release rehearsal, and it cost an hour of guessing.
 *
 * So this module is imported first, before anything that can fail, and writes
 * to a path that needs no Electron API and no configuration: the OS temp
 * directory. It is the only file in main that may not import from Electron.
 */
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BOOT_LOG = join(tmpdir(), "arkom-boot.log");

function write(line: string): void {
  try {
    appendFileSync(BOOT_LOG, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {
    /* the log of last resort cannot itself become a reason not to boot */
  }
}

process.on("uncaughtException", (err) => {
  write(`uncaught: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
process.on("unhandledRejection", (reason) => {
  write(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});

write("main process starting");

/** For the boot steps worth naming, so a half-failure says how far it got. */
export function bootStep(step: string): void {
  write(step);
}

export const BOOT_LOG_PATH = BOOT_LOG;
