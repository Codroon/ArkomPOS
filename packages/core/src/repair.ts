/**
 * Repairs — the domain (ADR-0014).
 *
 * The centre of this file is `repairStatus()`. Everything else exists to feed it
 * or to enforce what it implies.
 *
 * **A repair's status is a claim about facts, so it is computed from them and
 * never stored as an intention.** "En reparación" asserts that a customer
 * approved a price. "Esperando pieza" asserts something is on order. A status
 * somebody typed asserts only that somebody typed it, which is why no function
 * here — and no IPC handler in the app — accepts one.
 *
 * No SQL, no Electron, no dates from the clock: everything takes what it needs
 * as an argument so the same rules run in a test, in main, and (later) in a
 * report.
 */
import { appError } from "./errors";

/* ------------------------------------------------------------------ types */

export const REPAIR_STATUSES = [
  "received",
  "quoted",
  "waiting_part",
  "in_repair",
  "ready",
  "collected",
  "not_repaired",
] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const REPAIR_LINE_KINDS = ["inventory_part", "labor", "part_on_order"] as const;
export type RepairLineKind = (typeof REPAIR_LINE_KINDS)[number];

export const REPAIR_APPROVAL_METHODS = ["in_person", "by_phone"] as const;
export type RepairApprovalMethod = (typeof REPAIR_APPROVAL_METHODS)[number];

export const REPAIR_NOTIFY_METHODS = ["phone", "in_person", "other"] as const;
export type RepairNotifyMethod = (typeof REPAIR_NOTIFY_METHODS)[number];

export const NOT_REPAIRED_REASONS = ["customer_declined", "unrepairable", "abandoned"] as const;
export type NotRepairedReason = (typeof NOT_REPAIRED_REASONS)[number];

export const PROMISED_HALVES = ["morning", "afternoon"] as const;
export type PromisedHalf = (typeof PROMISED_HALVES)[number];

/** Just enough of a line for the rules; the repo passes rows straight in. */
export interface RepairLineLike {
  kind: RepairLineKind;
  chargeCents: number;
  qty: number;
  /** part_on_order only: null until it physically arrives */
  receivedAt?: Date | null;
}

export interface RepairApprovalLike {
  approvedTotalCents: number;
  createdAt: Date;
}

/** The facts a status is derived from. Nothing here is an opinion. */
export interface RepairFacts {
  lines: ReadonlyArray<RepairLineLike>;
  approvals: ReadonlyArray<RepairApprovalLike>;
  /** the signed "repair up to X" authorization taken at intake, if any */
  authorizedCapCents: number | null;
  readyAt: Date | null;
  collectionDocumentId: string | null;
  notRepairedAt: Date | null;
  notRepairedReason: NotRepairedReason | null;
}

/* ------------------------------------------------------------------ money */

/** What the ticket will charge — the number an approval has to cover. */
export function quoteTotalCents(lines: ReadonlyArray<RepairLineLike>): number {
  return lines.reduce((total, line) => total + line.chargeCents, 0);
}

/** What the shop has in it. Labor costs nothing; an unreceived part costs nothing yet. */
export function ticketCostCents(
  lines: ReadonlyArray<RepairLineLike & { unitCostCents?: number | null }>,
): number {
  return lines.reduce((total, line) => total + (line.unitCostCents ?? 0) * line.qty, 0);
}

export interface RepairMargin {
  costCents: number;
  chargeCents: number;
  marginCents: number;
  /** null when nothing is charged — a 0/0 job has no margin, not a 0% one */
  marginPct: number | null;
}

export function ticketMargin(
  lines: ReadonlyArray<RepairLineLike & { unitCostCents?: number | null }>,
): RepairMargin {
  const chargeCents = quoteTotalCents(lines);
  const costCents = ticketCostCents(lines);
  const marginCents = chargeCents - costCents;
  return {
    costCents,
    chargeCents,
    marginCents,
    marginPct: chargeCents > 0 ? Math.round((marginCents / chargeCents) * 100) : null,
  };
}

/* ------------------------------------------------------------ the rules */

/** A part we are waiting for: ordered, not yet arrived, not removed. */
export function openOrderedParts(lines: ReadonlyArray<RepairLineLike>): number {
  return lines.filter((line) => line.kind === "part_on_order" && !line.receivedAt).length;
}

/** The approval that currently stands — the most recent one, if any. */
export function latestApproval(
  approvals: ReadonlyArray<RepairApprovalLike>,
): RepairApprovalLike | null {
  if (approvals.length === 0) return null;
  return [...approvals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
}

export type AuthorizationSource = "approval" | "cap";

export interface Authorization {
  authorized: boolean;
  /** which fact authorized it, for the screen to say so in words */
  source: AuthorizationSource | null;
  /** the ceiling that authorized it, so a rise past it can be detected */
  coveredCents: number;
}

/**
 * May chargeable work start?
 *
 * Two facts can say yes, and both are recorded (ADR-0014 §2): an approval the
 * customer gave for an amount, or a cap they signed at intake. Either way the
 * test is the same — **does what they agreed to still cover what we are about to
 * charge?**
 *
 * A quote with nothing on it is not authorized by anything: there is no price to
 * have agreed to, and "approved 0 €" must not become a licence to charge later.
 */
export function workAuthorization(facts: RepairFacts): Authorization {
  const total = quoteTotalCents(facts.lines);
  if (facts.lines.length === 0) return { authorized: false, source: null, coveredCents: 0 };

  const approval = latestApproval(facts.approvals);
  if (approval && approval.approvedTotalCents >= total) {
    return { authorized: true, source: "approval", coveredCents: approval.approvedTotalCents };
  }
  if (facts.authorizedCapCents !== null && facts.authorizedCapCents >= total) {
    return { authorized: true, source: "cap", coveredCents: facts.authorizedCapCents };
  }
  return {
    authorized: false,
    source: null,
    coveredCents: Math.max(approval?.approvedTotalCents ?? 0, facts.authorizedCapCents ?? 0),
  };
}

/**
 * The status, entailed by the facts.
 *
 * Read top to bottom: the later a fact appears in a repair's life, the earlier it
 * is checked, so the most advanced true thing wins. A collected ticket does not
 * revert to "in repair" because a line was edited.
 */
export function repairStatus(facts: RepairFacts): RepairStatus {
  if (facts.notRepairedAt) return "not_repaired";
  if (facts.collectionDocumentId) return "collected";
  if (facts.readyAt) return "ready";

  if (facts.lines.length === 0) return "received";

  const authorized = workAuthorization(facts).authorized;
  if (!authorized) return "quoted";

  // authorized, but something has not arrived
  return openOrderedParts(facts.lines) > 0 ? "waiting_part" : "in_repair";
}

/* ------------------------------------------------ transitions and refusals */

export type RepairAction =
  | "quote"
  | "approve"
  | "receive_part"
  | "mark_ready"
  | "collect"
  | "mark_not_repaired";

/**
 * Why an action is refused, in a form the UI can turn into a sentence.
 *
 * These are the strings the board shows when a card is dragged somewhere its
 * facts do not support — the whole reason the guard is here and not in the
 * screen, so the drag and the button cannot disagree.
 */
export type RepairRefusal =
  | "terminal"
  | "no_lines"
  | "not_authorized"
  | "waiting_part"
  | "already_ready"
  | "not_ready"
  | "unresolved_parts"
  | "no_reason";

/** True when nothing more can happen to this ticket. */
export function isTerminal(status: RepairStatus): boolean {
  return status === "collected" || status === "not_repaired";
}

export interface ActionContext {
  /** for mark_not_repaired: consumed parts still needing return-or-charge */
  unresolvedPartCount?: number;
  /** for mark_not_repaired: a reason is mandatory */
  reason?: NotRepairedReason | null;
}

/**
 * May this action be taken, given these facts?
 *
 * One function, used by the detail buttons AND by a board drag. That is the
 * point: there is no second path to a transition, so there is no way to reach a
 * state whose story is not written down.
 */
export function checkAction(
  facts: RepairFacts,
  action: RepairAction,
  ctx: ActionContext = {},
): RepairRefusal | null {
  const status = repairStatus(facts);
  if (isTerminal(status)) return "terminal";

  switch (action) {
    case "quote":
      return null; // adding a line is always allowed on a live ticket

    case "approve":
      return facts.lines.length === 0 ? "no_lines" : null;

    case "receive_part":
      return openOrderedParts(facts.lines) === 0 ? "waiting_part" : null;

    case "mark_ready":
      if (status === "ready") return "already_ready";
      if (facts.lines.length === 0) return "no_lines";
      if (!workAuthorization(facts).authorized) return "not_authorized";
      if (openOrderedParts(facts.lines) > 0) return "waiting_part";
      return null;

    case "collect":
      // a device is handed back when it is ready, not when it is half repaired
      return status === "ready" ? null : "not_ready";

    case "mark_not_repaired":
      if (!ctx.reason) return "no_reason";
      // a consumed part is off the shelf: it goes back or it gets charged, but
      // it does not simply vanish when the ticket closes (ADR-0014 §3)
      if ((ctx.unresolvedPartCount ?? 0) > 0) return "unresolved_parts";
      return null;
  }
}

export function assertAction(facts: RepairFacts, action: RepairAction, ctx: ActionContext = {}): void {
  const refusal = checkAction(facts, action, ctx);
  if (!refusal) return;
  throw appError("VALIDATION", REFUSAL_ES[refusal]);
}

/** Fixed Spanish for the typed refusals — the UI maps codes, never messages. */
export const REFUSAL_ES: Record<RepairRefusal, string> = {
  terminal: "Esta ficha ya está cerrada.",
  no_lines: "El presupuesto está vacío.",
  not_authorized: "Falta la aprobación del cliente.",
  waiting_part: "Hay una pieza pendiente de recibir.",
  already_ready: "La ficha ya está lista.",
  not_ready: "La ficha todavía no está lista.",
  unresolved_parts: "Resuelve primero las piezas ya descontadas.",
  no_reason: "Indica el motivo.",
};

/* ------------------------------------------------- charges after approval */

export interface ChargeChange {
  lineId: string;
  fromCents: number;
  toCents: number;
}

/**
 * Is this charge edit one the customer has already agreed to?
 *
 * Raising a charge is safe: it pushes the total past what was approved, the
 * status falls back to Presupuestado by itself, and nothing can be collected
 * until they approve again.
 *
 * **Lowering one after approval is the dangerous direction**, and it is why this
 * function exists. The customer agreed to 79 €; quietly settling at 60 € is money
 * the shop cannot account for and a difference nobody recorded. It needs a reason
 * and the approvable price-override permission — the same machinery a discount on
 * the Sale screen goes through (ADR-0012 §5).
 */
export function needsPriceOverride(facts: RepairFacts, change: ChargeChange): boolean {
  if (change.toCents >= change.fromCents) return false;
  return latestApproval(facts.approvals) !== null;
}

/**
 * What the collection must settle at.
 *
 * Exactly the ticket's charged total — never a number typed into the payment
 * dialog. Anything else means the document says one thing and the ticket says
 * another, and the difference is invisible.
 */
export function collectionTotalCents(lines: ReadonlyArray<RepairLineLike>): number {
  return quoteTotalCents(lines);
}

/* ------------------------------------------------------------ warranty */

/** The date the printed receipt promises, from the months snapshotted at intake. */
export function warrantyEndsAt(collectedAt: Date, months: number): Date {
  const end = new Date(collectedAt.getTime());
  end.setMonth(end.getMonth() + Math.max(0, months));
  return end;
}

/* ------------------------------------------------------------ overdue */

/**
 * Promised in the past and still in the shop.
 *
 * A ticket with no promise is never overdue — forcing a date at intake would
 * produce fiction, and fiction on a board is worse than a blank.
 */
export function isOverdue(
  promisedDate: Date | null,
  status: RepairStatus,
  now: Date,
): boolean {
  if (!promisedDate) return false;
  if (status === "ready" || status === "collected" || status === "not_repaired") return false;
  return promisedDate.getTime() < now.getTime();
}

/* ------------------------------------------------------------ customers */

/**
 * The dedupe key for a phone number.
 *
 * Digits only, with Spain's country code stripped, so "+34 671 22 09 18",
 * "0034671220918" and "671220918" are one customer rather than three. Kept
 * deliberately simple: a shop's numbers are local, and a clever international
 * parser would be a dependency and a source of surprises.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D+/g, "");
  if (digits.startsWith("0034")) return digits.slice(4);
  if (digits.startsWith("34") && digits.length > 9) return digits.slice(2);
  return digits;
}

export function assertPhone(raw: string): string {
  const normalized = normalizePhone(raw);
  if (normalized.length < 6) {
    throw appError("VALIDATION", "El teléfono no es válido.", "phone");
  }
  return normalized;
}
