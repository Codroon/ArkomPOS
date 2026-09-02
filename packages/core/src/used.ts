/**
 * Used devices — the domain rules (ADR-0013).
 *
 * Nothing here touches SQL, Electron or the filesystem. What lives here is the
 * handful of judgements that must hold no matter which screen calls them:
 * whether an IMEI may be bought, what a device costs once refurbished, what it
 * should be priced at, and whether a voucher may be spent.
 */
import { appError } from "./errors";
import { isValidImei } from "./imei";
import { buildMovement, type MovementDraft } from "./ledger";

/* ------------------------------------------------------------------ types */

export const DEVICE_GRADES = ["A", "B", "C"] as const;
export type DeviceGrade = (typeof DEVICE_GRADES)[number];

/** Shown under the grade selector: "B" means nothing to a new cashier. */
export const GRADE_HINTS_ES: Record<DeviceGrade, string> = {
  A: "Como nuevo",
  B: "Buen estado, marcas de uso",
  C: "Con desgaste visible",
};

export const ID_DOC_TYPES = ["DNI", "NIE", "PASAPORTE"] as const;
export type IdDocType = (typeof ID_DOC_TYPES)[number];

export const PAYOUT_METHODS = ["cash", "transfer", "store_credit"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export const ACQUISITION_CHANNELS = ["private_individual", "business"] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

export const PHOTO_KINDS = ["front", "back", "extra", "seller_id"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export const VOUCHER_STATUSES = ["issued", "redeemed", "void"] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

export interface DeviceIdentity {
  brand: string;
  model: string;
  storage?: string | null;
  color?: string | null;
}

/* ------------------------------------------------------- product identity */

/**
 * The catalogue name a used device is filed under.
 *
 * One `used_device` product per brand+model+storage+colour, found-or-created —
 * NOT one per physical phone, which would put a one-off row in the catalogue for
 * every device the shop ever bought. Grade, battery and price live on the unit,
 * because those differ between two identical models.
 *
 * The "(usado)" suffix is load-bearing: it is what a cashier sees when the same
 * model exists new and second-hand in the same search results.
 */
export function usedProductName(device: DeviceIdentity): string {
  const parts = [device.brand.trim(), device.model.trim()];
  if (device.storage?.trim()) parts.push(device.storage.trim());
  if (device.color?.trim()) parts.push(device.color.trim());
  return `${parts.filter(Boolean).join(" ")} (usado)`;
}

/** True for a catalogue name this module generated — used to hide it from Catálogo. */
/**
 * Item types that are tracked piece by piece.
 *
 * A used device is a `used_device` product (which is what core has claimed since
 * v0.11.0, even while the writer said `serialized`), and behaves exactly like a
 * serialized one everywhere it matters: it is picked by IMEI at the till, valued
 * at its unit's own cost, and refused as a repair part. The ONE place the two
 * differ is Stock muerto, which is about goods the shop can reorder.
 */
export function isSerializedItem(itemType: string): boolean {
  return itemType === "serialized" || itemType === "used_device";
}

/** @deprecated Prefer the item type — a shop can rename a product. */
export function isUsedProductName(name: string): boolean {
  return name.trimEnd().endsWith("(usado)");
}

/* ------------------------------------------------------------- the gate */

export type ImeiRejection = "format" | "duplicate_unit" | "duplicate_purchase";

export interface GateInput {
  imei: string;
  /** a unit already holding this IMEI, in any status */
  existingUnitId?: string | null;
  /** an earlier purchase of the same IMEI that is still open */
  existingPurchaseId?: string | null;
  /** the cashier ticked "I physically verified it is unlocked and reset" */
  confirmed: boolean;
}

export interface GateResult {
  imeiOk: boolean;
  rejection: ImeiRejection | null;
  /** price, payout and both log actions stay refused until this is true */
  passed: boolean;
}

/**
 * The purchase gate.
 *
 * Entirely offline by design (ADR-0013): format and duplicates the till can
 * answer from its own database, then a human confirmation that the device was
 * physically checked. There is no network call here and there is not meant to
 * be one — an online GSMA lookup is the real control and it needs connectivity
 * the till does not assume.
 *
 * The duplicate check spans units AND open purchases, so a phone cannot be
 * bought twice, nor bought again while an earlier intake of it sits on hold.
 */
export function evaluateGate(input: GateInput): GateResult {
  if (!isValidImei(input.imei)) {
    return { imeiOk: false, rejection: "format", passed: false };
  }
  if (input.existingUnitId) {
    return { imeiOk: false, rejection: "duplicate_unit", passed: false };
  }
  if (input.existingPurchaseId) {
    return { imeiOk: false, rejection: "duplicate_purchase", passed: false };
  }
  return { imeiOk: true, rejection: null, passed: input.confirmed === true };
}

/** Throws unless the gate passed. Called in MAIN, not only in the UI. */
export function assertGatePassed(result: GateResult): void {
  if (result.passed) return;
  if (result.rejection === "format") {
    throw appError("VALIDATION", "El IMEI no es válido.", "imei");
  }
  if (result.rejection === "duplicate_unit" || result.rejection === "duplicate_purchase") {
    throw appError("DUPLICATE_IMEI", "Ese IMEI ya existe en el sistema.", "imei");
  }
  throw appError(
    "VALIDATION",
    "Confirma que has verificado el dispositivo antes de continuar.",
    "gateConfirmed",
  );
}

/* --------------------------------------------------------------- money */

/**
 * What the shop has in the phone. Refurb cost folds in here and nowhere else —
 * once this has been posted as a stock movement the figure is frozen, because
 * editing it afterwards would mean rewriting a posted movement.
 */
export function unitCostCents(buyPriceCents: number, refurbCostCents = 0): number {
  if (!Number.isInteger(buyPriceCents) || buyPriceCents < 0) {
    throw appError("VALIDATION", "El precio de compra no es válido.", "buyPriceCents");
  }
  if (!Number.isInteger(refurbCostCents) || refurbCostCents < 0) {
    throw appError("VALIDATION", "El coste de reacondicionamiento no es válido.", "refurbCostCents");
  }
  return buyPriceCents + refurbCostCents;
}

export const DEFAULT_MARGIN_PCT = 25;

/**
 * The selling price the send-to-inventory modal proposes.
 *
 * Rounded UP to the nearest 5 cents: shop prices end in 0 or 5, and rounding
 * down would quietly shave the margin the owner asked for.
 */
export function suggestedSellPriceCents(costCents: number, marginPct = DEFAULT_MARGIN_PCT): number {
  if (!Number.isInteger(costCents) || costCents < 0) {
    throw appError("VALIDATION", "El coste no es válido.", "costCents");
  }
  const raw = costCents * (1 + Math.max(0, marginPct) / 100);
  return Math.ceil(raw / 5) * 5;
}

/* -------------------------------------------------------------- vouchers */

export interface VoucherLike {
  status: VoucherStatus;
  amountCents: number;
  remainingCents: number;
}

export type RedeemRefusal = "not_issued" | "empty";

/**
 * May this voucher pay for this sale?
 *
 * Only two things stop it: it has been spent or voided, or there is nothing
 * left on it. The AMOUNT never refuses a voucher.
 *
 * That is a change of shop rule (2026-08-29). The first version refused a
 * voucher larger than the ticket outright, on the reasoning that silently
 * consuming 80 € against a 50 € sale takes 30 € from the customer — which is
 * true, and is why it is not silent. In real use the refusal was simply wrong:
 * someone who sold a phone for 50 € and wants a 10 € protector is owed the
 * protector. `redeemPlan()` gives the counter the two honest answers instead.
 */
export function checkRedeemable(voucher: VoucherLike, _saleTotalCents: number): RedeemRefusal | null {
  if (voucher.status !== "issued") return "not_issued";
  if (voucher.remainingCents <= 0) return "empty";
  return null;
}

/** What the cashier is choosing between when a voucher is worth more than the ticket. */
export type RedeemMode = "keep_rest" | "pay_out";

export interface RedeemPlan {
  /** what the tender is worth on this ticket */
  tenderCents: number;
  /** what is left on the voucher afterwards */
  remainingAfterCents: number;
  /** what the shop hands back in cash */
  changeCents: number;
  /** true when the voucher covers the whole ticket by itself */
  coversTicket: boolean;
}

/**
 * How a voucher meets a ticket.
 *
 * Three situations, and only the third is a decision:
 *
 *   - voucher ≤ ticket — it pays what it can, the rest is paid normally.
 *   - voucher = ticket — it pays the lot.
 *   - voucher > ticket — the cashier chooses. **keep_rest** spends only what the
 *     ticket needs and the customer keeps a voucher worth the difference;
 *     **pay_out** spends it all and the difference comes out of the drawer.
 *
 * The default is `keep_rest`, because a shop offers credit precisely so the
 * money stays in the shop — but a customer who wants their change is entitled
 * to ask, and the till should not make the cashier argue about it.
 */
export function redeemPlan(
  voucher: VoucherLike,
  saleTotalCents: number,
  mode: RedeemMode = "keep_rest",
): RedeemPlan {
  if (!Number.isInteger(saleTotalCents) || saleTotalCents < 0) {
    throw appError("VALIDATION", "El total no es válido.", "saleTotalCents");
  }
  const available = voucher.remainingCents;
  if (available <= saleTotalCents) {
    return {
      tenderCents: available,
      remainingAfterCents: 0,
      changeCents: 0,
      coversTicket: available === saleTotalCents,
    };
  }
  if (mode === "pay_out") {
    return {
      tenderCents: available,
      remainingAfterCents: 0,
      changeCents: available - saleTotalCents,
      coversTicket: true,
    };
  }
  return {
    tenderCents: saleTotalCents,
    remainingAfterCents: available - saleTotalCents,
    changeCents: 0,
    coversTicket: true,
  };
}

export function assertRedeemable(voucher: VoucherLike, saleTotalCents: number): void {
  if (!checkRedeemable(voucher, saleTotalCents)) return;
  throw appError("VALIDATION", "Ese vale ya no se puede usar.", "voucher");
}

/** Void is allowed only before the voucher is spent, and always with a reason. */
export function assertVoidable(voucher: VoucherLike, reason: string): void {
  if (voucher.status === "redeemed") {
    throw appError("VALIDATION", "Un vale ya canjeado no se puede anular.", "voucher");
  }
  if (voucher.status === "void") {
    throw appError("VALIDATION", "Ese vale ya está anulado.", "voucher");
  }
  if (!reason.trim()) {
    throw appError("VALIDATION", "Indica el motivo de la anulación.", "reason");
  }
}

/* ---------------------------------------------------------------- status */

export type UsedDeviceState = "held" | "needs_review" | "in_stock" | "sold";

/**
 * What the list shows. Derived rather than stored, so the chip can never
 * disagree with the unit — the one thing this slice must not get wrong is a
 * device that reads "En stock" while the ledger says otherwise.
 */
export function usedDeviceState(unitStatus: string, needsReview: boolean): UsedDeviceState {
  if (unitStatus === "sold") return "sold";
  if (unitStatus === "held") return needsReview ? "needs_review" : "held";
  return "in_stock";
}

/**
 * How many stock movements a unit in this status must have.
 *
 * This is the invariant the whole "on hold without a parallel inventory" design
 * rests on, written down once so a test can assert it: held means the ledger has
 * never heard of the device, and anything else means exactly one stock-in.
 */
export function expectedStockInCount(unitStatus: string): number {
  return unitStatus === "held" ? 0 : 1;
}

export interface IntakeInput {
  /** what the purchase becomes: on hold, or straight into sellable stock */
  target: "held" | "in_stock";
  productId: string;
  locationId: string;
  unitId: string;
  buyPriceCents: number;
  refurbCostCents?: number;
}

export interface IntakeResult {
  unitStatus: "held" | "in_stock";
  movements: MovementDraft[];
  /** the cost the movement carries, or null when nothing is posted */
  unitCostCents: number | null;
}

/**
 * The single place that decides a used unit's status **and** its stock movements
 * together.
 *
 * Both callers — *Dejar en espera* and *Enviar a inventario* — go through here,
 * which is what makes the invariant hold: nothing can set a status without also
 * producing the movements that status implies, because it is one return value.
 * A held device is genuinely absent from the ledger rather than present at zero.
 */
export function planIntake(input: IntakeInput): IntakeResult {
  const cost = unitCostCents(input.buyPriceCents, input.refurbCostCents ?? 0);
  if (input.target === "held") {
    return { unitStatus: "held", movements: [], unitCostCents: null };
  }
  return {
    unitStatus: "in_stock",
    unitCostCents: cost,
    movements: [
      buildMovement({
        productId: input.productId,
        locationId: input.locationId,
        movementType: "tradein_in",
        qty: 1,
        unitCostCents: cost,
        unitId: input.unitId,
      }),
    ],
  };
}
