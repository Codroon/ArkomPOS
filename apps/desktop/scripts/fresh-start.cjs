/**
 * `pnpm fresh` — put this machine's dev data aside and start onboarding again.
 *
 * DEVELOPMENT ONLY, and it deletes nothing. The dev database, the device
 * photographs and the backups are MOVED into `.archive/<timestamp>/`, so a
 * walk-through of first run costs nothing and yesterday's data is one `mv`
 * away. A shop's till has no such command on purpose: wiping the books is not
 * something a screen — or a script that ships — should offer (DEPLOYMENT §9).
 *
 *   pnpm fresh              archive, then launch the app into onboarding
 *   pnpm fresh --no-launch  archive only
 */
const { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const repoRoot = resolve(__dirname, "../../..");
const devData = join(repoRoot, ".data"); // the dev database lives here
const userData = join(process.env.APPDATA || join(process.env.HOME || "", ".config"), "Arkom POS (dev)");

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, "-")
  .slice(0, 19);
const archive = join(repoRoot, ".archive", stamp);

/** Move a folder aside if it has anything in it. Never deletes. */
function archiveDir(from, label) {
  if (!existsSync(from)) return null;
  if (!statSync(from).isDirectory()) return null;
  if (readdirSync(from).length === 0) return null;
  const to = join(archive, label);
  mkdirSync(archive, { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    /* Electron may still hold the WAL open, or the folder may sit on another
       volume: copy it instead, and only then remove the original */
    const { cpSync } = require("node:fs");
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
  return to;
}

if (process.env.NODE_ENV === "production") {
  console.error("fresh-start is a development script and does not run against a packaged till.");
  process.exit(2);
}

const moved = [
  ["dev-database", archiveDir(devData, "dev-database")],
  ["userData", archiveDir(userData, "userData")],
].filter(([, to]) => to !== null);

if (moved.length === 0) {
  console.log("Nothing to archive — this machine is already on a fresh till.");
} else {
  console.log("Moved aside (nothing deleted):");
  for (const [label, to] of moved) console.log(`  ${label} → ${to}`);
}
console.log("\nThe next launch will open on first run: language → shop → owner → printer.");

if (process.argv.includes("--no-launch")) process.exit(0);

console.log("Starting the app…\n");
const child = spawn("pnpm", ["dev"], { cwd: repoRoot, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
