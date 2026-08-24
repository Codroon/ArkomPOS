/**
 * Bundles and runs scripts/imei-gen.ts. Unlike the db tasks this touches no
 * native module, so plain Node runs it — no Electron round-trip needed.
 */
const path = require("node:path");

const desktopDir = path.resolve(__dirname, "..");
const outFile = path.join(desktopDir, "out/imei-gen.cjs");

require(path.join(desktopDir, "node_modules/esbuild")).buildSync({
  entryPoints: [path.join(desktopDir, "scripts/imei-gen.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  logLevel: "warning",
});

require(outFile); // reads the count from process.argv[2]
