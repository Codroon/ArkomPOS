/**
 * Ticket ops → a branded PDF.
 *
 * Same op list as the thermal path, different target. The dev machine has no
 * printer and the shop's does not exist until the install visit, so this is not
 * a degraded fallback — it is how the ticket gets checked, and it is the only
 * artefact anyone can email. It gets the full brand treatment: Archivo Black
 * wordmark over the 3px Signal Blue rule (the page's one blue piece), Plex Mono
 * body, Bone ground.
 *
 * Roll width drives the page width, and the page grows to fit the content, so
 * one continuous receipt comes out rather than an A4 sheet with a stub on it.
 */
import { BrowserWindow, app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TICKET_ES, type PaperWidthMm, type TicketOp } from "@arkom/core";

/** 1 CSS px at 96dpi, in microns — printToPDF sizes pages in microns. */
const MICRONS_PER_PX = 264.583;

/** Vendored faces (packages/ui/src/fonts); shipped beside the app when packaged. */
const FONT_FILES = {
  display: "archivo-black-400.woff2",
  mono: "ibm-plex-mono-500.woff2",
  monoBold: "ibm-plex-mono-700.woff2",
} as const;

function fontsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "fonts")
    : join(app.getAppPath(), "../../packages/ui/src/fonts");
}

async function embeddedFontCss(): Promise<string> {
  const faces: string[] = [];
  const dir = fontsDir();
  const specs: [keyof typeof FONT_FILES, string, number][] = [
    ["display", "Arkom Display", 400],
    ["mono", "Arkom Mono", 500],
    ["monoBold", "Arkom Mono", 700],
  ];
  for (const [key, family, weight] of specs) {
    /* inlined as data: URIs — the offscreen page has no origin to load from.
       A missing face is a cosmetic loss, not a reason to refuse the ticket:
       the body font stack falls back to a system monospace and every figure
       still lands where core put it. */
    try {
      const b64 = (await readFile(join(dir, FONT_FILES[key]))).toString("base64");
      faces.push(
        `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;` +
          `src:url(data:font/woff2;base64,${b64}) format("woff2");font-display:block}`,
      );
    } catch {
      /* keep going */
    }
  }
  return faces.join("\n");
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The wordmark and tagline get typographic treatment; everything else is data. */
const isBrand = (text: string): boolean => text === TICKET_ES.brand;
const isTagline = (text: string): boolean =>
  text.replace(/\s+/g, "") === TICKET_ES.tagline.replace(/\s+/g, "");

function opsToHtmlRows(ops: TicketOp[]): string {
  // trailing feed exists to push paper clear of the cutter; a page has no cutter,
  // and keeping it would leave a strip of blank Bone under the footer
  const lastText = ops.map((o) => o.op).lastIndexOf("text");
  const rows: string[] = [];
  for (const [i, op] of ops.entries()) {
    if (op.op === "feed" && i > lastText) continue;
    switch (op.op) {
      case "rule":
        rows.push(`<hr class="rule">`);
        break;
      case "feed":
        rows.push(`<div class="feed" style="height:${op.lines * 8}px"></div>`);
        break;
      case "cut":
        // the paper cut has no meaning on a page; the ticket simply ends
        break;
      case "drawer":
        break;
      case "text": {
        const raw = op.text.trim();
        if (isBrand(raw)) {
          rows.push(`<div class="wordmark">${escapeHtml(raw)}</div><div class="underline"></div>`);
          break;
        }
        if (isTagline(raw)) {
          rows.push(`<div class="tagline">${escapeHtml(TICKET_ES.tagline)}</div>`);
          break;
        }
        if (raw === "") {
          rows.push(`<div class="feed" style="height:6px"></div>`);
          break;
        }
        const cls = [
          "row",
          `a-${op.align}`,
          op.bold ? "b" : "",
          op.size === "big" ? "big" : op.size === "wide" ? "wide" : op.size === "tall" ? "tall" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // pre-wrap keeps the column padding core computed
        rows.push(`<div class="${cls}">${escapeHtml(op.text)}</div>`);
        break;
      }
    }
  }
  return rows.join("\n");
}

/** Exported so a test can prove the PDF path renders a document without asking
    Electron for a window — the HTML IS the page. */
export async function buildHtml(ops: TicketOp[], paperWidthMm: PaperWidthMm): Promise<string> {
  const pageWidthPx = Math.round((paperWidthMm / 25.4) * 96); // mm → px at 96dpi
  const fontSize = paperWidthMm === 58 ? 9.5 : 11;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
${await embeddedFontCss()}
:root{
  --canvas:#f1efe9;   /* Bone */
  --ink:#15181b;      /* Graphite 900 */
  --muted:#70777d;    /* Gray 400 */
  --accent:#2f9bff;   /* Signal Blue — the page's ONE blue piece */
  --line:#c4bfb1;
}
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--canvas)}
body{
  width:${pageWidthPx}px;
  padding:14px 10px 18px;
  font-family:"Arkom Mono",ui-monospace,Consolas,monospace;
  font-weight:500;
  font-size:${fontSize}px;
  line-height:1.45;
  color:var(--ink);
  font-variant-numeric:tabular-nums;
}
.row{white-space:pre-wrap;word-break:break-word}
.a-center{text-align:center}
.a-right{text-align:right}
.a-left{text-align:left}
.b{font-weight:700}
.big{font-size:${fontSize * 1.9}px;font-weight:700;letter-spacing:.02em}
.wide{font-size:${fontSize * 1.5}px;font-weight:700}
.tall{font-weight:700}
.rule{border:0;border-top:1px dashed var(--line);margin:5px 0}
.wordmark{
  font-family:"Arkom Display","Arkom Mono",sans-serif;
  font-weight:400;
  font-size:${fontSize * 2.6}px;
  letter-spacing:.06em;
  text-align:center;
  line-height:1.05;
}
/* the 3px Signal Blue rule the wordmark sits on — nothing else on the page is blue */
.underline{height:3px;background:var(--accent);margin:3px auto 6px;width:62%}
.tagline{
  text-align:center;
  font-size:${fontSize * 0.78}px;
  letter-spacing:.24em;
  color:var(--muted);
  text-transform:uppercase;
}
</style></head><body>
${opsToHtmlRows(ops)}
</body></html>`;
}

/** Where tickets land. Stable per install, and somewhere the owner can find. */
export function ticketsDir(): string {
  return join(app.getPath("userData"), "tickets");
}

/**
 * Renders the ops to a PDF and returns its path. Overwrites the file for a
 * given ticket on purpose: a document is immutable, so re-rendering it should
 * not litter the folder with T1-000042 (3).pdf.
 */
export async function renderTicketPdf(
  ops: TicketOp[],
  paperWidthMm: PaperWidthMm,
  fileBase: string,
): Promise<string> {
  const dir = ticketsDir();
  await mkdir(dir, { recursive: true });

  const htmlPath = join(app.getPath("temp"), `arkom-ticket-${Date.now()}.html`);
  await writeFile(htmlPath, await buildHtml(ops, paperWidthMm), "utf8");

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, offscreen: true },
  });
  try {
    await win.loadURL(pathToFileURL(htmlPath).href);
    // let the embedded faces settle before measuring, or the height is short
    await win.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    const heightPx = (await win.webContents.executeJavaScript(
      "Math.ceil(document.body.getBoundingClientRect().height)",
    )) as number;
    const widthPx = (await win.webContents.executeJavaScript(
      "Math.ceil(document.body.getBoundingClientRect().width)",
    )) as number;

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: {
        width: Math.round(widthPx * MICRONS_PER_PX),
        height: Math.round(Math.max(heightPx, 120) * MICRONS_PER_PX),
      },
    });

    const out = join(dir, `${fileBase}.pdf`);
    await writeFile(out, pdf);
    return out;
  } finally {
    win.destroy();
  }
}
