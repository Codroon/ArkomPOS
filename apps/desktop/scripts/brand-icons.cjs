/**
 * `pnpm icons:build` — rasterise the brand SVG masters into the PNG set and the
 * multi-resolution .ico Windows needs for the taskbar, Alt-Tab, the installer
 * and desktop shortcuts.
 *
 * Rendering is done by Electron's own Chromium (the same engine that draws the
 * app), so no image dependency is added and the SVG is interpreted exactly as
 * the renderer would. Small sizes come from the reinforced favicon master —
 * the thin bar of the full mark disappears at 16px.
 *
 * The output must not depend on the MACHINE that runs this. `capturePage`
 * returns physical pixels, so on a 125% display a 16px request came back 20px
 * — and the .ico directory still said 16, which is a malformed file. Browsers
 * react to that by ignoring the icon and drawing their own globe, and that is
 * what the cloud's tab was showing. So the scale factor is forced to 1 and
 * every capture is checked against the size it was asked for.
 */
const { app, BrowserWindow, nativeImage } = require("electron");

/* before whenReady, or Chromium has already picked the display's scale */
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const repoRoot = path.resolve(__dirname, "../../..");
const brandDir = path.join(repoRoot, "packages/ui/src/brand");
const outDir = path.join(repoRoot, "apps/desktop/build/icons");

/** below this, use the reinforced master so the bar survives */
const REINFORCE_BELOW = 32;
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZES = [16, 32, 64, 128, 256, 512];

const svg = (name) => fs.readFileSync(path.join(brandDir, name), "utf8");
const masters = {
  square: svg("arkom-tile-square.svg"),
  rounded: svg("arkom-tile-rounded.svg"),
  favicon: svg("arkom-favicon.svg"),
};

let renderWindow = null;
let renderCount = 0;

/**
 * One reusable window, one temp file per render. (A fresh transparent window
 * per size, or a data: URL, both fail with ERR_FAILED after the first load on
 * Windows; a real file URL into a persistent window is reliable.)
 */
async function render(svgText, size) {
  if (!renderWindow) {
    renderWindow = new BrowserWindow({
      width: 512,
      height: 512,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      useContentSize: true,
      webPreferences: { sandbox: true },
    });
  }
  renderWindow.setContentSize(size, size);
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
svg{display:block;width:${size}px;height:${size}px;shape-rendering:geometricPrecision}</style>
${svgText}`;
  const file = path.join(app.getPath("temp"), `codroon-icon-${size}-${renderCount++}.html`);
  fs.writeFileSync(file, html, "utf8");
  await renderWindow.loadURL(pathToFileURL(file).href);
  await new Promise((r) => setTimeout(r, 80)); // let the SVG paint
  const image = await renderWindow.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.unlinkSync(file);

  /* belt and braces: if a machine ever gets past the switch above, normalise
     rather than write a PNG whose bytes disagree with its directory entry */
  const got = image.getSize();
  if (got.width !== size || got.height !== size) {
    console.warn(`  note: ${size}px captured as ${got.width}x${got.height}, resizing`);
    return image.resize({ width: size, height: size, quality: "best" }).toPNG();
  }
  return image.toPNG();
}

/** ICO container holding PNG-encoded entries (Windows Vista+). */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((e, i) => {
    const at = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 0); // 0 means 256
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, at + 1);
    dir.writeUInt8(0, at + 2); // palette
    dir.writeUInt8(0, at + 3); // reserved
    dir.writeUInt16LE(1, at + 4); // colour planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(e.png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  // PNG set (square tile; the rounded variant ships alongside for OS tiles)
  for (const size of PNG_SIZES) {
    const master = size < REINFORCE_BELOW ? masters.favicon : masters.square;
    fs.writeFileSync(path.join(outDir, `icon-${size}.png`), await render(master, size));
  }
  fs.writeFileSync(path.join(outDir, "icon-rounded-512.png"), await render(masters.rounded, 512));
  // electron-builder's conventional entry point
  fs.copyFileSync(path.join(outDir, "icon-512.png"), path.join(repoRoot, "apps/desktop/build/icon.png"));

  /*
   * The cloud's home-screen icon comes from here too, and not from
   * `pnpm brand`, because it is a RASTERISED artifact: the brand script runs
   * before this one and would copy the previous brand's PNG. Square, not the
   * rounded tile — iOS applies its own mask, so a pre-rounded icon gets
   * rounded twice. The tab's favicon is an SVG and `pnpm brand` copies that.
   */
  fs.copyFileSync(
    path.join(outDir, "icon-512.png"),
    path.join(repoRoot, "apps/web/app/apple-icon.png"),
  );

  const entries = [];
  for (const size of ICO_SIZES) {
    const master = size < REINFORCE_BELOW ? masters.favicon : masters.square;
    entries.push({ size, png: await render(master, size) });
  }
  const ico = buildIco(entries);
  fs.writeFileSync(path.join(repoRoot, "apps/desktop/build/icon.ico"), ico);

  /*
   * And the browser tab. An SVG favicon is served beside it and every current
   * browser prefers that, but Safari only learned SVG favicons recently and an
   * .ico is what it falls back to.
   *
   * The one that was committed here was Codroon's hexagon — wrong brand — and
   * MALFORMED besides: its directory claimed 16x16 over a 20x20 PNG, which is
   * why the tab showed a browser's default globe rather than a wrong logo.
   * This one is assembled above, from the same masters, with the reinforced
   * mark at the small sizes.
   */
  fs.writeFileSync(path.join(repoRoot, "apps/web/app/favicon.ico"), ico);

  console.log(`icons written to ${outDir}`);
  console.log(`  PNG: ${PNG_SIZES.join(", ")} (+ rounded 512)`);
  console.log(`  ICO: ${ICO_SIZES.join(", ")} — ${ico.length} bytes`);
  app.exit(0);
});
