/**
 * Our words for a till and a shop, generated at display time — ADR-0011.
 *
 * The rule, which is old and keeps being broken: **a name WE wrote follows the
 * language toggle; a name the SHOP wrote never does.** "Caja 1" is our prefill,
 * typed into the wizard before anybody touched it, so an English till reading
 * "Sale | Caja 1" is the app talking to itself. "Mostrador" is the shop's word
 * and stays "Mostrador" in every language, forever — translating it would
 * invent data and make the dashboard disagree with the receipt in somebody's
 * hand.
 *
 * This file exists because that rule was implemented TWICE — once in the till's
 * renderer, once in the cloud's queries — and the two copies were both wrong in
 * the same way and wrong differently:
 *
 *   · both held our prefill as a LITERAL, the two strings "Caja 1" and
 *     "Till 1". A prefill is only ever number ONE, because that is what a first
 *     install suggests. A shop adding a second counter types "Caja 2" over it,
 *     which matches no literal, so it fell through and the English dashboard
 *     showed the Spanish word. The client saw it on his second till;
 *   · the till's copy went further and returned the prefill itself on a match,
 *     so had the list been extended naively, "Caja 2" would have rendered as
 *     "Till 1" — the right language and the wrong till.
 *
 * A test in the cloud asserted the two halves held the same pair, which was the
 * right worry and the wrong fix: it kept two implementations in step instead of
 * leaving one. So there is now one, here, pure, imported by both. Shops number
 * their counters; a list of literals could never have kept up.
 */

/** The two languages the product speaks. Mirrors the UI's own `Locale`. */
export type NameLocale = "es" | "en";

const TILL_WORD: Record<NameLocale, string> = { es: "Caja", en: "Till" };
const SHOP_WORD: Record<NameLocale, string> = { es: "Tienda", en: "Shop" };

/** Our prefills, for the wizard and its tests to agree with. */
export const OUR_TILL_PREFILL: Record<NameLocale, string> = { es: "Caja 1", en: "Till 1" };
export const OUR_SHOP_PREFILL: Record<NameLocale, string> = { es: "Tienda", en: "Shop" };

/**
 * Our word, optionally a separator and a number, and nothing else.
 *
 * Anchored at BOTH ends, which is the whole safety of it: without the anchors
 * "Caja de seguridad" and "Untill 2" would be rewritten, and those are the
 * shop's words. Up to three digits, because a till numbered 1000 is not a till.
 * The number is optional — a shop with one counter may call it just "Caja", and
 * that is still ours.
 */
const OUR_TILL = /^(?:caja|till)(?:[\s.\-#]*(\d{1,3}))?$/i;

/** No numbers here: onboarding writes "Tienda" and nobody writes "Tienda 2". */
const OUR_SHOP = /^(?:tienda|shop)$/i;

/**
 * What to call a till on screen.
 *
 * Returns the stored string untouched unless it is ours, and **keeps the
 * number** when it is — "Caja 2" in English is "Till 2", never "Till 1".
 */
export function displayTillName(stored: string | null | undefined, locale: NameLocale): string {
  const given = (stored ?? "").trim();
  if (!given) return "";

  const match = OUR_TILL.exec(given);
  if (!match) return given;

  const word = TILL_WORD[locale];
  return match[1] ? `${word} ${match[1]}` : word;
}

/** The same rule for the location, which onboarding prefills just as thoughtlessly. */
export function displayLocationName(stored: string | null | undefined, locale: NameLocale): string {
  const given = (stored ?? "").trim();
  if (!given) return "";
  return OUR_SHOP.test(given) ? SHOP_WORD[locale] : given;
}

/** True when a name is one of ours — for a caller that needs to ask rather than render. */
export function isOurTillName(stored: string | null | undefined): boolean {
  return OUR_TILL.test((stored ?? "").trim());
}
