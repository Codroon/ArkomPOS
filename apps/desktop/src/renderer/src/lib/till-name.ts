/**
 * What to call this till on screen — v1.0.0.
 *
 * "Caja 1" is not the shop's word for anything: it is OUR prefill, written into
 * the wizard before anybody typed, and an English till showing "Sale | Caja 1"
 * is the app talking to itself. So while the name is still the one we suggested
 * — in either language — it follows the staff toggle. The moment the shop calls
 * it something of their own ("Mostrador", "Taller"), that is what it is called,
 * in every language, forever. The same line the drawer's concepts draw.
 *
 * The LOCATION is the same kind of thing and was missed: onboarding writes
 * "Tienda" with no more thought than it writes "Caja 1", so an English till
 * read "Tienda · Till 1" — half of our own prefill translated and half not.
 * One rule, both names.
 */
import { useLocale, useT } from "@arkom/ui";

const OURS = ["Caja 1", "Till 1"];
const OURS_LOCATION = ["Tienda", "Shop"];

/** Shared: our word follows the toggle, theirs never does. */
function ours(given: string, mine: readonly string[]): boolean {
  return mine.some((word) => word.toLowerCase() === given.toLowerCase());
}

export function useTillName(): (name: string | null | undefined) => string {
  const [locale] = useLocale();
  const t = useT();
  return (name) => {
    const given = (name ?? "").trim();
    if (!given) return t("common.dash");
    return ours(given, OURS) ? t("setup.defaultTerminal") : given;
  };
}

/** The same rule for the shop's location, which onboarding prefills too. */
export function useLocationName(): (name: string | null | undefined) => string {
  const [locale] = useLocale();
  const t = useT();
  void locale; // subscribes to the toggle, like its sibling above
  return (name) => {
    const given = (name ?? "").trim();
    if (!given) return t("common.dash");
    return ours(given, OURS_LOCATION) ? t("setup.defaultLocation") : given;
  };
}

/** "Venta | Caja 1" — the screen, then the till it is running on. */
export function useScreenTitle(): (screen: string, tillName: string | null | undefined) => string {
  const tillName = useTillName();
  return (screen, name) => `${screen} | ${tillName(name)}`;
}
