/**
 * Sale domain — tax snapshot per line (ADR-0006/0007), tender math, completion
 * validation, gap-free number allocation (ADR-0008).
 *
 * Money model: `unitPriceCents` is the PVP — IVA-INCLUSIVE, as Spanish retail
 * prices the shelf (the mockup ticket's "1 × 12.90" is what the customer
 * pays). A line's total is therefore exact (qty × PVP, integer); ADR-0006's
 * one-place half-up rounding applies to the base/IVA split derived from it:
 *   base = halfUp(total × 10000 / (10000 + rate_bp)) · tax = total − base.
 * Document totals are the exact sum of line totals.
 */
import { appError } from "./errors";

/** Integer half-up division (ties round up). Non-negative operands only. */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator / 2) / denominator);
}

export interface LineMoney {
  baseCents: number;
  taxCents: number;
  totalCents: number;
}

/** Compute one line's money from qty × PVP with the snapshotted rate. */
export function computeLine(args: { qty: number; unitPriceCents: number; taxRateBp: number }): LineMoney {
  const { qty, unitPriceCents, taxRateBp } = args;
  if (!Number.isInteger(qty) || qty < 1) {
    throw appError("VALIDATION", "La cantidad debe ser un entero ≥ 1.", "qty");
  }
  if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
    throw appError("VALIDATION", "Precio no válido.", "unitPriceCents");
  }
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0) {
    throw appError("VALIDATION", "Tipo de IVA no válido.", "taxRateBp");
  }
  const totalCents = qty * unitPriceCents; // exact — the customer pays qty × PVP
  const baseCents = roundHalfUpDiv(totalCents * 10000, 10000 + taxRateBp);
  return { baseCents, taxCents: totalCents - baseCents, totalCents };
}

/** Document totals = EXACT sum of line totals (ADR-0006). */
export function computeDocumentTotals(lines: ReadonlyArray<LineMoney>): {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
} {
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;
  for (const line of lines) {
    subtotalCents += line.baseCents;
    taxCents += line.taxCents;
    totalCents += line.totalCents;
  }
  return { subtotalCents, taxCents, totalCents };
}

/* ------------------------------- tenders ------------------------------- */

export type TenderMethod = "cash" | "card" | "bizum" | "transfer";

export interface TenderDraft {
  method: TenderMethod;
  amountCents: number;
  cardReference?: string | null;
}

export interface TenderSummary {
  paidCents: number;
  nonCashCents: number;
  remainingCents: number;
  changeCents: number;
  /** true when non-cash tenders exceed the total — completion must refuse (TENDER_MISMATCH). */
  nonCashExcess: boolean;
}

/** Pure running summary for the payment panel; throws only on malformed amounts. */
export function tenderSummary(totalCents: number, tenders: ReadonlyArray<TenderDraft>): TenderSummary {
  let paidCents = 0;
  let nonCashCents = 0;
  for (const tender of tenders) {
    if (!Number.isInteger(tender.amountCents) || tender.amountCents <= 0) {
      throw appError("VALIDATION", "Importe de pago no válido.", "amountCents");
    }
    paidCents += tender.amountCents;
    if (tender.method !== "cash") nonCashCents += tender.amountCents;
  }
  const nonCashExcess = nonCashCents > totalCents;
  return {
    paidCents,
    nonCashCents,
    remainingCents: Math.max(0, totalCents - paidCents),
    // change exists only when cash covers the excess; with non-cash excess there is no valid change
    changeCents: nonCashExcess ? 0 : Math.max(0, paidCents - totalCents),
    nonCashExcess,
  };
}

/**
 * Completion gate (req 2.5/2.6): ≥1 line, tenders cover the total, non-cash
 * never exceeds due (TENDER_MISMATCH — change can only come from cash), every
 * card tender carries a datáfono reference of ≥4 chars.
 */
export function validateCompletion(args: {
  lineCount: number;
  totalCents: number;
  tenders: ReadonlyArray<TenderDraft>;
}): { changeCents: number } {
  const { lineCount, totalCents, tenders } = args;
  if (lineCount < 1) throw appError("VALIDATION", "El ticket no tiene líneas.");
  if (tenders.length === 0) throw appError("VALIDATION", "Añade al menos un pago.");
  for (const tender of tenders) {
    if (tender.method === "card" && (tender.cardReference ?? "").trim().length < 4) {
      throw appError("VALIDATION", "La referencia del datáfono es obligatoria (≥ 4 caracteres).", "cardReference");
    }
  }
  const summary = tenderSummary(totalCents, tenders);
  if (summary.nonCashExcess) {
    throw appError("TENDER_MISMATCH", "Los pagos no en efectivo no pueden superar el total.");
  }
  if (summary.paidCents < totalCents) {
    throw appError("VALIDATION", "Los pagos no cubren el total.", "amountCents");
  }
  return { changeCents: summary.changeCents };
}

/* --------------------- number allocation (ADR-0008) --------------------- */

export interface SeriesState {
  prefix: string;
  nextNumber: number;
}

/**
 * Allocate the next gap-free number: prefix + 6-digit zero-pad. Pure — the
 * caller reads the series row, calls this, and persists `next` INSIDE the same
 * transaction that completes the document (atomic, gap-free by construction).
 */
export function allocateNumber(series: SeriesState): { number: number; docNumber: string; next: SeriesState } {
  const number = series.nextNumber;
  if (!Number.isInteger(number) || number < 1) {
    throw appError("VALIDATION", "Serie de numeración corrupta.");
  }
  return {
    number,
    docNumber: `${series.prefix}${String(number).padStart(6, "0")}`,
    next: { prefix: series.prefix, nextNumber: number + 1 },
  };
}
