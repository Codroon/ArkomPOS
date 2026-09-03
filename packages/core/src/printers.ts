/**
 * Reading a Windows printer list like a shop assistant would — v0.18.1.
 *
 * The OS hands the till everything that can accept a print job: the receipt
 * printer on the counter, and half a dozen queues that are really file writers
 * (OneNote, Print to PDF, XPS, a fax modem nobody has used since 2009). To the
 * shop those are noise, and to this app they are worse than noise — a ticket
 * sent to "Microsoft Print to PDF" pops a save dialog on the counter PC and the
 * customer waits while somebody clicks through it.
 *
 * So the picker sorts them: what looks like a receipt printer first, the file
 * writers behind a toggle, and — when exactly one queue looks like the real
 * thing — a suggestion the owner still has to confirm with a test print.
 *
 * Matching on names is a heuristic and is treated as one: it never decides
 * anything on its own, it only changes what is offered first.
 */

/** Queues that write a file rather than pushing paper out of a machine. */
const VIRTUAL = [
  "print to pdf",
  "pdf24",
  "pdfcreator",
  "cutepdf",
  "onenote",
  "xps document writer",
  "microsoft xps",
  "fax",
  "send to onenote",
  "adobe pdf",
];

/**
 * Names a receipt printer plausibly has: the four brands this till is likely to
 * meet in a Spanish phone shop, Epson's TM- model prefix, the word POS, and the
 * two paper widths that appear in model names (TM-T20 58mm, CT-S310 80mm).
 */
const RECEIPT = [
  "citizen",
  "epson",
  "star",
  "bixolon",
  "tm-",
  "pos-",
  "pos58",
  "pos80",
  "receipt",
  "ticket",
  "thermal",
  "58mm",
  "80mm",
];

export interface PrinterLike {
  name: string;
  displayName: string;
}

const haystack = (p: PrinterLike): string => `${p.name} ${p.displayName}`.toLowerCase();

/** A queue that writes a file. Never suggested, and hidden until asked for. */
export function isVirtualQueue(p: PrinterLike): boolean {
  const text = haystack(p);
  return VIRTUAL.some((needle) => text.includes(needle));
}

/** A queue whose name reads like a receipt printer. */
export function looksLikeReceiptPrinter(p: PrinterLike): boolean {
  if (isVirtualQueue(p)) return false;
  const text = haystack(p);
  return RECEIPT.some((needle) => text.includes(needle));
}

export interface PrinterChoices<T extends PrinterLike> {
  /** everything that is not a known file writer, receipt-looking ones first */
  physical: T[];
  /** the file writers, shown only behind "see all printers" */
  virtual: T[];
  /**
   * The one queue worth preselecting, or null.
   *
   * Exactly one, deliberately: with two receipt-looking queues the till has no
   * way to know which one has paper in it, and a wrong guess that the owner
   * confirms by reflex is worse than no guess at all.
   */
  suggestion: T | null;
}

export function classifyPrinters<T extends PrinterLike>(printers: readonly T[]): PrinterChoices<T> {
  const physical = printers.filter((p) => !isVirtualQueue(p));
  const virtual = printers.filter((p) => isVirtualQueue(p));
  const receiptLike = physical.filter((p) => looksLikeReceiptPrinter(p));
  return {
    // receipt-looking first, the rest after, each keeping the OS's own order
    physical: [...receiptLike, ...physical.filter((p) => !receiptLike.includes(p))],
    virtual,
    suggestion: receiptLike.length === 1 ? receiptLike[0]! : null,
  };
}
