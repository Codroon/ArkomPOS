/**
 * Tiny cross-screen bus: entrada's scan-miss "Crear artículo" jumps to
 * Catálogo with the unknown code prefilled (handoff 03 §1 / handoff 02 last
 * line). AppShell registers the navigator; CatalogScreen consumes the prefill.
 */
export type ScreenId = "venta" | "catalogo" | "inventario" | "comprarUsados" | "dispositivosUsados" | "ajustes" | "usuarios";

let navigator: ((screen: ScreenId) => void) | null = null;
let pendingCatalogBarcode: string | null = null;
/** A voucher the customer just earned, on its way to the till they walk to. */
let pendingVoucher: { id: string; docNumber: string; amountCents: number } | null = null;

export function registerNavigator(fn: (screen: ScreenId) => void): () => void {
  navigator = fn;
  return () => {
    if (navigator === fn) navigator = null;
  };
}

export function navigateTo(screen: ScreenId): void {
  navigator?.(screen);
}

export function openCatalogWithBarcode(code: string): void {
  pendingCatalogBarcode = code;
  navigateTo("catalogo");
}

export function consumeCatalogPrefill(): string | null {
  const code = pendingCatalogBarcode;
  pendingCatalogBarcode = null;
  return code;
}

/**
 * "Continuar a la venta".
 *
 * The customer who just sold a phone and is buying another should walk through
 * in one motion, so the voucher travels with them rather than being looked up
 * again thirty seconds later at the same counter.
 */
export function openSaleWithVoucher(voucher: { id: string; docNumber: string; amountCents: number }): void {
  pendingVoucher = voucher;
  navigateTo("venta");
}

export function consumePendingVoucher(): { id: string; docNumber: string; amountCents: number } | null {
  const voucher = pendingVoucher;
  pendingVoucher = null;
  return voucher;
}
