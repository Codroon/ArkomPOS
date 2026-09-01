/**
 * The Z report, and the X preview that is the same paper without a number.
 *
 * Fixed Spanish, like every other printed document (ADR-0011): the staff toggle
 * changes the screen, never the paper.
 *
 * The doc type takes **totals**, not a shift and a database. A reprint renders
 * the frozen snapshot (ADR-0015 §7) and an X renders a live computation, and the
 * renderer cannot tell them apart — which is exactly the property that keeps a
 * reprint honest. Following the rule CLAUDE.md states for every document: a type
 * that cannot express a claim the facts do not support.
 */
import { formatCents } from "./money";
import { opBuilder, COLUMNS_BY_PAPER, type PaperWidthMm, type TicketOp } from "./print-ops";
import type { ShiftTotals } from "./shift";
import type { ShopProfile } from "./ticket";

export const SHIFT_ES = {
  zTitle: "INFORME Z",
  xTitle: "VISTA X (PROVISIONAL)",
  preview: "PREVIEW",
  xFooter: "No es un cierre. No consume número.",
  till: "Caja",
  opened: "Abierto",
  closed: "Cerrado",
  documents: "DOCUMENTOS",
  sales: "VENTAS",
  base: "Base imponible",
  vat: "IVA 21%",
  used: "Usado (REBU, sin IVA)",
  salesTotal: "TOTAL VENTAS",
  tenders: "COBROS",
  tendersTotal: "TOTAL COBRADO",
  imbalance: "DESCUADRE INTERNO",
  movements: "MOVIMIENTOS (NO VENTAS)",
  byMethod: "POR MEDIO DE PAGO",
  methodIn: "Entra",
  methodOut: "Sale",
  methodNet: "Neto",
  counts: "RECUENTOS",
  usedPurchases: "Compras de usado registradas",
  repairsCollected: "Reparaciones entregadas",
  parked: "Tickets aparcados al cierre",
  float: "Fondo inicial",
  expected: "Efectivo esperado",
  counted: "Efectivo contado",
  variance: "DESCUADRE",
  short: "FALTAN",
  over: "SOBRAN",
  reason: "Motivo",
  approvedBy: "Autorizado por",
  footer: "Informe generado por el TPV",
  copy: "C O P I A",
} as const;

const DOC_TYPE_ES: Record<string, string> = {
  ticket: "Tickets",
  purchase: "Compras",
  repair: "Reparaciones",
  invoice: "Facturas",
  credit_note: "Abonos",
};

const METHOD_ES: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  store_credit: "Saldo a favor",
  deposit: "Depósito aplicado",
};

const REASON_ES: Record<string, string> = {
  repair_deposit: "Depósitos",
  repair_deposit_applied: "Depósitos aplicados",
  repair_deposit_refund: "Devoluciones",
  used_purchase_payout: "Compras de usado",
  paid_in: "Entradas",
  paid_out: "Salidas",
};

export interface ShiftReportDoc {
  /** null for an X — it has no number and consumes none */
  zDocNumber: string | null;
  terminalName: string;
  openedAtMs: number;
  openedByName: string | null;
  /** null while the shift is still open (an X is always taken on an open one) */
  closedAtMs: number | null;
  closedByName: string | null;
  printedAtMs: number;
  isCopy: boolean;
  totals: ShiftTotals;
  /** the counted figures exist only on a Z; an X has nothing to compare against */
  countedCashCents: number | null;
  varianceCents: number | null;
  varianceReason: string | null;
  approvedByName: string | null;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dayStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * The Z, or the X.
 *
 * Zero activity for a kind that EXISTS prints as zero — "none today" is
 * information. A kind this phase does not have (refunds, voids, agency lines)
 * prints nothing at all: `Devoluciones 0,00 €` on every Z for a feature that
 * does not exist would be a lie of implication.
 */
export function renderZReport(doc: ShiftReportDoc, shop: ShopProfile, paper: PaperWidthMm = 80): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[paper];
  const b = opBuilder(cols);
  const isZ = doc.zDocNumber !== null;

  b.text(shop.legalName, { align: "center", bold: true });
  b.text(shop.nif, { align: "center" });
  b.text(shop.address, { align: "center" });
  b.rule();

  /* bold, not double-width: "VISTA X (PROVISIONAL)" is 21 characters and a wide
     row only gets half the columns, so it would wrap into nonsense on 58mm */
  b.text(isZ ? SHIFT_ES.zTitle : SHIFT_ES.xTitle, { align: "center", bold: true });
  b.text(doc.zDocNumber ?? SHIFT_ES.preview, { align: "center", bold: true });
  b.text(`${SHIFT_ES.till} ${doc.terminalName} · ${dayStamp(doc.openedAtMs)}`, { align: "center" });
  if (doc.isCopy) b.text(SHIFT_ES.copy, { align: "center", bold: true });
  b.rule();

  b.pair(SHIFT_ES.opened, `${stamp(doc.openedAtMs)}  ${doc.openedByName ?? "—"}`);
  if (doc.closedAtMs !== null) {
    b.pair(SHIFT_ES.closed, `${stamp(doc.closedAtMs)}  ${doc.closedByName ?? "—"}`);
  }
  b.rule();

  /* ---- the gap-free proof, per series ---- */
  const t = doc.totals;
  if (t.series.length > 0) {
    b.text(SHIFT_ES.documents, { bold: true });
    for (const run of t.series) {
      const label = DOC_TYPE_ES[run.docType] ?? run.docType;
      const range = run.firstNumber === run.lastNumber ? run.firstNumber : `${run.firstNumber} → ${run.lastNumber}`;
      b.pair(`${label}  ${run.count}`, range ?? "");
    }
    b.rule();
  }

  /* ---- what was sold ---- */
  b.text(SHIFT_ES.sales, { bold: true });
  b.pair(SHIFT_ES.base, formatCents(t.netSalesCents));
  b.pair(SHIFT_ES.vat, formatCents(t.taxCents));
  /* the margin scheme prints no VAT, so folding these into the base above would
     misstate the return (ADR-0007) */
  if (t.usedSalesCents !== 0) b.pair(SHIFT_ES.used, formatCents(t.usedSalesCents));
  b.pair(SHIFT_ES.salesTotal, formatCents(t.grossSalesCents), { bold: true });
  b.rule();

  /* ---- how it was paid ---- */
  b.text(SHIFT_ES.tenders, { bold: true });
  for (const row of t.tendersByMethod) {
    b.pair(METHOD_ES[row.method] ?? row.method, formatCents(row.amountCents));
  }
  b.pair(SHIFT_ES.tendersTotal, formatCents(t.tendersTotalCents), { bold: true });
  /* This must never print. It exists so that if the till ever has a bug, the
     paper says so rather than showing two numbers and leaving the reader to
     notice they differ. */
  if (t.tenderImbalanceCents !== 0) {
    b.text(`${SHIFT_ES.imbalance}: ${formatCents(t.tenderImbalanceCents)}`, { bold: true });
  }
  b.rule();

  /* ---- non-sale money ---- */
  if (t.movementsByReason.length > 0) {
    b.text(SHIFT_ES.movements, { bold: true });
    for (const row of t.movementsByReason) {
      b.pair(`${REASON_ES[row.reason] ?? row.reason}  ${row.count}`, formatCents(row.amountCents));
    }
    b.rule();
  }

  /* ---- one line per method, to tick off a statement ---- */
  if (t.byMethod.length > 0) {
    b.text(SHIFT_ES.byMethod, { bold: true });
    for (const row of t.byMethod) {
      b.text(METHOD_ES[row.method] ?? row.method);
      b.pair(`  ${SHIFT_ES.methodIn}`, formatCents(row.inCents));
      b.pair(`  ${SHIFT_ES.methodOut}`, formatCents(row.outCents));
      b.pair(`  ${SHIFT_ES.methodNet}`, formatCents(row.netCents), { bold: true });
    }
    b.rule();
  }

  b.pair(SHIFT_ES.usedPurchases, String(t.usedPurchaseCount));
  b.pair(SHIFT_ES.repairsCollected, String(t.repairsCollectedCount));
  b.pair(SHIFT_ES.parked, String(t.parkedCount));
  b.rule();

  /* ---- the drawer ---- */
  b.pair(SHIFT_ES.float, formatCents(t.openingFloatCents));
  b.pair(SHIFT_ES.expected, formatCents(t.expectedCashCents), { bold: true });
  if (doc.countedCashCents !== null) {
    b.pair(SHIFT_ES.counted, formatCents(doc.countedCashCents));
  }
  if (doc.varianceCents !== null) {
    b.pair(SHIFT_ES.variance, formatCents(doc.varianceCents), { bold: true });
    /* the sign in words: a bare "−4,60 €" is ambiguous to everyone who did not
       write the code that produced it (ADR-0015 §10) */
    if (doc.varianceCents !== 0) {
      const word = doc.varianceCents < 0 ? SHIFT_ES.short : SHIFT_ES.over;
      b.text(`${word} ${formatCents(Math.abs(doc.varianceCents))}`, { bold: true });
    }
  }
  if (doc.varianceReason) b.text(`${SHIFT_ES.reason}: ${doc.varianceReason}`);
  if (doc.approvedByName) b.text(`${SHIFT_ES.approvedBy}: ${doc.approvedByName}`);

  b.rule();
  b.text(isZ ? SHIFT_ES.footer : SHIFT_ES.xFooter, { align: "center" });
  b.feed(3);
  b.cut();
  return b.ops;
}
