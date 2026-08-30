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

/* ---------------------------- availability ---------------------------- */

/** The shape availableForSale needs from a draft — any SaleState satisfies it. */
export interface DraftLikeLine {
  productId: string | null;
  qty: number;
}

/**
 * How many MORE of a quantity-tracked product may go on THIS ticket:
 * what the shelf holds minus what this ticket already claims.
 *
 * `onHand` is passed in because a draft carries no stock figures. Parked
 * tickets are deliberately NOT counted — only serialized units reserve stock,
 * so a parked quantity line is still on the shelf until it is charged. That
 * race (two tills, or a parked ticket resumed later) is caught where it must
 * be: the NEGATIVE_STOCK guard inside the completing transaction. This is a
 * fail-fast layer for the cashier, never the authority.
 */
export function availableForSale(
  productId: string,
  onHand: number,
  draft: { lines: ReadonlyArray<DraftLikeLine> } | null | undefined,
): number {
  const onTicket = (draft?.lines ?? []).reduce(
    (claimed, line) => (line.productId === productId ? claimed + line.qty : claimed),
    0,
  );
  return Math.max(0, onHand - onTicket);
}

/* ------------------------------- tenders ------------------------------- */

/**
 * How a sale is paid.
 *
 * `store_credit` is a voucher the shop owes the customer (ADR-0013 §4). It is a
 * TENDER, never a document line: putting it on the ticket as a negative line
 * would change the taxable base and the printed IVA breakdown, so the goods keep
 * their value and the voucher pays for them the way cash does.
 */
/**
 * Note `deposit`: it is a tender the till can BUILD but never one a renderer may
 * SEND. A repair's deposit was taken weeks ago and is applied by main from the
 * ticket's own row (ADR-0014 §7), so it is absent from `TenderMethodSchema` —
 * the payload schema — and present here, where main constructs the row. A
 * renderer that tries to send one is refused at the bridge.
 */
export type TenderMethod = "cash" | "card" | "bizum" | "transfer" | "store_credit" | "deposit";

export interface TenderDraft {
  method: TenderMethod;
  amountCents: number;
  cardReference?: string | null;
  /** which voucher is being spent — required for, and only for, store_credit */
  voucherId?: string | null;
}

export interface TenderSummary {
  paidCents: number;
  nonCashCents: number;
  remainingCents: number;
  changeCents: number;
  /** true when a tender that cannot give change exceeds the total (TENDER_MISMATCH). */
  nonCashExcess: boolean;
}

/**
 * Which tenders may exceed the total, i.e. may leave change in the drawer.
 *
 * **Cash**, obviously. **Store credit**, since v0.11.0: a voucher is money the
 * shop already owes this customer, so handing back the difference is settling a
 * debt, not advancing cash — and the cashier chose to do it (see redeemPlan).
 * Card, Bizum and transfer never can: change against a card payment is a cash
 * advance, and the way that gets abused is well known.
 */
const CAN_GIVE_CHANGE: ReadonlySet<TenderMethod> = new Set(["cash", "store_credit"]);

/**
 * Tenders that cannot leave change but are not a "card excess" either.
 *
 * A deposit larger than the final bill is not an overpayment the cashier must
 * explain — it is money the shop owes back, and the hand-back flow settles it.
 * Refusing the collection outright would strand a customer whose repair came in
 * cheaper than quoted.
 */
const PREPAID: ReadonlySet<TenderMethod> = new Set(["deposit"]);

/** Pure running summary for the payment panel; throws only on malformed amounts. */
export function tenderSummary(totalCents: number, tenders: ReadonlyArray<TenderDraft>): TenderSummary {
  let paidCents = 0;
  let nonCashCents = 0;
  for (const tender of tenders) {
    if (!Number.isInteger(tender.amountCents) || tender.amountCents <= 0) {
      throw appError("VALIDATION", "Importe de pago no válido.", "amountCents");
    }
    paidCents += tender.amountCents;
    if (!CAN_GIVE_CHANGE.has(tender.method) && !PREPAID.has(tender.method)) {
      nonCashCents += tender.amountCents;
    }
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
    // an anonymous credit tender would be money off the total with nothing to
    // mark spent, which is a hole in the books rather than a payment
    if (tender.method === "store_credit" && !tender.voucherId) {
      throw appError("VALIDATION", "Un pago con saldo debe indicar el vale.", "voucherId");
    }
  }
  const vouchers = tenders.filter((t) => t.method === "store_credit").map((t) => t.voucherId);
  if (new Set(vouchers).size !== vouchers.length) {
    throw appError("VALIDATION", "Ese vale ya está en este ticket.", "voucherId");
  }
  const summary = tenderSummary(totalCents, tenders);
  if (summary.nonCashExcess) {
    throw appError("TENDER_MISMATCH", "Tarjeta, Bizum y transferencia no pueden superar el total.");
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
