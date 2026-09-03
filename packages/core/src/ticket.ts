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
 *
 * The op model and the typography that lays text onto it live in print-ops.ts,
 * shared with the used-device purchase document. This file is the sale ticket
 * and nothing else.
 */
import { formatCents } from "./money";
import {
  COLUMNS_BY_PAPER,
  columnsFor,
  labelledRows,
  letterSpaced,
  formatPrintDate,
  opsToText,
  wrapText,
  type PaperWidthMm,
  type TicketAlign,
  type TicketCutOp,
  type TicketDrawerOp,
  type TicketFeedOp,
  type TicketOp,
  type TicketRuleOp,
  type TicketSize,
  type TicketTextOp,
} from "./print-ops";

/* Re-exported so every existing import of these from "./ticket" still works. */
export { COLUMNS_BY_PAPER, wrapText };
export type {
  PaperWidthMm,
  TicketAlign,
  TicketCutOp,
  TicketDrawerOp,
  TicketFeedOp,
  TicketOp,
  TicketRuleOp,
  TicketSize,
  TicketTextOp,
};

export interface TicketLine {
  description: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
  /** set on serialized lines — the phone that left the shop */
  imei: string | null;
  priceOverridden: boolean;
  /** snapshotted at sale (ADR-0007). "REBU" changes what may be printed. */
  taxRegime?: string | null;
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
  /**
   * A refund, and the ticket it reverses — ADR-0019.
   *
   * Present only on a refund. The customer walks away with a document that
   * names the sale it undoes, because "here is 24,90 €" without a reference is
   * not evidence of anything.
   */
  refundOf?: string;
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
  refund: "DEVOLUCION",
  refundOf: "Del ticket",
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
  rebu: "Régimen especial de bienes usados",
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
  if (doc.refundOf) {
    /* said before anything else: a document handed over at the counter must
       announce what it is before the reader reaches the figures */
    text(letterSpaced(TICKET_ES.refund, cols), { align: "center", bold: true });
    text(`${TICKET_ES.refundOf} ${doc.refundOf}`, { align: "center" });
    feed(1);
  }
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
  for (const row of labelledRows(doc.docNumber, formatPrintDate(doc.completedAtMs), cols)) {
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

  /* A second-hand device sold under REBU carries no VAT the customer may
     deduct, and its price must not appear in the IVA breakdown as though it
     did. Those lines contribute a zero-rate snapshot, so the arithmetic above
     already excludes them; this is the mention the regime requires on the
     document itself. */
  if (doc.lines.some((line) => line.taxRegime === "REBU")) {
    text(TICKET_ES.rebu, { align: "left" });
  }

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
  feed(1);
  /* The number, as bars. A customer coming back tomorrow hands over the
     receipt and the counter scans it — no reading "T1-000482" off a crumpled
     till roll and typing it into a box (ADR-0019). */
  ops.push({ op: "barcode", data: doc.docNumber, caption: doc.docNumber });
  feed(2);
  ops.push({ op: "cut" });

  // the drawer only opens for cash the customer is actually handing over, and
  // never on a reprint — a COPIA must not pop the till open again
  if (!doc.isCopy && !doc.refundOf && doc.tenders.some((t) => t.method === "cash")) {
    ops.push({ op: "drawer" });
  }

  return ops;
}

/**
 * The ops as plain text, exactly as the thermal printer lays them out. Kept
 * under its original name because half the test suite calls it; the
 * implementation is shared with every other printed document.
 */
export function ticketToText(ops: TicketOp[], width: PaperWidthMm = 80): string {
  return opsToText(ops, width);
}
