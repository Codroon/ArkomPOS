/**
 * A voucher's balance, derived from its ledger — ADR-0023 §4.
 *
 * This is money, so the cases are about the arithmetic being boring and the
 * edges being deliberate rather than accidental:
 *
 *   · a partly spent voucher keeps its remainder, because a customer with €50
 *     of credit buying a €10 case walks out with €40 still on the slip;
 *   · zero means finished, and finished is a status somebody can see;
 *   · a cancelled voucher is cancelled whatever the sum says, because somebody
 *     recorded that as a fact;
 *   · and spending past the face value — only reachable when two tills redeem
 *     inside the replication window — is REPORTED, with the overdraft readable,
 *     while the spendable balance is clamped so no screen offers a negative.
 */
import { describe, expect, it } from "vitest";
import { canRedeem, voucherState } from "../voucher";

const v = (amountCents: number, redemptions: number[] = [], voidReason: string | null = null) =>
  voucherState({ amountCents, redemptions, voidReason });

describe("the balance", () => {
  it("is the face value when nothing has been spent", () => {
    expect(v(5000)).toMatchObject({ remainingCents: 5000, status: "issued", overdrawnCents: 0 });
  });

  it("is what is left after a part of it was spent", () => {
    expect(v(5000, [1000])).toMatchObject({ remainingCents: 4000, status: "issued" });
    expect(v(5000, [1000, 1500])).toMatchObject({ remainingCents: 2500, status: "issued" });
  });

  it("is zero, and finished, when every cent is gone", () => {
    expect(v(5000, [5000])).toMatchObject({ remainingCents: 0, status: "redeemed" });
    expect(v(5000, [2000, 3000])).toMatchObject({ remainingCents: 0, status: "redeemed" });
  });

  it("does not care what order the redemptions arrived in", () => {
    /* they replicate, so they arrive in whatever order the cloud ingested
       them, which has nothing to do with the order the shop did them in */
    expect(v(5000, [1000, 2500, 500]).remainingCents).toBe(v(5000, [500, 1000, 2500]).remainingCents);
  });
});

describe("cancelling beats arithmetic", () => {
  it("is void when somebody recorded a reason, whatever is left", () => {
    expect(v(5000, [], "cliente devolvió el teléfono").status).toBe("void");
    expect(v(5000, [2000], "error de caja").status).toBe("void");
  });

  it("is void even when it is also spent out", () => {
    /* the fact wins over the sum: a status derived from a recorded decision
       outranks one derived from a total (ADR-0014 §1, same shape) */
    expect(v(5000, [5000], "anulado").status).toBe("void");
  });
});

describe("spent past its value (§5)", () => {
  it("reports the overdraft instead of hiding it", () => {
    /* the case the ledger exists for: two tills each took €40 from a €50
       voucher before either had heard of the other */
    const state = v(5000, [4000, 4000]);
    expect(state.overdrawnCents).toBe(3000);
    expect(state.status).toBe("redeemed");
  });

  it("clamps the spendable balance at zero, so no screen offers a negative", () => {
    expect(v(5000, [4000, 4000]).remainingCents).toBe(0);
  });

  it("is exactly zero overdrawn when it lands on the value", () => {
    expect(v(5000, [2000, 3000]).overdrawnCents).toBe(0);
  });
});

describe("whether a till may take it", () => {
  it("allows what it can cover", () => {
    expect(canRedeem({ amountCents: 5000, redemptions: [] }, 5000)).toBe(true);
    expect(canRedeem({ amountCents: 5000, redemptions: [1000] }, 4000)).toBe(true);
  });

  it("refuses more than is left — the local guard, same as negative stock", () => {
    expect(canRedeem({ amountCents: 5000, redemptions: [1000] }, 4001)).toBe(false);
    expect(canRedeem({ amountCents: 5000, redemptions: [5000] }, 1)).toBe(false);
  });

  it("refuses a cancelled voucher outright", () => {
    expect(canRedeem({ amountCents: 5000, redemptions: [], voidReason: "anulado" }, 100)).toBe(false);
  });

  it("refuses nothing and refuses negatives", () => {
    /* a redemption spends; a top-up is not a thing this product has */
    expect(canRedeem({ amountCents: 5000, redemptions: [] }, 0)).toBe(false);
    expect(canRedeem({ amountCents: 5000, redemptions: [] }, -100)).toBe(false);
  });

  it("cannot see what another till did a second ago, and that is the point", () => {
    /*
     * Both tills hold the same facts and both say yes, which is how §5 happens
     * and why it is reported rather than prevented. Asking the cloud first
     * would mean a customer cannot spend their own credit when the shop's
     * internet is down.
     */
    const facts = { amountCents: 5000, redemptions: [] };
    expect(canRedeem(facts, 4000)).toBe(true);
    expect(canRedeem(facts, 4000)).toBe(true);
  });
});
