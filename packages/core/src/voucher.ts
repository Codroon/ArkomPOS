/**
 * A voucher's balance and status are DERIVED — ADR-0023 §4.
 *
 * `store_credit_vouchers.remaining_cents` used to be written directly and was
 * therefore the only record that credit had been spent. A mutable balance
 * cannot survive two tills: ADR-0022 §7 resolves concurrent edits by
 * last-writer-wins per field, and applied to a number that means two tills each
 * taking €20 from a €30 voucher end up with one of those €20 absent from the
 * record, with nothing anywhere to say it ever existed.
 *
 * So the truth became an insert-only ledger — `voucher_redemptions`, one row
 * per time the credit paid for something — and this file is the arithmetic over
 * it. Exactly the shape ADR-0004 gave stock, four ADRs earlier, for the same
 * reason: rows cannot overwrite each other, so their sum is always every event
 * there has ever been.
 *
 * The consequence worth stating: a double redemption is no longer invisible. It
 * is `sum > faceValue`, which is a number somebody can be shown.
 */
import type { z } from "zod";
import type { VoucherStatusSchema } from "./ipc";

/**
 * What a voucher is for, as stored.
 *
 * Taken from the IPC contract rather than declared again: `VoucherStatusSchema`
 * is what crosses the wire and what the schema's enum holds, and a second
 * spelling here would be a second source of truth for three strings.
 */
export type VoucherStatus = z.infer<typeof VoucherStatusSchema>;

export interface VoucherFacts {
  /** what it was worth when it was issued; never changes */
  amountCents: number;
  /** every redemption this till knows about, in cents */
  redemptions: readonly number[];
  /** set when somebody cancelled it; a fact, not a computation */
  voidReason?: string | null;
}

export interface VoucherState {
  remainingCents: number;
  status: VoucherStatus;
  /**
   * Spent beyond its face value — only reachable when two tills redeemed inside
   * the replication window (ADR-0023 §5).
   *
   * Reported rather than prevented, deliberately and symmetrically with
   * overselling the last phone (ADR-0022 §11): stopping it needs a lock the
   * counter would wait on, and a customer unable to spend their own credit
   * because the shop's internet is down is a worse product than a rare,
   * bounded, visible loss.
   *
   * `remainingCents` is clamped at zero so no screen ever offers a negative
   * balance as spendable, while the overdraft stays readable here.
   */
  overdrawnCents: number;
}

export function voucherState(facts: VoucherFacts): VoucherState {
  const spent = facts.redemptions.reduce((total, amount) => total + amount, 0);
  const left = facts.amountCents - spent;

  return {
    remainingCents: Math.max(0, left),
    overdrawnCents: left < 0 ? -left : 0,
    /* void beats everything: a cancelled voucher is cancelled whatever its
       arithmetic says, and that is a fact somebody recorded rather than a sum */
    status: facts.voidReason ? "void" : left <= 0 ? "redeemed" : "issued",
  };
}

/**
 * May this voucher pay `amountCents` towards something?
 *
 * The LOCAL guard, and the whole of what one till can promise. It refuses to
 * overdraw a voucher it can see — the same guard, in the same place, as a
 * negative on-hand (ADR-0004). It cannot see what another till did in the last
 * few seconds, which is what §5 is about and why the ledger makes the result
 * visible instead of pretending otherwise.
 */
export function canRedeem(facts: VoucherFacts, amountCents: number): boolean {
  if (amountCents <= 0) return false;
  const state = voucherState(facts);
  return state.status === "issued" && amountCents <= state.remainingCents;
}
