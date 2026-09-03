/**
 * The Western Union counter, as far as this till is concerned — ADR-0018.
 *
 * Ahmer operates WU's own terminal. There is no API, and this is not the system
 * of record; it is a shadow log so the drawer, the Z and next round's
 * reconciliation import have something to agree with.
 *
 * The one rule everything else follows from: **the principal is pass-through.**
 * Money the shop takes for a send is not the shop's money — it is WU's, held for
 * a few seconds. So a transfer issues no T1 document, carries no VAT, and never
 * appears in a sales figure. What it does touch is the drawer, because the notes
 * are real, and the Z, because a drawer that is €900 heavy needs a sentence
 * explaining why.
 */

export const TRANSFER_KINDS = ["send", "payout"] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const TRANSFER_STATUSES = ["sent", "paid", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** How the customer paid for a SEND. A payout is cash out, by definition. */
export const TRANSFER_METHODS = ["cash", "card"] as const;
export type TransferMethod = (typeof TRANSFER_METHODS)[number];

/** WU issues ten digits. Nothing else is an MTCN. */
export const MTCN_PATTERN = /^\d{10}$/;

export function normalizeMtcn(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

export function isValidMtcn(raw: string): boolean {
  return MTCN_PATTERN.test(normalizeMtcn(raw));
}

/* ------------------------------------------------------------- the drawer */

export interface TransferLike {
  kind: TransferKind;
  principalCents: number;
  feeCents: number;
  /** null on a payout */
  method: TransferMethod | null;
}

/**
 * What one transfer does to the notes in the drawer, in cents.
 *
 * Positive is in, negative is out, zero is "recorded, but the drawer never saw
 * it" — which is exactly a card send: WU is paid by card, the shop's till is not
 * involved, and the Z still has to report it because the shop did the work.
 *
 * A send takes principal **plus fee**: the customer hands over both. A payout
 * gives the principal only — WU's fee was charged at the sending end.
 */
export function transferDrawerDelta(t: TransferLike): number {
  if (t.kind === "payout") return -t.principalCents;
  return t.method === "cash" ? t.principalCents + t.feeCents : 0;
}

/**
 * What a cancellation does: the exact opposite, to the cent.
 *
 * **Including the fee.** WU refunds the whole amount on a cancel, so a shop that
 * kept the fee would be short at the count and unable to say why.
 */
export function transferCancelDelta(t: TransferLike): number {
  return -transferDrawerDelta(t);
}

/* -------------------------------------------------------------- the Z block */

export interface TransferFact {
  kind: TransferKind;
  status: TransferStatus;
  principalCents: number;
  feeCents: number;
  method: TransferMethod | null;
  /** true when the CANCELLATION landed in the shift being totalled */
  cancelledInThisShift: boolean;
  /** true when the transfer itself was logged in the shift being totalled */
  loggedInThisShift: boolean;
}

export interface TransferTotals {
  sendCount: number;
  sendPrincipalCents: number;
  sendFeesCents: number;
  /** the split the shop is asked about first: what came in as notes */
  sendCashPrincipalCents: number;
  sendCashFeesCents: number;
  sendCardPrincipalCents: number;
  sendCardFeesCents: number;

  payoutCount: number;
  payoutPrincipalCents: number;

  cancelCount: number;
  /** signed, as it hit the drawer: negative undoes a cash send */
  cancelDrawerCents: number;

  /** net effect on the notes, which is what the expected-cash figure uses */
  drawerCents: number;
}

export const EMPTY_TRANSFER_TOTALS: TransferTotals = {
  sendCount: 0,
  sendPrincipalCents: 0,
  sendFeesCents: 0,
  sendCashPrincipalCents: 0,
  sendCashFeesCents: 0,
  sendCardPrincipalCents: 0,
  sendCardFeesCents: 0,
  payoutCount: 0,
  payoutPrincipalCents: 0,
  cancelCount: 0,
  cancelDrawerCents: 0,
  drawerCents: 0,
};

/**
 * A shift's transfer activity.
 *
 * A row can contribute twice and it is not a mistake: a send logged this morning
 * and cancelled this afternoon is one send AND one cancellation in today's Z,
 * because the drawer saw both. A send logged yesterday and cancelled today
 * contributes only the cancellation — yesterday's Z is frozen and correct
 * (ADR-0015 §8).
 */
export function computeTransferTotals(facts: ReadonlyArray<TransferFact>): TransferTotals {
  const t: TransferTotals = { ...EMPTY_TRANSFER_TOTALS };

  for (const f of facts) {
    if (f.loggedInThisShift) {
      const delta = transferDrawerDelta(f);
      t.drawerCents += delta;
      if (f.kind === "send") {
        t.sendCount += 1;
        t.sendPrincipalCents += f.principalCents;
        t.sendFeesCents += f.feeCents;
        if (f.method === "cash") {
          t.sendCashPrincipalCents += f.principalCents;
          t.sendCashFeesCents += f.feeCents;
        } else {
          t.sendCardPrincipalCents += f.principalCents;
          t.sendCardFeesCents += f.feeCents;
        }
      } else {
        t.payoutCount += 1;
        t.payoutPrincipalCents += f.principalCents;
      }
    }
    if (f.cancelledInThisShift) {
      const reversal = transferCancelDelta(f);
      t.cancelCount += 1;
      t.cancelDrawerCents += reversal;
      t.drawerCents += reversal;
    }
  }
  return t;
}

/** Nothing happened, so the Z prints nothing rather than a column of zeros. */
export function hasTransferActivity(t: TransferTotals): boolean {
  return t.sendCount > 0 || t.payoutCount > 0 || t.cancelCount > 0;
}
