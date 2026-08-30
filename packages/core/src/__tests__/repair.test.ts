import { describe, expect, it } from "vitest";
import {
  assertAction,
  assertPhone,
  checkAction,
  collectionTotalCents,
  isOverdue,
  isTerminal,
  latestApproval,
  needsPriceOverride,
  normalizePhone,
  openOrderedParts,
  quoteTotalCents,
  repairStatus,
  ticketMargin,
  warrantyEndsAt,
  workAuthorization,
  type RepairFacts,
  type RepairLineLike,
} from "../repair";
import { AppError } from "../errors";

const AT = (iso: string) => new Date(iso);

function facts(over: Partial<RepairFacts> = {}): RepairFacts {
  return {
    lines: [],
    approvals: [],
    authorizedCapCents: null,
    readyAt: null,
    collectionDocumentId: null,
    notRepairedAt: null,
    notRepairedReason: null,
    ...over,
  };
}

const part = (chargeCents: number, over: Partial<RepairLineLike> = {}): RepairLineLike => ({
  kind: "inventory_part",
  chargeCents,
  qty: 1,
  ...over,
});

const ordered = (over: Partial<RepairLineLike> = {}): RepairLineLike => ({
  kind: "part_on_order",
  chargeCents: 6400,
  qty: 1,
  receivedAt: null,
  ...over,
});

const labor = (chargeCents: number): RepairLineLike => ({ kind: "labor", chargeCents, qty: 1 });

const approval = (approvedTotalCents: number, at = "2026-08-31T10:00:00Z") => ({
  approvedTotalCents,
  createdAt: AT(at),
});

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.ipc.code : `not-an-AppError: ${String(error)}`;
  }
  return "did-not-throw";
}

describe("the status is entailed, never chosen", () => {
  it("starts at Recibido with nothing recorded", () => {
    expect(repairStatus(facts())).toBe("received");
  });

  it("becomes Presupuestado on the first quote line", () => {
    expect(repairStatus(facts({ lines: [labor(1500)] }))).toBe("quoted");
  });

  it("stays Presupuestado while the approval does not cover the total", () => {
    // approved 79 €, quote is now 95 €: the customer agreed to a different job
    const f = facts({ lines: [part(8000), labor(1500)], approvals: [approval(7900)] });
    expect(quoteTotalCents(f.lines)).toBe(9500);
    expect(repairStatus(f)).toBe("quoted");
  });

  it("becomes En reparación once an approval covers the total", () => {
    expect(repairStatus(facts({ lines: [part(6400), labor(1500)], approvals: [approval(7900)] }))).toBe(
      "in_repair",
    );
  });

  it("becomes En reparación on an intake cap alone — no approval needed", () => {
    // the customer signed "repair up to 100 €" when they left the device
    const f = facts({ lines: [part(6400), labor(1500)], authorizedCapCents: 10000 });
    expect(repairStatus(f)).toBe("in_repair");
    expect(workAuthorization(f).source).toBe("cap");
  });

  it("does not treat a cap smaller than the quote as authorization", () => {
    const f = facts({ lines: [part(9000)], authorizedCapCents: 5000 });
    expect(repairStatus(f)).toBe("quoted");
    expect(workAuthorization(f).authorized).toBe(false);
  });

  it("becomes Esperando pieza from an open ordered line, and clears by itself", () => {
    const waiting = facts({ lines: [ordered(), labor(1500)], approvals: [approval(7900)] });
    expect(repairStatus(waiting)).toBe("waiting_part");

    // nothing is toggled: the part arriving IS the transition
    const arrived = facts({
      lines: [ordered({ receivedAt: AT("2026-09-01T09:00:00Z") }), labor(1500)],
      approvals: [approval(7900)],
    });
    expect(repairStatus(arrived)).toBe("in_repair");
  });

  it("does not wait for a part on an unauthorized ticket — it is still just quoted", () => {
    expect(repairStatus(facts({ lines: [ordered()] }))).toBe("quoted");
  });

  it("becomes Listo, then Entregado, then stays there", () => {
    const ready = facts({
      lines: [part(6400)],
      approvals: [approval(6400)],
      readyAt: AT("2026-09-01T12:00:00Z"),
    });
    expect(repairStatus(ready)).toBe("ready");

    const collected = facts({ ...ready, collectionDocumentId: "doc-1" });
    expect(repairStatus(collected)).toBe("collected");

    // an edit to a line does not resurrect a closed ticket
    expect(repairStatus({ ...collected, lines: [part(6400), labor(500)] })).toBe("collected");
  });

  it("puts No reparado above everything", () => {
    const f = facts({
      lines: [part(6400)],
      approvals: [approval(6400)],
      readyAt: AT("2026-09-01T12:00:00Z"),
      notRepairedAt: AT("2026-09-02T09:00:00Z"),
      notRepairedReason: "unrepairable",
    });
    expect(repairStatus(f)).toBe("not_repaired");
  });

  it("never authorizes an empty quote", () => {
    // "approved 0 €" must not become a licence to charge later
    const f = facts({ approvals: [approval(0)], authorizedCapCents: 10000 });
    expect(workAuthorization(f).authorized).toBe(false);
    expect(repairStatus(f)).toBe("received");
  });
});

describe("approval binds to an amount", () => {
  it("keeps both approvals when a quote rises and is approved again", () => {
    const approvals = [approval(7900, "2026-08-31T10:00:00Z"), approval(14500, "2026-09-01T11:00:00Z")];
    const f = facts({ lines: [part(13000), labor(1500)], approvals });

    expect(approvals).toHaveLength(2); // the first is not overwritten
    expect(latestApproval(f.approvals)!.approvedTotalCents).toBe(14500);
    expect(repairStatus(f)).toBe("in_repair");
  });

  it("falls back to Presupuestado the moment the total passes what was approved", () => {
    const before = facts({ lines: [part(6400), labor(1500)], approvals: [approval(7900)] });
    expect(repairStatus(before)).toBe("in_repair");

    const after = facts({ ...before, lines: [part(6400), labor(1500), part(3000)] });
    expect(repairStatus(after)).toBe("quoted");
  });

  it("reads the latest approval regardless of the order they arrive in", () => {
    const out_of_order = [approval(14500, "2026-09-01T11:00:00Z"), approval(7900, "2026-08-31T10:00:00Z")];
    expect(latestApproval(out_of_order)!.approvedTotalCents).toBe(14500);
  });
});

describe("what an action needs", () => {
  const authorized = facts({ lines: [part(6400), labor(1500)], approvals: [approval(7900)] });

  it("refuses mark_ready without authorization, and says which fact is missing", () => {
    expect(checkAction(facts({ lines: [part(6400)] }), "mark_ready")).toBe("not_authorized");
    expect(checkAction(facts(), "mark_ready")).toBe("no_lines");
  });

  it("refuses mark_ready while a part is on order", () => {
    const waiting = facts({ lines: [ordered(), labor(1500)], approvals: [approval(7900)] });
    expect(checkAction(waiting, "mark_ready")).toBe("waiting_part");
  });

  it("allows mark_ready when the facts are all there", () => {
    expect(checkAction(authorized, "mark_ready")).toBeNull();
  });

  it("refuses collect until the ticket is ready", () => {
    expect(checkAction(authorized, "collect")).toBe("not_ready");
    expect(checkAction({ ...authorized, readyAt: AT("2026-09-01T12:00:00Z") }, "collect")).toBeNull();
  });

  it("refuses everything on a closed ticket", () => {
    const collected = { ...authorized, readyAt: AT("2026-09-01T12:00:00Z"), collectionDocumentId: "d" };
    for (const action of ["quote", "approve", "mark_ready", "collect", "mark_not_repaired"] as const) {
      expect(checkAction(collected, action), action).toBe("terminal");
    }
  });

  it("refuses not_repaired without a reason", () => {
    expect(checkAction(authorized, "mark_not_repaired", {})).toBe("no_reason");
  });

  it("refuses not_repaired while a consumed part is unresolved", () => {
    // the screen is off the shelf: it goes back, or it gets charged
    expect(
      checkAction(authorized, "mark_not_repaired", { reason: "unrepairable", unresolvedPartCount: 1 }),
    ).toBe("unresolved_parts");
    expect(
      checkAction(authorized, "mark_not_repaired", { reason: "unrepairable", unresolvedPartCount: 0 }),
    ).toBeNull();
  });

  it("throws a typed error carrying the Spanish reason", () => {
    expect(code(() => assertAction(facts(), "mark_ready"))).toBe("VALIDATION");
  });

  it("knows which statuses are terminal", () => {
    expect(isTerminal("collected")).toBe(true);
    expect(isTerminal("not_repaired")).toBe(true);
    expect(isTerminal("ready")).toBe(false);
  });
});

describe("charges after approval", () => {
  const approved = facts({ lines: [part(6400), labor(1500)], approvals: [approval(7900)] });

  it("needs an override to LOWER a charge once the customer has approved", () => {
    // they agreed to 79 €; settling at 60 € is a difference nobody recorded
    expect(needsPriceOverride(approved, { lineId: "l1", fromCents: 6400, toCents: 5000 })).toBe(true);
  });

  it("needs none to raise one — the fall-back to Presupuestado is the control", () => {
    expect(needsPriceOverride(approved, { lineId: "l1", fromCents: 6400, toCents: 9000 })).toBe(false);
  });

  it("needs none before any approval exists", () => {
    const unapproved = facts({ lines: [part(6400)] });
    expect(needsPriceOverride(unapproved, { lineId: "l1", fromCents: 6400, toCents: 1000 })).toBe(false);
  });

  it("needs none for a no-op", () => {
    expect(needsPriceOverride(approved, { lineId: "l1", fromCents: 6400, toCents: 6400 })).toBe(false);
  });
});

describe("money", () => {
  it("collects exactly the charged total, never a typed number", () => {
    const lines = [part(6400), labor(1500)];
    expect(collectionTotalCents(lines)).toBe(7900);
    expect(collectionTotalCents(lines)).toBe(quoteTotalCents(lines));
  });

  it("computes margin from cost snapshots, ignoring what has no cost", () => {
    const lines = [
      { ...part(6400), unitCostCents: 3400 },
      { ...part(0), unitCostCents: 120 }, // adhesive, included in the screen price
      labor(1500),
    ];
    const margin = ticketMargin(lines);
    expect(margin.chargeCents).toBe(7900);
    expect(margin.costCents).toBe(3520);
    expect(margin.marginCents).toBe(4380);
    expect(margin.marginPct).toBe(55);
  });

  it("has no margin percentage on a zero-charge job rather than 0%", () => {
    // warranty rework: a real job with a real cost and nothing to divide by
    const margin = ticketMargin([{ ...part(0), unitCostCents: 3400 }]);
    expect(margin.marginCents).toBe(-3400);
    expect(margin.marginPct).toBeNull();
  });

  it("counts a part per unit of quantity", () => {
    expect(ticketCostOf([{ ...part(0), unitCostCents: 500, qty: 3 }])).toBe(1500);
  });
});

/** local helper so the cost assertion above reads as one line */
function ticketCostOf(lines: Parameters<typeof ticketMargin>[0]): number {
  return ticketMargin(lines).costCents;
}

describe("warranty and promises", () => {
  it("ends the warranty the snapshotted number of months later", () => {
    expect(warrantyEndsAt(AT("2026-08-09T10:00:00Z"), 3).toISOString().slice(0, 10)).toBe("2026-11-09");
  });

  it("is overdue only when promised, past, and still in the shop", () => {
    const now = AT("2026-09-05T10:00:00Z");
    const past = AT("2026-09-01T10:00:00Z");
    expect(isOverdue(past, "in_repair", now)).toBe(true);
    expect(isOverdue(past, "waiting_part", now)).toBe(true);
    // a device the customer can come and get is not overdue
    expect(isOverdue(past, "ready", now)).toBe(false);
    expect(isOverdue(past, "collected", now)).toBe(false);
    // no promise, no fiction
    expect(isOverdue(null, "in_repair", now)).toBe(false);
  });
});

describe("customer phone dedupe", () => {
  it("treats every spelling of one number as one customer", () => {
    const forms = ["671220918", "+34 671 22 09 18", "0034671220918", "34 671220918", "671-220-918"];
    const normalized = new Set(forms.map(normalizePhone));
    expect([...normalized]).toEqual(["671220918"]);
  });

  it("leaves a foreign number alone rather than guessing", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
  });

  it("refuses something that is not a phone number", () => {
    expect(code(() => assertPhone("n/a"))).toBe("VALIDATION");
    expect(assertPhone("+34 671 220 918")).toBe("671220918");
  });
});

describe("open ordered parts", () => {
  it("counts only what has not arrived", () => {
    expect(
      openOrderedParts([
        ordered(),
        ordered({ receivedAt: AT("2026-09-01T09:00:00Z") }),
        part(6400),
        labor(1500),
      ]),
    ).toBe(1);
  });
});
