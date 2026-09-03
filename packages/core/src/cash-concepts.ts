/**
 * The drawer's one-tap concepts, and the line between our words and the shop's.
 *
 * ADR-0011 says shop data is never translated, and that is right: "Proveedor
 * Ahmed" is what the owner typed and no toggle may rewrite it. But the five
 * lines a fresh till starts with were never typed by anybody in the shop — we
 * wrote them, in whichever language setup happened to be in, and then called
 * them data. An English till showing "Corrección de arqueo" is our Spanish, not
 * the shop's.
 *
 * So: while the list is still exactly the one we shipped, it follows the app
 * language. The moment the shop changes anything — adds a line, edits a word,
 * removes one — it stops being ours and is frozen in whatever they wrote, in
 * every language, forever.
 */
export type ConceptLocale = "es" | "en";

export const STARTER_CASH_CONCEPTS: Record<ConceptLocale, readonly string[]> = {
  es: ["A la caja fuerte / banco", "Proveedor", "Gastos", "Cambio para la caja", "Corrección de arqueo"],
  en: ["To the safe / bank", "Supplier", "Expenses", "Change for the drawer", "Count correction"],
};

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((line, i) => line.trim() === b[i]!.trim());

/** True while the list is still the one the app shipped, in either language. */
export function isStarterCashConcepts(concepts: readonly string[]): boolean {
  return same(concepts, STARTER_CASH_CONCEPTS.es) || same(concepts, STARTER_CASH_CONCEPTS.en);
}

/**
 * What to SHOW for a stored list.
 *
 * Untouched → our five lines in the reader's language. Touched → exactly what
 * is stored, because those are the shop's words and this function has no
 * business having an opinion about them.
 */
export function displayCashConcepts(stored: readonly string[], locale: ConceptLocale): string[] {
  return isStarterCashConcepts(stored) ? [...STARTER_CASH_CONCEPTS[locale]] : [...stored];
}
