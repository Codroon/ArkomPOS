/**
 * `pnpm brand <codroon|arkom>` — put one brand on the whole product.
 *
 * The product name and palette live in eleven places across two apps, three
 * languages and a YAML build manifest. That is not a thing to keep in step by
 * hand, and it is the reason white-labelling sounds expensive when it is
 * actually a data change. This script is the data change.
 *
 * It edits files in the working tree and expects the result to be COMMITTED —
 * the active brand is part of what a build is, not an environment variable a
 * release could forget to set. `packages/ui/src/brand/active.json` records
 * which one is on, and a test reads it.
 *
 * What it deliberately does not touch: the appId, anything that prints, and
 * the copyright.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const write = (p, s) => writeFileSync(join(root, p), s, "utf8");

/**
 * Replace, and fail loudly if the pattern found nothing.
 *
 * The check is that the PATTERN MATCHED, not that the text changed — applying
 * the brand that is already on is a legitimate no-op, and an script that threw
 * on it would be useless for verifying the current state.
 */
function sub(text, pattern, replacement, what) {
  if (!text.match(pattern)) throw new Error(`could not apply: ${what}`);
  return text.replace(pattern, replacement);
}

/* The brand definitions are TypeScript for the app's benefit; this script only
   needs the values, so it reads them out rather than importing a compiler. */
function loadBrands() {
  const src = read("packages/ui/src/brand/brands.ts");
  const brands = {};
  for (const match of src.matchAll(/export const [A-Z_]+: Brand = \{([\s\S]*?)\n\};/g)) {
    const body = match[1];
    const pick = (name) => body.match(new RegExp(`\\b${name}: "([^"]+)"`))?.[1];
    const key = pick("key");
    if (!key) continue;
    const palette = {};
    const paletteBody = body.match(/palette: \{([\s\S]*?)\n  \}/)?.[1] ?? "";
    for (const line of paletteBody.matchAll(/"?([a-z-0-9]+)"?: "(#[0-9a-f]{6})"/g)) {
      palette[line[1]] = line[2];
    }
    brands[key] = {
      key,
      productName: pick("productName"),
      wordmark: pick("wordmark"),
      wordmarkSuffix: pick("wordmarkSuffix"),
      masters: {
        square: body.match(/square: "([^"]+)"/)?.[1],
        rounded: body.match(/rounded: "([^"]+)"/)?.[1],
        favicon: body.match(/favicon: "([^"]+)"/)?.[1],
      },
      palette,
      copyright: pick("copyright"),
    };
  }
  return brands;
}

const brands = loadBrands();
const key = (process.argv[2] ?? "").toLowerCase();
const brand = brands[key];

if (!brand) {
  console.error(`usage: pnpm brand <${Object.keys(brands).join("|")}>`);
  process.exit(2);
}

/** Rewrite only the tokens a brand owns; the rest of the palette is the product's. */
function applyPalette(css) {
  let next = css;
  for (const [token, value] of Object.entries(brand.palette)) {
    const pattern = new RegExp(`(--color-${token}:\\s*)#[0-9a-fA-F]{6}`, "g");
    if (!pattern.test(next)) throw new Error(`--color-${token} not found`);
    next = next.replace(new RegExp(`(--color-${token}:\\s*)#[0-9a-fA-F]{6}`, "g"), `$1${value}`);
  }
  return next;
}

const edits = [];

// ---- the two palettes, kept identical by a test ---------------------------
for (const file of ["packages/ui/src/styles/tokens.css", "apps/web/app/globals.css"]) {
  write(file, applyPalette(read(file)));
  edits.push(file);
}

// ---- Windows: title bar, Start menu, Add or remove programs ---------------
{
  let yml = read("apps/desktop/electron-builder.yml");
  yml = sub(yml, /^productName: .+$/m, `productName: ${brand.productName}`, "productName");
  yml = sub(yml, /^(\s+shortcutName: ).+$/m, `$1${brand.productName}`, "shortcutName");
  write("apps/desktop/electron-builder.yml", yml);
  edits.push("apps/desktop/electron-builder.yml");
}

// ---- the main process: app name, window title, the boot log line ----------
{
  let main = read("apps/desktop/src/main/index.ts");
  main = sub(
    main,
    /app\.setName\(app\.isPackaged \? "[^"]+" : "[^"]+ \(dev\)"\);/,
    `app.setName(app.isPackaged ? "${brand.productName}" : "${brand.productName} (dev)");`,
    "app.setName",
  );
  main = sub(main, /(\n    title: )"[^"]+"/, `$1"${brand.productName}"`, "window title");
  write("apps/desktop/src/main/index.ts", main);
  edits.push("apps/desktop/src/main/index.ts");

  let hard = read("apps/desktop/src/main/hardening.ts");
  hard = sub(hard, /`[A-Za-z ]+POS \$\{app\.getVersion\(\)\}/, "`" + brand.productName + " ${app.getVersion()}", "boot log");
  write("apps/desktop/src/main/hardening.ts", hard);
  edits.push("apps/desktop/src/main/hardening.ts");
}

// ---- the renderer's document title ---------------------------------------
{
  /* The title bar takes the DOCUMENT title, not the one the BrowserWindow was
     given — this file is why the first build after the last rename still said
     the old name. It is the easiest of all of these to forget. */
  const file = "apps/desktop/src/renderer/index.html";
  let html = read(file);
  html = sub(html, /<title>[^<]*<\/title>/, `<title>${brand.productName}</title>`, "renderer title");
  write(file, html);
  edits.push(file);
}

// ---- the wordmark, and the product's name wherever copy uses it ----------
/** Every name this product can wear, so copy can be moved from one to another. */
const ALL_PRODUCT_NAMES = Object.values(brands).map((b) => b.productName);

for (const lang of ["es", "en"]) {
  const file = `packages/ui/src/i18n/${lang}.ts`;
  let dict = read(file);
  dict = sub(dict, /("shell\.brand": )"[^"]+"/, `$1"${brand.wordmark}"`, `${lang} shell.brand`);
  dict = sub(dict, /("shell\.brandSuffix": )"[^"]+"/, `$1"${brand.wordmarkSuffix}"`, `${lang} suffix`);
  /* A handful of strings name the product inside a sentence — the welcome
     screen, the used-device gate. Rewriting every known name to the active one
     keeps them right without this script having to know which keys they are,
     and picks up any copy written later. */
  for (const other of ALL_PRODUCT_NAMES) {
    if (other !== brand.productName) dict = dict.split(other).join(brand.productName);
  }
  write(file, dict);
  edits.push(file);
}

// ---- the cloud: rail wordmark and the browser tab -------------------------
{
  const file = "apps/web/src/i18n/index.ts";
  let dict = read(file);
  const full = `${brand.wordmark} ${brand.wordmarkSuffix}`;
  dict = dict.replace(/("app\.brand": )"[^"]+"/g, `$1"${full}"`);
  write(file, dict);
  edits.push(file);

  let layout = read("apps/web/app/layout.tsx");
  layout = sub(layout, /(title: )"[^"]+"/, `$1"${brand.productName}"`, "web title");
  write("apps/web/app/layout.tsx", layout);
  edits.push("apps/web/app/layout.tsx");
}

// ---- a module the cloud can import ---------------------------------------
{
  /* The web needs the brand at build time: the rail shows a wordmark, and only
     Codroon has one drawn as an SVG. Anything else renders its name as type,
     which is honest — a pilot customer has a name, not a logo file. */
  const file = "apps/web/src/brand.ts";
  write(
    file,
    `/**
 * The active brand, for the cloud.
 *
 * GENERATED by \`pnpm brand <key>\`. Edit packages/ui/src/brand/brands.ts.
 */
export const BRAND = {
  key: "${brand.key}",
  productName: "${brand.productName}",
  wordmark: "${brand.wordmark}",
  wordmarkSuffix: "${brand.wordmarkSuffix}",
  copyright: "${brand.copyright}",
} as const;

/** Only Codroon ships a drawn wordmark; every other brand sets its name in type. */
export const HAS_WORDMARK_SVG = ${brand.key === "codroon"};
`,
  );
  edits.push(file);
}

// ---- which masters the icon build rasterises ------------------------------
{
  const file = "apps/desktop/scripts/brand-icons.cjs";
  let icons = read(file);
  icons = sub(icons, /square: svg\("[^"]+"\)/, `square: svg("${brand.masters.square}.svg")`, "square master");
  icons = sub(icons, /rounded: svg\("[^"]+"\)/, `rounded: svg("${brand.masters.rounded}.svg")`, "rounded master");
  icons = sub(icons, /favicon: svg\("[^"]+"\)/, `favicon: svg("${brand.masters.favicon}.svg")`, "favicon master");
  write(file, icons);
  edits.push(file);
}

// ---- and the record of what is on -----------------------------------------
write(
  "packages/ui/src/brand/active.json",
  JSON.stringify(
    {
      key: brand.key,
      productName: brand.productName,
      wordmark: brand.wordmark,
      wordmarkSuffix: brand.wordmarkSuffix,
      copyright: brand.copyright,
      note: "Generated by `pnpm brand <key>`. Edit brands.ts, not this file.",
    },
    null,
    2,
  ) + "\n",
);
edits.push("packages/ui/src/brand/active.json");

console.log(`\n  ${brand.productName} applied\n`);
for (const file of edits) console.log(`    ${file}`);
console.log(`\n  Now run: pnpm --filter arkom-pos icons:build\n`);
