/**
 * The ticket, as a pure function.
 *
 * `renderTicket()` turns a completed sale into a line-model of printer ops. It
 * knows nothing about ESC/POS, PDFs, Electron or files — the same ops drive the
 * thermal printer and the PDF fallback, so the two can never drift apart.
 *
 * ADR-0011: the ticket is a CUSTOMER-facing document, so it renders from the
 * fixed Spanish strings below and never from the UI dictionary. Flipping the
 * staff locale to English must not change a single character of what the
 * customer is handed.
 *
 * Money arrives in integer cents and is formatted once, here, at the edge.
 */
import { formatCents } from "./money";

/* ------------------------------------------------------------------ model */

export type TicketAlign = "left" | "center" | "right";

/** Character-cell multipliers, the two axes ESC/POS actually offers. */
export type TicketSize = "normal" | "wide" | "tall" | "big";

export interface TicketTextOp {
  op: "text";
  text: string;
  align: TicketAlign;
  bold: boolean;
  size: TicketSize;
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

export type TicketOp = TicketTextOp | TicketRuleOp | TicketFeedOp | TicketCutOp | TicketDrawerOp;

/** Paper the shop can load. 80mm is the counter printer; 58mm is the fallback roll. */
export type PaperWidthMm = 80 | 58;

/** Printable character columns at Font A for each roll. */
export const COLUMNS_BY_PAPER: Record<PaperWidthMm, number> = { 80: 42, 58: 32 };

export interface TicketLine {
  description: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
  /** set on serialized lines — the phone that left the shop */
  imei: string | null;
  priceOverridden: boolean;
}

export interface TicketTender {
  method: string;
  amountCents: number;
  cardReference: string | null;
}

export interface TicketDoc {
  docNumber: string;
  completedAtMs: number;
  terminalName: string;
  /** true on every reprint — stamps COPIA and withholds the drawer pulse */
  isCopy: boolean;
  lines: TicketLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  tenders: TicketTender[];
  changeCents: number;
}

/** The shop's own data. Never hardcoded — it comes from Ajustes (settings KV). */
export interface ShopProfile {
  legalName: string;
  nif: string;
  address: string;
  footerLine: string;
}

/* ------------------------------------------------- fixed Spanish (ADR-0011) */

export const TICKET_ES = {
  copy: "COPIA",
  brand: "ARKOM",
  tagline: "ELECTRONICS · PHONES",
  nif: "NIF",
  terminal: "Terminal",
  imei: "IMEI",
  modified: "MODIFICADO",
  base: "Base imponible",
  vat: "IVA 21%",
  total: "TOTAL",
  vatIncluded: "IVA INCLUIDO",
  change: "Cambio",
  thanks: "Gracias por su visita",
  defaultFooter: "Precios claros. Sin letra pequeña.",
} as const;

/** Tender labels. Unknown methods fall back to the raw key rather than guessing. */
export const TICKET_ES_METHODS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
};

/* ----------------------------------------------------------------- helpers */

/** Columns a line actually gets: the double-width sizes halve the row. */
function columnsFor(size: TicketSize, cols: number): number {
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
function labelledRows(label: string, value: string, cols: number): string[] {
  const gap = cols - label.length - value.length;
  if (gap >= 1) return [label + " ".repeat(gap) + value];
  return [label, value.padStart(cols)];
}

/** "E L E C T R O N I C S" — only when the roll is wide enough to hold it. */
function letterSpaced(text: string, cols: number): string {
  const spaced = text.split("").join(" ");
  return spaced.length <= cols ? spaced : text;
}

function formatTicketDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ render */

/**
 * A completed sale → the ops that print it.
 *
 * Prices on the ticket are PVP, i.e. VAT-INCLUSIVE (ADR-0007): each line shows
 * what the customer pays, the base/VAT split is shown as a breakdown, and TOTAL
 * carries "IVA INCLUIDO" beneath it so nobody adds tax twice.
 */
export function renderTicket(doc: TicketDoc, shop: ShopProfile, width: PaperWidthMm = 80): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const ops: TicketOp[] = [];

  const text = (
    value: string,
    { align = "left", bold = false, size = "normal" }: Partial<Omit<TicketTextOp, "op" | "text">> = {},
  ) => {
    for (const line of wrapText(value, columnsFor(size, cols))) {
      ops.push({ op: "text", text: line, align, bold, size });
    }
  };
  const rule = () => ops.push({ op: "rule", char: "-" });
  const feed = (lines: number) => ops.push({ op: "feed", lines });

  /* ---- header ---- */
  if (doc.isCopy) {
    text(letterSpaced(TICKET_ES.copy, cols), { align: "center", bold: true });
    feed(1);
  }
  text(TICKET_ES.brand, { align: "center", bold: true, size: "big" });
  text(letterSpaced(TICKET_ES.tagline, cols), { align: "center" });
  feed(1);

  /* ---- who the shop legally is (Ajustes, never hardcoded) ---- */
  text(shop.legalName, { align: "center", bold: true });
  text(`${TICKET_ES.nif} ${shop.nif}`, { align: "center" });
  text(shop.address, { align: "center" });

  rule();

  /* ---- which sale this is ---- */
  for (const row of labelledRows(doc.docNumber, formatTicketDate(doc.completedAtMs), cols)) {
    ops.push({ op: "text", text: row, align: "left", bold: false, size: "normal" });
  }
  text(`${TICKET_ES.terminal}: ${doc.terminalName}`);

  rule();

  /* ---- the goods ---- */
  for (const line of doc.lines) {
    text(line.description, { bold: true });
    if (line.imei) text(`${TICKET_ES.imei} ${line.imei}`);
    const left = `${line.qty} x ${formatCents(line.unitPriceCents)}`;
    for (const row of labelledRows(left, formatCents(line.totalCents), cols)) {
      ops.push({ op: "text", text: row, align: "left", bold: false, size: "normal" });
    }
    // req 2.4: an overridden price is declared on the customer's copy too
    if (line.priceOverridden) text(TICKET_ES.modified, { align: "right" });
  }

  rule();

  /* ---- what it adds up to ---- */
  for (const [label, cents] of [
    [TICKET_ES.base, doc.subtotalCents],
    [TICKET_ES.vat, doc.taxCents],
  ] as const) {
    for (const row of labelledRows(label, formatCents(cents), cols)) {
      ops.push({ op: "text", text: row, align: "left", bold: false, size: "normal" });
    }
  }
  for (const row of labelledRows(TICKET_ES.total, formatCents(doc.totalCents), columnsFor("big", cols))) {
    ops.push({ op: "text", text: row, align: "left", bold: true, size: "big" });
  }
  text(TICKET_ES.vatIncluded, { align: "right" });

  rule();

  /* ---- how it was paid ---- */
  for (const tender of doc.tenders) {
    const label = TICKET_ES_METHODS[tender.method] ?? tender.method;
    for (const row of labelledRows(label, formatCents(tender.amountCents), cols)) {
      ops.push({ op: "text", text: row, align: "left", bold: false, size: "normal" });
    }
    // emitted raw so the indent survives — wrapText() collapses leading space
    if (tender.cardReference) {
      ops.push({ op: "text", text: `  ${tender.cardReference}`, align: "left", bold: false, size: "normal" });
    }
  }
  if (doc.changeCents > 0) {
    for (const row of labelledRows(TICKET_ES.change, formatCents(doc.changeCents), cols)) {
      ops.push({ op: "text", text: row, align: "left", bold: true, size: "normal" });
    }
  }

  rule();

  /* ---- footer ---- */
  text(shop.footerLine || TICKET_ES.defaultFooter, { align: "center" });
  text(TICKET_ES.thanks, { align: "center" });
  feed(2);
  ops.push({ op: "cut" });

  // the drawer only opens for cash the customer is actually handing over, and
  // never on a reprint — a COPIA must not pop the till open again
  if (!doc.isCopy && doc.tenders.some((t) => t.method === "cash")) {
    ops.push({ op: "drawer" });
  }

  return ops;
}

/**
 * The ops as plain text, exactly as the thermal printer lays them out — the
 * double-size rows are stretched so the snapshot shows what the paper shows.
 * Used by the tests and by anything that wants to eyeball a ticket.
 */
export function ticketToText(ops: TicketOp[], width: PaperWidthMm = 80): string {
  const cols = COLUMNS_BY_PAPER[width];
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === "rule") out.push(op.char.repeat(cols));
    else if (op.op === "feed") for (let i = 0; i < op.lines; i++) out.push("");
    else if (op.op === "cut") out.push("-".repeat(cols) + " ✂");
    else if (op.op === "drawer") out.push("[cajón]");
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
