/**
 * The printer op-list, and the typography that lays text onto it.
 *
 * Extracted from ticket.ts when the used-device slice added a second printed
 * document. Both the sale ticket and the purchase document render into the same
 * ops, so the ESC/POS encoder and the PDF renderer each learn one model, and a
 * fix to word-wrapping cannot fix one document and miss the other.
 *
 * Nothing here knows about ESC/POS, PDFs, Electron or files.
 */

export type TicketAlign = "left" | "center" | "right";

/** Character-cell multipliers, the two axes ESC/POS actually offers. */
export type TicketSize = "normal" | "wide" | "tall" | "big";

export interface TicketTextOp {
  op: "text";
  text: string;
  align: TicketAlign;
  bold: boolean;
  size: TicketSize;
  /**
   * What this line is, for renderers that treat it differently — v1.1.0.
   *
   * The PDF gives the shop's name the wordmark face and an underline. It used
   * to find that line by comparing its text to a constant, which worked while
   * every ticket in the world said ARKOM. Now the name is the shop's own, so
   * the line declares its role and the renderer reads it. Paper ignores this:
   * ESC/POS has one face.
   */
  role?: "brand" | "tagline";
}
/** A full-width dashed separator. */
export interface TicketRuleOp {
  op: "rule";
  char: string;
}
export interface TicketFeedOp {
  op: "feed";
  lines: number;
}
export interface TicketCutOp {
  op: "cut";
}
/** Kick the cash drawer. Only ever emitted for an original cash sale. */
export interface TicketDrawerOp {
  op: "drawer";
}

/**
 * The document's own number, as bars.
 *
 * So tomorrow's refund is scan → peek → Refund, instead of somebody reading
 * "T1-000482" off a crumpled receipt and typing it into a search box.
 *
 * Code128 because it takes the letters and the dash without a second thought;
 * EAN-13 could not carry "T1-" at all.
 */
export interface TicketBarcodeOp {
  op: "barcode";
  data: string;
  /** printed under the bars, so a torn label is still readable by a human */
  caption: string;
}

export type TicketOp =
  | TicketTextOp
  | TicketRuleOp
  | TicketFeedOp
  | TicketCutOp
  | TicketDrawerOp
  | TicketBarcodeOp;

/** Paper the shop can load. 80mm is the counter printer; 58mm is the fallback roll. */
export type PaperWidthMm = 80 | 58;

/** Printable character columns at Font A for each roll. */
export const COLUMNS_BY_PAPER: Record<PaperWidthMm, number> = { 80: 42, 58: 32 };

/** Columns a line actually gets: the double-width sizes halve the row. */
export function columnsFor(size: TicketSize, cols: number): number {
  return size === "wide" || size === "big" ? Math.floor(cols / 2) : cols;
}

/**
 * Word-wrap to `cols`. Never truncates: a word longer than the line (a 15-digit
 * IMEI on 58mm paper, a German-length product name) is hard-split rather than
 * silently cut, because a half-printed product name on a receipt is worse than
 * an ugly one.
 */
export function wrapText(text: string, cols: number): string[] {
  if (cols <= 0) return [text];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      let w = word;
      // a word that cannot fit on its own line gets broken across lines
      while (w.length > cols) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= cols) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out.length > 0 ? out : [""];
}

/**
 * "Label................value" as one row. When the pair cannot fit, the value
 * drops to its own right-aligned line instead of colliding with the label.
 */
export function labelledRows(label: string, value: string, cols: number): string[] {
  const gap = cols - label.length - value.length;
  if (gap >= 1) return [label + " ".repeat(gap) + value];
  return [label, value.padStart(cols)];
}

/** "E L E C T R O N I C S" — only when the roll is wide enough to hold it. */
export function letterSpaced(text: string, cols: number): string {
  const spaced = text.split("").join(" ");
  return spaced.length <= cols ? spaced : text;
}

export function formatPrintDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * A small builder so a document reads as the paper reads.
 *
 * `text()` wraps and pushes; `raw()` does not, for the rare line whose leading
 * space is load-bearing (an indented card reference) — wrapText collapses it.
 */
export function opBuilder(cols: number) {
  const ops: TicketOp[] = [];
  return {
    ops,
    text(
      value: string,
      { align = "left", bold = false, size = "normal", role }: Partial<Omit<TicketTextOp, "op" | "text">> = {},
    ): void {
      for (const line of wrapText(value, columnsFor(size, cols))) {
        ops.push({ op: "text", text: line, align, bold, size, ...(role ? { role } : {}) });
      }
    },
    /** the document's own number, as scannable bars */
    barcode(data: string, caption: string): void {
      ops.push({ op: "barcode", data, caption });
    },
    raw(text: string, align: TicketAlign = "left", bold = false): void {
      ops.push({ op: "text", text, align, bold, size: "normal" });
    },
    pair(label: string, value: string, { bold = false, size = "normal" as TicketSize } = {}): void {
      for (const row of labelledRows(label, value, columnsFor(size, cols))) {
        ops.push({ op: "text", text: row, align: "left", bold, size });
      }
    },
    rule(): void {
      ops.push({ op: "rule", char: "-" });
    },
    feed(lines: number): void {
      ops.push({ op: "feed", lines });
    },
    cut(): void {
      ops.push({ op: "cut" });
    },
  };
}

/**
 * The ops as plain text, exactly as the thermal printer lays them out — the
 * double-size rows are stretched so a snapshot shows what the paper shows.
 * Used by the tests and by anything that wants to eyeball a document.
 */
export function opsToText(ops: readonly TicketOp[], width: PaperWidthMm = 80): string {
  const cols = COLUMNS_BY_PAPER[width];
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === "rule") out.push(op.char.repeat(cols));
    else if (op.op === "feed") for (let i = 0; i < op.lines; i++) out.push("");
    else if (op.op === "cut") out.push("-".repeat(cols) + " ✂");
    else if (op.op === "drawer") out.push("[cajón]");
    else if (op.op === "barcode") {
      /* the text rendering is what the TESTS read, so it names the data rather
         than drawing bars nobody could check by eye */
      out.push(`[||| ${op.data} |||]`.padStart(Math.floor((cols + op.data.length + 10) / 2)).padEnd(cols));
      out.push(op.caption.padStart(Math.floor((cols + op.caption.length) / 2)).padEnd(cols));
    }
    else {
      const inner = columnsFor(op.size, cols);
      const padded =
        op.align === "center"
          ? op.text.padStart(Math.floor((inner + op.text.length) / 2)).padEnd(inner)
          : op.align === "right"
            ? op.text.padStart(inner)
            : op.text.padEnd(inner);
      // widen the cells so a double-width row occupies the full roll on screen
      out.push(op.size === "wide" || op.size === "big" ? padded.split("").join(" ").slice(0, cols) : padded);
    }
  }
  return out.map((l) => l.trimEnd()).join("\n");
}
