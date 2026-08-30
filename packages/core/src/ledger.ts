/**
 * Stock ledger domain — ADR-0004. Stock is an insert-only movement ledger:
 * these builders validate sign-vs-type and required fields, and the batch
 * guard rejects anything that would take a (product, location) below zero.
 * Repositories persist what these functions approve — never the other way.
 */
import { appError } from "./errors";

/* `tradein_in` is a used device entering stock (ADR-0013). It is a separate
   type from `purchase_in` so the books can tell supplier stock from what was
   bought over the counter — REBU margin scheme applies to the second and not
   the first — but it obeys exactly the same ledger rules. */
export const P1_MOVEMENT_TYPES = [
  "purchase_in",
  "sale_out",
  "adjustment",
  "tradein_in",
  "repair_part_out",
] as const;
export type P1MovementType = (typeof P1_MOVEMENT_TYPES)[number];

export interface MovementInput {
  productId: string;
  locationId: string;
  movementType: P1MovementType;
  qty: number; // signed: +in / −out
  unitCostCents?: number | null;
  reason?: string | null;
  unitId?: string | null; // serialized moves
}

export interface MovementDraft {
  productId: string;
  locationId: string;
  movementType: P1MovementType;
  qty: number;
  unitCostCents: number | null;
  reason: string | null;
  unitId: string | null;
}

/** Validate one movement: integer qty, sign matches type, required fields per type. */
export function buildMovement(input: MovementInput): MovementDraft {
  const { qty, movementType } = input;
  if (!Number.isInteger(qty) || qty === 0) {
    throw appError("VALIDATION", "La cantidad debe ser un entero distinto de cero.", "qty");
  }
  if (movementType === "purchase_in" || movementType === "tradein_in") {
    if (qty <= 0) throw appError("VALIDATION", "Una entrada de compra debe tener cantidad positiva.", "qty");
    const cost = input.unitCostCents;
    if (cost == null || !Number.isInteger(cost) || cost < 0) {
      // req 6.2: unit cost required per entry
      throw appError("VALIDATION", "El coste por unidad es obligatorio.", "unitCostCents");
    }
  } else if (movementType === "sale_out") {
    if (qty >= 0) throw appError("VALIDATION", "Una salida de venta debe tener cantidad negativa.", "qty");
  } else if (movementType === "repair_part_out") {
    /* Either sign, and the positive one must say why.
       A part fitted to a repair leaves the shelf (−). When the line is removed
       it comes back (+), and ADR-0004 says that is a SECOND movement, never a
       deleted first one. Keeping both under one type means the movements drawer
       shows the pair against the same repair document, which is exactly what
       someone asking "where did that screen go" needs to see. */
    if (qty > 0 && (!input.reason || input.reason.trim() === "")) {
      throw appError("VALIDATION", "Devolver una pieza requiere un motivo.", "reason");
    }
  } else {
    // adjustment: either sign, but always a reason (req 25.3: gated-with-reason)
    if (!input.reason || input.reason.trim() === "") {
      throw appError("VALIDATION", "El ajuste requiere un motivo.", "reason");
    }
  }
  if (input.unitId != null && Math.abs(qty) !== 1) {
    throw appError("VALIDATION", "Un movimiento de unidad serializada es siempre de 1.", "qty");
  }
  return {
    productId: input.productId,
    locationId: input.locationId,
    movementType,
    qty,
    unitCostCents: input.unitCostCents ?? null,
    reason: input.reason?.trim() || null,
    unitId: input.unitId ?? null,
  };
}

export function stockKey(productId: string, locationId: string): string {
  return `${productId}|${locationId}`;
}

/** on-hand per stockKey — always derivable as Σ movements (ADR-0004). */
export type StockLevels = Record<string, number>;

/**
 * Apply a batch atomically: returns the resulting levels. Throws
 * NEGATIVE_STOCK if any (product, location) would end below zero — the batch
 * is one transaction, so the NET result is what must stay ≥ 0 (req 5.3).
 */
export function applyMovements(current: Readonly<StockLevels>, batch: ReadonlyArray<MovementDraft>): StockLevels {
  const next: StockLevels = { ...current };
  for (const m of batch) {
    const key = stockKey(m.productId, m.locationId);
    next[key] = (next[key] ?? 0) + m.qty;
  }
  for (const level of Object.values(next)) {
    if (level < 0) {
      throw appError("NEGATIVE_STOCK", "El stock no puede quedar en negativo.");
    }
  }
  return next;
}

/** Last-cost rule (PRD 6.5): a confirmed entry sets the product's current cost. */
export function nextCostCents(_currentCostCents: number | null, entryUnitCostCents: number): number {
  return entryUnitCostCents;
}
