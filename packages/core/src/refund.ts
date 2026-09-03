/**
 * Giving money back — ADR-0019.
 *
 * A refund is a **second document**, not an edit. The original ticket stays
 * exactly as it was recorded: it is the fiscal record of a sale that genuinely
 * happened, and a shop that can rewrite yesterday has no record at all
 * (ADR-0007, ADR-0015 §8). The reversal is its own numbered, printable fact
 * pointing back at the sale it undoes.
 *
 * The rule everything else hangs on: **tax reverses at the ORIGINAL line's
 * snapshot.** Not at today's rate, not at the product's current regime. A phone
 * sold under the margin scheme reverses with zero VAT even if the same model is
 * now bought new and sold at 21%, because the money being handed back is the
 * money that was taken.
 */

/** A line of the original ticket, as far as a refund needs to know. */
export interface RefundableLine {
  id: string;
  lineNo: number;
  description: string;
  qty: number;
  /** how much of it has already been given back, across every earlier refund */
  refundedQty: number;
  unitPriceCents: number;
  /** frozen at the sale (ADR-0007). The refund reverses at THIS, always. */
  taxRegime: string;
  taxRateBp: number;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  productId: string | null;
  unitId: string | null;
  lineType: string;
  unitCostCents: number | null;
}

/** What the shop asked to give back on one line. */
export interface RefundLineRequest {
  lineId: string;
  qty: number;
  /** put the goods back on the shelf. Meaningless for labour and services. */
  restock: boolean;
}

/** How much of a line is still refundable. Never negative. */
export function remainingQty(line: RefundableLine): number {
  return Math.max(0, line.qty - line.refundedQty);
}

/**
 * The reversal of one line, at the original's snapshot.
 *
 * Money is computed **per unit from the line's own totals**, not re-derived from
 * a rate: a line of 3 at 9,90 € carries rounding that only its own figures know
 * about, and recomputing 21% of a third of it can miss by a cent. The last unit
 * of a line takes the remainder, so a full refund of every unit sums back to
 * exactly what was charged.
 */
export function reverseLine(
  line: RefundableLine,
  qty: number,
): { baseCents: number; taxCents: number; totalCents: number; unitPriceCents: number } {
  if (qty <= 0) throw new Error("a refund line needs a quantity");
  if (qty > remainingQty(line)) throw new Error("more than was sold");

  /* the whole remainder in one go, or the last of it: hand back exactly what is
     left, so partial refunds of a rounded line always close to zero */
  const isRemainder = qty === remainingQty(line) && line.refundedQty > 0;
  const takesAll = qty === line.qty && line.refundedQty === 0;

  if (takesAll || isRemainder) {
    const alreadyBase = shareOf(line.baseCents, line.refundedQty, line.qty);
    const alreadyTax = shareOf(line.taxCents, line.refundedQty, line.qty);
    const alreadyTotal = shareOf(line.totalCents, line.refundedQty, line.qty);
    return {
      baseCents: -(line.baseCents - alreadyBase),
      taxCents: -(line.taxCents - alreadyTax),
      totalCents: -(line.totalCents - alreadyTotal),
      unitPriceCents: line.unitPriceCents,
    };
  }

  return {
    baseCents: -shareOf(line.baseCents, qty, line.qty),
    taxCents: -shareOf(line.taxCents, qty, line.qty),
    totalCents: -shareOf(line.totalCents, qty, line.qty),
    unitPriceCents: line.unitPriceCents,
  };
}

/** `qty` units' worth of `total`, rounded half-up, never overshooting. */
function shareOf(totalCents: number, qty: number, ofQty: number): number {
  if (ofQty === 0 || qty === 0) return 0;
  if (qty >= ofQty) return totalCents;
  const sign = totalCents < 0 ? -1 : 1;
  const abs = Math.abs(totalCents);
  return sign * Math.round((abs * qty) / ofQty);
}

export interface RefundTotals {
  /** all negative: a refund's figures are the sale's, with the sign flipped */
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lines: Array<{
    line: RefundableLine;
    qty: number;
    restock: boolean;
    baseCents: number;
    taxCents: number;
    totalCents: number;
  }>;
}

/**
 * What a refund comes to, and whether it may happen at all.
 *
 * Refuses at the LINE, not at the document: "you already refunded this" is a
 * different problem from "that ticket is spent", and only the first tells the
 * shop which item to look at.
 */
export function computeRefund(
  original: ReadonlyArray<RefundableLine>,
  requested: ReadonlyArray<RefundLineRequest>,
): RefundTotals {
  const byId = new Map(original.map((l) => [l.id, l]));
  const lines: RefundTotals["lines"] = [];
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;

  const seen = new Set<string>();
  for (const req of requested) {
    if (req.qty <= 0) continue;
    const line = byId.get(req.lineId);
    if (!line) throw new Error(`no such line on that ticket: ${req.lineId}`);
    /* the same line twice in one request would each pass the remaining-qty
       check on its own and together exceed it */
    if (seen.has(req.lineId)) throw new Error("the same line twice in one refund");
    seen.add(req.lineId);

    const reversed = reverseLine(line, req.qty);
    subtotalCents += reversed.baseCents;
    taxCents += reversed.taxCents;
    totalCents += reversed.totalCents;
    lines.push({ line, qty: req.qty, restock: req.restock, ...reversed });
  }

  if (lines.length === 0) throw new Error("a refund needs at least one line");
  return { subtotalCents, taxCents, totalCents, lines };
}

/**
 * Goods coming back onto the shelf.
 *
 * A SERIALIZED unit never goes straight back to sellable. It left the shop, it
 * has been in somebody's pocket, and the shop has not looked at it yet — the
 * same reasoning that puts a bought used device on hold pending review
 * (ADR-0013). Quantity stock has no such question: a sealed screen protector is
 * a screen protector.
 */
export function returnsToReview(lineType: string, unitId: string | null): boolean {
  return unitId !== null || lineType === "serialized_unit";
}

/** Labour, services and anything with no product behind it move no stock. */
export function canRestock(line: RefundableLine): boolean {
  return line.productId !== null || line.unitId !== null;
}
