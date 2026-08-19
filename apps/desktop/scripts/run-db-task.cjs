/**
 * Runs a @arkom/db task (migrate | seed | stats) under Electron's Node.
 *
 * Why not plain `node`: better-sqlite3 is a native module rebuilt for the
 * Electron ABI (postinstall: electron-builder install-app-deps), so any script
 * that opens the database must run on Electron's runtime. We bundle
 * packages/db/src/cli.ts with esbuild, then execute it with
 * ELECTRON_RUN_AS_NODE=1 — same trick electron-builder uses.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const task = process.argv[2];
if (!["migrate", "seed", "stats"].includes(task)) {
  console.error("Usage: node scripts/run-db-task.cjs <migrate|seed|stats>");
  process.exit(2);
}

const desktopDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopDir, "../..");
const entry = path.join(desktopDir, "scripts/db-cli.ts");
// bundle lands under apps/desktop, whose deps include better-sqlite3, so the
// runtime require resolves under either pnpm layout (isolated or hoisted)
const outFile = path.join(desktopDir, "out/db-cli.cjs");

// 1. bundle the TS entry (workspace TS + drizzle bundled; native module external)
const esbuild = require("esbuild");
esbuild.buildSync({
  entryPoints: [entry],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["better-sqlite3", "electron"],
  logLevel: "warning",
});

// 2. run it under Electron's Node
const electron = require("electron"); // resolves to the binary path under plain node
const dbPath = process.env.ARKOM_DB_PATH || path.join(repoRoot, ".data/arkom-pos.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const result = spawnSync(electron, [outFile, task], {
  stdio: "inherit",
  cwd: repoRoot,
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    ARKOM_DB_PATH: dbPath,
    ARKOM_MIGRATIONS_DIR: path.join(repoRoot, "packages/db/drizzle"),
  },
});
process.exit(result.status ?? 1);
