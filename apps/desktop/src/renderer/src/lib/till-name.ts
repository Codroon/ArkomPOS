/**
 * What to call this till, and this shop, on screen — v1.0.0, ADR-0011.
 *
 * The rule: "Caja 1" is not the shop's word for anything — it is OUR prefill,
 * written into the wizard before anybody typed, and an English till showing
 * "Sale | Caja 1" is the app talking to itself. So while the name is still the
 * one we suggested, in either language, it follows the staff toggle. The moment
 * the shop calls it something of their own ("Mostrador", "Taller"), that is
 * what it is called, in every language, forever.
 *
 * **The rule now lives in `@arkom/core` and these are the hooks around it.**
 * It used to be implemented here and again in the cloud's queries, and both
 * copies held the prefill as a literal pair — "Caja 1" and "Till 1" — which is
 * only ever till number ONE. A shop adding a second counter types "Caja 2" over
 * it, so neither half recognised it: the English till showed the Spanish word.
 * This copy was the worse of the two, because on a match it returned the
 * PREFILL, so extending the list would have rendered "Caja 2" as "Till 1" — the
 * right language and the wrong till.
 *
 * A test in the cloud asserted the two lists matched, which was the right worry
 * and the wrong fix: it held two wrong implementations in step rather than
 * leaving one. One implementation cannot drift from itself.
 */
import { displayLocationName, displayTillName } from "@arkom/core";
import { useLocale, useT } from "@arkom/ui";

export function useTillName(): (name: string | null | undefined) => string {
  const [locale] = useLocale();
  const t = useT();
  return (name) => displayTillName(name, locale) || t("common.dash");
}

/** The same rule for the shop's location, which onboarding prefills too. */
export function useLocationName(): (name: string | null | undefined) => string {
  const [locale] = useLocale();
  const t = useT();
  return (name) => displayLocationName(name, locale) || t("common.dash");
}

/** "Venta | Caja 1" — the screen, then the till it is running on. */
export function useScreenTitle(): (screen: string, tillName: string | null | undefined) => string {
  const tillName = useTillName();
  return (screen, name) => `${screen} | ${tillName(name)}`;
}
