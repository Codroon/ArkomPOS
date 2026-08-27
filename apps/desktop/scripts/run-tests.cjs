/**
 * Run the main-process tests under ELECTRON'S Node.
 *
 * better-sqlite3 is compiled for Electron's ABI (postinstall:
 * electron-builder install-app-deps), so plain `node` cannot load it — and the
 * approval tests deliberately use a REAL database, because dual attribution is
 * only worth asserting against actual oplog rows. Same trick the db:* scripts
 * use, and the same reason.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const electron = require("electron"); // resolves to the binary path under plain node
const vitest = path.resolve(__dirname, "../../../node_modules/vitest/vitest.mjs");

const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
delete env.NODE_OPTIONS; // inherited flags confuse Electron's Node

const result = spawnSync(
  electron,
  [vitest, "run", "--config", "vitest.config.ts", "--root", ".", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: path.resolve(__dirname, ".."), env },
);
process.exit(result.status ?? 1);
