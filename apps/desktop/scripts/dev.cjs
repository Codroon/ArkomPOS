/**
 * `pnpm dev` wrapper. Environments like VS Code extension hosts leak
 * ELECTRON_RUN_AS_NODE=1 into child shells, which makes the Electron binary
 * start in plain-Node mode (electron.app === undefined) and crash the main
 * process. Strip it (and Node debug options) before handing off to electron-vite.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const bin = path.join(__dirname, "../node_modules/electron-vite/bin/electron-vite.js");
const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  cwd: path.join(__dirname, ".."),
});
child.on("exit", (code) => process.exit(code ?? 1));
