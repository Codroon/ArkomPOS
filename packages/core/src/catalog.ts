/**
 * Catalog domain rules (reqs 3.2/3.3/4.1/4.3) — pure functions, single source
 * of truth for flags and guards. Repositories fetch, these decide.
 */
import { appError } from "./errors";
import type { ProductRow } from "./ipc";

/** Basis points per Phase-1 regime (ADR-0006/0007). Derived server-side, never trusted from input. */
export const TAX_RATE_BP: Record<"IVA21", number> = { IVA21: 2100 };

export type MissingField = "barcode" | "group" | "cost" | "price" | "tax";

/** req 3.3: a row is incomplete when any of these is NULL. */
export function missingFields(p: {
  barcode: string | null;
  groupId: string | null;
  costCents: number | null;
  priceCents: number | null;
  taxRegime: string | null;
}): MissingField[] {
  const out: MissingField[] = [];
  if (p.barcode === null) out.push("barcode");
  if (p.groupId === null) out.push("group");
  if (p.costCents === null) out.push("cost");
  if (p.priceCents === null) out.push("price");
  if (p.taxRegime === null) out.push("tax");
  return out;
}

export function isMissingData(p: Parameters<typeof missingFields>[0]): boolean {
  return missingFields(p).length > 0;
}

/**
 * BAJO MÍNIMO (PRD 5.2): on-hand ≤ reorder point. A reorder point of 0 means
 * "not tracked" — flagging every zero-stock row would make the filter useless.
 */
export function isLowStock(p: Pick<ProductRow, "onHand" | "reorderPoint">): boolean {
  return p.reorderPoint > 0 && p.onHand <= p.reorderPoint;
}

/**
 * req 4.3: item type is locked once physical reality exists —
 * Stock→Serializado blocked with quantity on hand; Serializado→Stock blocked
 * once IMEI units exist. Throws the typed error the UI shows inline.
 */
export function assertTypeChangeAllowed(args: {
  fromType: string;
  toType: string;
  onHand: number;
  unitCount: number;
}): void {
  const { fromType, toType, onHand, unitCount } = args;
  if (fromType === toType) return;
  if (fromType === "stocked" && toType === "serialized" && onHand > 0) {
    throw appError("VALIDATION", "Tiene stock por cantidad; no se puede serializar.", "itemType");
  }
  if (fromType === "serialized" && toType === "stocked" && unitCount > 0) {
    throw appError("VALIDATION", "Tiene unidades con IMEI; no se puede pasar a stock.", "itemType");
  }
}
