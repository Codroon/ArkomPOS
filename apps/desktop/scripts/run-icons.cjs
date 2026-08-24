/**
 * Launches brand-icons.cjs as a real Electron app.
 *
 * Some shells (VS Code's task host among them) export ELECTRON_RUN_AS_NODE=1,
 * which makes the Electron binary boot as plain Node — `app` is then undefined
 * and nothing can be rendered. Strip it before handing over, exactly as
 * scripts/dev.cjs does for `pnpm dev`.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

const desktopDir = path.resolve(__dirname, "..");
const electron = require(path.join(desktopDir, "node_modules/electron"));

const child = spawn(electron, [path.join(desktopDir, "scripts/brand-icons.cjs"), ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  cwd: desktopDir,
});
child.on("exit", (code) => process.exit(code ?? 1));
