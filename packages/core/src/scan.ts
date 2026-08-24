/**
 * Scan resolution — the single answer to "what did the cashier just scan?".
 *
 * A code can land in three spaces at once: a product's primary barcode, a
 * product's additional codes, or an in-stock unit's IMEI. Real barcodes are NOT
 * unique across products (the same EAN legitimately sits on sibling variants),
 * so resolution can be ambiguous by design — the UI picks, the domain never
 * guesses. Pure function: the repository supplies the candidate rows.
 */

export interface ScanProduct {
  productId: string;
  name: string;
  itemType: string;
  priceCents: number | null;
  onHand: number;
}

export interface ScanUnit {
  unitId: string;
  imei: string;
  status: string;
}

/** How a product matched: its own barcode, or one of its additional codes. */
export type ScanProductVia = "primary" | "alias";

export interface ScanProductCandidate {
  product: ScanProduct;
  matchedVia: ScanProductVia;
}

export interface ScanUnitCandidate {
  unit: ScanUnit;
  product: ScanProduct;
}

export type ScanMatch =
  | { kind: "product"; product: ScanProduct; matchedVia: ScanProductVia }
  | { kind: "unit"; unit: ScanUnit; product: ScanProduct };

export type ScanResolution =
  | { kind: "product"; product: ScanProduct; matchedVia: ScanProductVia }
  | { kind: "unit"; unit: ScanUnit; product: ScanProduct }
  | { kind: "ambiguous"; code: string; matches: ScanMatch[] }
  | { kind: "none"; code: string };

/** Scanners emit stray whitespace/newlines; normalize once, here. */
export function normalizeScanCode(raw: string): string {
  return raw.trim();
}

/**
 * Collapse the candidate rows into one resolution.
 * - a product matching by both its primary code and an alias counts ONCE
 *   (primary wins — it is the stronger identity)
 * - only `in_stock` units are sellable/scannable targets
 * - exactly one match resolves; more than one is ambiguous; none is none
 */
export function resolveScan(
  rawCode: string,
  candidates: { products: ReadonlyArray<ScanProductCandidate>; units: ReadonlyArray<ScanUnitCandidate> },
): ScanResolution {
  const code = normalizeScanCode(rawCode);
  if (code === "") return { kind: "none", code };

  const byProduct = new Map<string, ScanProductCandidate>();
  for (const candidate of candidates.products) {
    const existing = byProduct.get(candidate.product.productId);
    if (!existing || (existing.matchedVia === "alias" && candidate.matchedVia === "primary")) {
      byProduct.set(candidate.product.productId, candidate);
    }
  }

  const byUnit = new Map<string, ScanUnitCandidate>();
  for (const candidate of candidates.units) {
    if (candidate.unit.status !== "in_stock") continue;
    byUnit.set(candidate.unit.unitId, candidate);
  }

  const matches: ScanMatch[] = [
    ...[...byProduct.values()]
      .sort((a, b) => a.product.name.localeCompare(b.product.name, "es"))
      .map((c): ScanMatch => ({ kind: "product", product: c.product, matchedVia: c.matchedVia })),
    ...[...byUnit.values()]
      .sort((a, b) => a.unit.imei.localeCompare(b.unit.imei))
      .map((c): ScanMatch => ({ kind: "unit", unit: c.unit, product: c.product })),
  ];

  if (matches.length === 0) return { kind: "none", code };
  if (matches.length === 1) {
    const only = matches[0]!;
    return only.kind === "product"
      ? { kind: "product", product: only.product, matchedVia: only.matchedVia }
      : { kind: "unit", unit: only.unit, product: only.product };
  }
  return { kind: "ambiguous", code, matches };
}
