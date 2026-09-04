/**
 * What to call this till on screen — v1.0.0.
 *
 * "Caja 1" is not the shop's word for anything: it is OUR prefill, written into
 * the wizard before anybody typed, and an English till showing "Sale | Caja 1"
 * is the app talking to itself. So while the name is still the one we suggested
 * — in either language — it follows the staff toggle. The moment the shop calls
 * it something of their own ("Mostrador", "Taller"), that is what it is called,
 * in every language, forever. The same line the drawer's concepts draw.
 */
import { useLocale, useT } from "@arkom/ui";

const OURS = ["Caja 1", "Till 1"];

export function useTillName(): (name: string | null | undefined) => string {
  const [locale] = useLocale();
  const t = useT();
  return (name) => {
    const given = (name ?? "").trim();
    if (!given) return t("common.dash");
    return OURS.some((ours) => ours.toLowerCase() === given.toLowerCase())
      ? t("setup.defaultTerminal")
      : given;
  };
}

/** "Venta | Caja 1" — the screen, then the till it is running on. */
export function useScreenTitle(): (screen: string, tillName: string | null | undefined) => string {
  const tillName = useTillName();
  return (screen, name) => `${screen} | ${tillName(name)}`;
}
