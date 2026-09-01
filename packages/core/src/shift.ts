/**
 * The drawer — ADR-0015.
 *
 * Everything here is pure. The expected-cash figure the screen shows live, the
 * one the Z freezes, and the one `db:audit` recomputes months later all come out
 * of `computeShiftTotals()` over rows the caller loaded. There is exactly one
 * implementation of "what should be in the drawer", which is the entire point:
 * an X that ran its own arithmetic would be a second implementation of the day's
 * takings, and it would be the one nobody tested.
 *
 * The other rule this file exists to hold: **sale cash is never copied into the
 * cash-movement ledger** (ADR-0015 §3). Takings are read from the tenders on
 * completed documents; `cash_movements` holds what has no other home. One fact
 * stored twice is a reconciliation bug waiting for the first path that forgets
 * to write the copy.
 */
import { appError } from "./errors";

/* ------------------------------------------------------------- status */

export type ShiftStatus = "open" | "closed";

/**
 * Open means nobody has closed it. There is no status column, no `open` boolean
 * and no channel that accepts one — the discipline ADR-0014 applied to repairs,
 * for the same reason: a stored status is a cache, and a drawer that disagrees
 * with itself is worse than one nobody counted.
 */
export function shiftStatus(shift: { closedAt: Date | number | null }): ShiftStatus {
  return shift.closedAt === null ? "open" : "closed";
}

/* -------------------------------------------------------- denominations */

/**
 * Euro notes and coins, largest first, in cents.
 *
 * The 500 stays even though the shop refuses them: a zero quantity costs nothing
 * and its absence would be a question every single time.
 */
export const DENOMINATIONS_CENTS = [
  50000, 20000, 10000, 5000, 2000, 1000, 500, // notes
  200, 100, 50, 20, 10, 5, 2, 1, // coins
] as const;

export const NOTE_DENOMINATIONS_CENTS = DENOMINATIONS_CENTS.filter((d) => d >= 500);
export const COIN_DENOMINATIONS_CENTS = DENOMINATIONS_CENTS.filter((d) => d < 500);

/** Quantities keyed by the denomination's value in cents: `{"2000": 4}`. */
export type Breakdown = Readonly<Record<string, number>>;

/** What a breakdown adds up to. Unknown keys and bad quantities are refused. */
export function breakdownTotalCents(breakdown: Breakdown): number {
  let total = 0;
  for (const [key, qty] of Object.entries(breakdown)) {
    const value = Number(key);
    if (!DENOMINATIONS_CENTS.includes(value as (typeof DENOMINATIONS_CENTS)[number])) {
      throw appError("VALIDATION", "Denominación desconocida en el desglose.", "breakdown");
    }
    if (!Number.isInteger(qty) || qty < 0) {
      throw appError("VALIDATION", "Cantidad no válida en el desglose.", "breakdown");
    }
    total += value * qty;
  }
  return total;
}

/**
 * The total is the stored authority; the breakdown is evidence for it.
 *
 * They may never disagree, so the disagreement is refused at the boundary rather
 * than audited for later — two numbers that can drift is exactly what ADR-0015 §3
 * rejects everywhere else.
 */
export function assertBreakdownMatches(totalCents: number, breakdown: Breakdown | null | undefined): void {
  if (!breakdown) return;
  const counted = breakdownTotalCents(breakdown);
  if (counted !== totalCents) {
    throw appError("VALIDATION", "El desglose no cuadra con el total contado.", "breakdown");
  }
}

/* ------------------------------------------------------- drawer effect */

/**
 * Which movement reasons move actual notes.
 *
 * A TOTAL map, not a set with a default: a reason added later without a decision
 * about the drawer is then a compile error, which is the only reliable way to
 * keep a classification honest.
 *
 * `repair_deposit_applied` is the interesting one. ADR-0014 posts it so a
 * ticket's rows net to zero, but nothing physical happens at collection — what
 * changed is whose money it is. And there is no double count for it to cancel,
 * because the collection's CASH tender is the remainder, not the whole bill. It
 * moves no notes (ADR-0015 §5).
 */
export const DRAWER_EFFECT = {
  repair_deposit: true,
  repair_deposit_applied: false,
  repair_deposit_refund: true,
  used_purchase_payout: true,
  paid_in: true,
  paid_out: true,
} as const satisfies Record<string, boolean>;

export type CashMovementReason = keyof typeof DRAWER_EFFECT;

export function movesDrawer(reason: string): boolean {
  return DRAWER_EFFECT[reason as CashMovementReason] === true;
}

/* --------------------------------------------------------- sale cash */

export type PaymentMethod = "cash" | "card" | "bizum" | "transfer" | "store_credit" | "deposit";

export interface TenderLike {
  method: string;
  amountCents: number;
}

/**
 * What one completed document did to the drawer.
 *
 *   cash tendered − change given
 *
 * Change is not stored anywhere and must not become stored: it is derivable, and
 * the moment it has a column it can be wrong (ADR-0015 §4). It is derivable
 * because `validateCompletion()` refuses any completion where a tender that
 * cannot give change exceeds the total, so an excess over the total was handed
 * back in notes and `Σ tenders − total` is the amount.
 *
 * Written this way rather than as "sum the cash tenders", the awkward case falls
 * out for free: a store-credit voucher larger than the ticket tenders NO cash and
 * produces positive change, so the drawer goes DOWN on a sale. A cash-only
 * formula would miss it and the shift would come up short with no explanation.
 */
export function documentCashDelta(doc: {
  totalCents: number;
  tenders: ReadonlyArray<TenderLike>;
}): number {
  let cash = 0;
  let paid = 0;
  for (const tender of doc.tenders) {
    paid += tender.amountCents;
    if (tender.method === "cash") cash += tender.amountCents;
  }
  const change = Math.max(0, paid - doc.totalCents);
  return cash - change;
}

/* ------------------------------------------------------------ totals */

export interface ShiftDocumentFact {
  documentId: string;
  docType: string;
  docNumber: string | null;
  number: number | null;
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  tenders: ReadonlyArray<TenderLike>;
  /** per line: the snapshotted regime, so REBU can be split off (ADR-0007) */
  lines: ReadonlyArray<{ taxRegime: string; baseCents: number; taxCents: number; totalCents: number }>;
}

export interface ShiftMovementFact {
  reason: string;
  amountCents: number;
}

/** A deposit taken or given back, by method — read from the ticket, not the ledger. */
export interface ShiftDepositFact {
  kind: "taken" | "refunded";
  method: string;
  amountCents: number;
}

/** A used-device purchase settled in this shift, by payout method. */
export interface ShiftPayoutFact {
  method: string;
  amountCents: number;
}

export interface ShiftFacts {
  openingFloatCents: number;
  documents: ReadonlyArray<ShiftDocumentFact>;
  movements: ReadonlyArray<ShiftMovementFact>;
  deposits: ReadonlyArray<ShiftDepositFact>;
  payouts: ReadonlyArray<ShiftPayoutFact>;
  parkedCount: number;
  /** counted by the caller from the tickets, not guessed from document shapes */
  repairsCollectedCount: number;
}

export interface SeriesRun {
  docType: string;
  count: number;
  firstNumber: string | null;
  lastNumber: string | null;
}

export interface MethodLine {
  method: string;
  /** money the shop took: sale tenders + deposits taken */
  inCents: number;
  /** money the shop gave: payouts, refunds, and change on sales */
  outCents: number;
  netCents: number;
}

export interface ShiftTotals {
  openingFloatCents: number;
  /** Σ (cash tendered − change) over the shift's documents */
  salesCashCents: number;
  /** Σ movements whose reason moves notes */
  movementsCashCents: number;
  expectedCashCents: number;

  netSalesCents: number;
  taxCents: number;
  /** margin-scheme sales: their own line, and no VAT is printed (ADR-0007) */
  usedSalesCents: number;
  grossSalesCents: number;

  tendersByMethod: ReadonlyArray<{ method: string; amountCents: number }>;
  tendersTotalCents: number;
  /** gross − tenders. Non-zero means the till has a bug; the Z says so out loud. */
  tenderImbalanceCents: number;

  movementsByReason: ReadonlyArray<{ reason: string; count: number; amountCents: number }>;
  depositsByMethod: ReadonlyArray<{ method: string; count: number; amountCents: number }>;
  refundsByMethod: ReadonlyArray<{ method: string; count: number; amountCents: number }>;
  payoutsByMethod: ReadonlyArray<{ method: string; count: number; amountCents: number }>;
  /** one line per payment method, netting everything the shift did with it */
  byMethod: ReadonlyArray<MethodLine>;

  series: ReadonlyArray<SeriesRun>;
  usedPurchaseCount: number;
  repairsCollectedCount: number;
  parkedCount: number;
}

/** Methods that can appear on the by-method block, in the order the Z prints them. */
const METHOD_ORDER = ["cash", "card", "bizum", "transfer", "store_credit", "deposit"] as const;

function sortByMethodOrder<T extends { method: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => {
    const ai = METHOD_ORDER.indexOf(a.method as (typeof METHOD_ORDER)[number]);
    const bi = METHOD_ORDER.indexOf(b.method as (typeof METHOD_ORDER)[number]);
    return (ai < 0 ? METHOD_ORDER.length : ai) - (bi < 0 ? METHOD_ORDER.length : bi);
  });
}

/**
 * The whole day, from the rows.
 *
 * Called by the X preview and by the close, so what the screen shows is exactly
 * what a close would freeze (ADR-0015 §12).
 */
export function computeShiftTotals(facts: ShiftFacts): ShiftTotals {
  /* ---- cash: the only figure the drawer is judged against ---- */
  let salesCashCents = 0;
  for (const doc of facts.documents) salesCashCents += documentCashDelta(doc);

  let movementsCashCents = 0;
  for (const movement of facts.movements) {
    if (movesDrawer(movement.reason)) movementsCashCents += movement.amountCents;
  }
  const expectedCashCents = facts.openingFloatCents + salesCashCents + movementsCashCents;

  /* ---- what was sold, split by regime because REBU prints no VAT ---- */
  let netSalesCents = 0;
  let taxCents = 0;
  let usedSalesCents = 0;
  let grossSalesCents = 0;
  for (const doc of facts.documents) {
    grossSalesCents += doc.totalCents;
    for (const line of doc.lines) {
      if (line.taxRegime === "REBU") {
        usedSalesCents += line.totalCents;
      } else {
        netSalesCents += line.baseCents;
        taxCents += line.taxCents;
      }
    }
  }

  /* ---- how it was paid ---- */
  const tenderTotals = new Map<string, number>();
  let tendersTotalCents = 0;
  let changeCents = 0;
  for (const doc of facts.documents) {
    let paid = 0;
    for (const tender of doc.tenders) {
      paid += tender.amountCents;
      tenderTotals.set(tender.method, (tenderTotals.get(tender.method) ?? 0) + tender.amountCents);
      tendersTotalCents += tender.amountCents;
    }
    changeCents += Math.max(0, paid - doc.totalCents);
  }
  /* change comes back out of the drawer, so the tender side is overstated by
     exactly it — subtracting keeps "tenders must equal gross" a real check */
  const cashTendered = tenderTotals.get("cash") ?? 0;
  if (changeCents > 0) tenderTotals.set("cash", cashTendered - changeCents);
  tendersTotalCents -= changeCents;

  const tendersByMethod = sortByMethodOrder(
    [...tenderTotals].map(([method, amountCents]) => ({ method, amountCents })),
  );

  /* ---- non-sale money ---- */
  const movementTotals = new Map<string, { count: number; amountCents: number }>();
  for (const movement of facts.movements) {
    const row = movementTotals.get(movement.reason) ?? { count: 0, amountCents: 0 };
    row.count += 1;
    row.amountCents += movement.amountCents;
    movementTotals.set(movement.reason, row);
  }

  const group = (rows: ReadonlyArray<{ method: string; amountCents: number }>) => {
    const map = new Map<string, { count: number; amountCents: number }>();
    for (const row of rows) {
      const entry = map.get(row.method) ?? { count: 0, amountCents: 0 };
      entry.count += 1;
      entry.amountCents += row.amountCents;
      map.set(row.method, entry);
    }
    return sortByMethodOrder([...map].map(([method, v]) => ({ method, ...v })));
  };

  const depositsByMethod = group(facts.deposits.filter((d) => d.kind === "taken"));
  const refundsByMethod = group(facts.deposits.filter((d) => d.kind === "refunded"));
  const payoutsByMethod = group(facts.payouts);

  /* ---- one line per method, so each can be ticked off a statement ---- */
  const byMethodMap = new Map<string, MethodLine>();
  const line = (method: string) => {
    const existing = byMethodMap.get(method);
    if (existing) return existing;
    const created: MethodLine = { method, inCents: 0, outCents: 0, netCents: 0 };
    byMethodMap.set(method, created);
    return created;
  };
  for (const { method, amountCents } of tendersByMethod) {
    /* the cash tender figure already has change netted out of it above, so a
       negative one (a voucher bigger than the ticket) lands on the OUT side */
    if (amountCents >= 0) line(method).inCents += amountCents;
    else line(method).outCents += -amountCents;
  }
  for (const row of depositsByMethod) line(row.method).inCents += row.amountCents;
  for (const row of refundsByMethod) line(row.method).outCents += row.amountCents;
  for (const row of payoutsByMethod) line(row.method).outCents += row.amountCents;
  /* A manual paid-in or paid-out has no method to record: it IS cash, which is
     why a human had to open the drawer to make it. Without these the cash line
     would not equal the drawer's own figure, and that equality is the whole
     reason this block exists. */
  for (const movement of facts.movements) {
    if (movement.reason === "paid_in") line("cash").inCents += movement.amountCents;
    if (movement.reason === "paid_out") line("cash").outCents += -movement.amountCents;
  }
  const byMethod = sortByMethodOrder([...byMethodMap.values()]);
  for (const row of byMethod) row.netCents = row.inCents - row.outCents;

  /* ---- the gap-free proof, per series ---- */
  const seriesMap = new Map<string, { count: number; first: number; last: number; firstNumber: string; lastNumber: string }>();
  for (const doc of facts.documents) {
    if (doc.number === null || doc.docNumber === null) continue;
    const existing = seriesMap.get(doc.docType);
    if (!existing) {
      seriesMap.set(doc.docType, {
        count: 1,
        first: doc.number,
        last: doc.number,
        firstNumber: doc.docNumber,
        lastNumber: doc.docNumber,
      });
      continue;
    }
    existing.count += 1;
    if (doc.number < existing.first) {
      existing.first = doc.number;
      existing.firstNumber = doc.docNumber;
    }
    if (doc.number > existing.last) {
      existing.last = doc.number;
      existing.lastNumber = doc.docNumber;
    }
  }
  const series: SeriesRun[] = [...seriesMap].map(([docType, v]) => ({
    docType,
    count: v.count,
    firstNumber: v.firstNumber,
    lastNumber: v.lastNumber,
  }));

  return {
    openingFloatCents: facts.openingFloatCents,
    salesCashCents,
    movementsCashCents,
    expectedCashCents,

    netSalesCents,
    taxCents,
    usedSalesCents,
    grossSalesCents,

    tendersByMethod,
    tendersTotalCents,
    tenderImbalanceCents: grossSalesCents - tendersTotalCents,

    movementsByReason: [...movementTotals].map(([reason, v]) => ({ reason, ...v })),
    depositsByMethod,
    refundsByMethod,
    payoutsByMethod,
    byMethod,

    series,
    usedPurchaseCount: facts.documents.filter((d) => d.docType === "purchase").length,
    repairsCollectedCount: facts.repairsCollectedCount,
    parkedCount: facts.parkedCount,
  };
}

/* ---------------------------------------------------------- variance */

/** counted − expected. Negative is SHORT, positive is OVER (ADR-0015 §10). */
export function varianceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}

export function needsVarianceApproval(variance: number, toleranceCents: number): boolean {
  return Math.abs(variance) > toleranceCents;
}
