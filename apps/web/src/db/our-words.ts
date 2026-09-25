/**
 * The words in a shop's data that are OURS, and the ones that are theirs.
 *
 * The till writes some text into a shop's database before anybody has typed
 * anything: the starter shelves it ships, and the "(usado)" it appends to a
 * used device's catalogue name so a cashier can tell the second-hand iPhone 13
 * from the new one. Those are our words. An English dashboard showing them in
 * Spanish is the app talking to itself — the same reason the till translates
 * the terminal it prefilled as "Caja 1" and stops the moment a shop renames it.
 *
 * Everything else is theirs and is never touched. "Negro" is the colour
 * somebody chose for that phone; translating it to "Black" would be inventing
 * data, and it would make the dashboard disagree with the receipt the customer
 * is holding.
 *
 * So each helper below rewrites ONLY when our marker is actually present, and
 * leaves the row alone otherwise. A group with no `nameEn` keeps its name; a
 * product a shop renamed keeps its name, suffix or no suffix.
 *
 * In SQL rather than in each page, because there are four queries and six
 * places that render one of these, and a rule applied in six places is a rule
 * broken in the seventh.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Locale } from "../i18n";

/**
 * A shelf's name.
 *
 * The till stores an English name beside the Spanish one for the groups it
 * ships (`product_group.nameEn`). `nullif(..., '')` matters: an empty string is
 * not a translation, and `coalesce` would happily take one.
 */
export function groupName(alias: string, locale: Locale): SQL {
  return locale === "en"
    ? sql.raw(`coalesce(nullif(${alias}->>'nameEn', ''), ${alias}->>'name')`)
    : sql.raw(`${alias}->>'name'`);
}

/**
 * A product's name, with our used-device marker in the reader's language.
 *
 * `usedProductName()` in core builds `brand model storage colour (usado)` and
 * that string is the catalogue's LOOKUP KEY — find-or-create matches on it, so
 * it must never vary by language on the till, or a shop toggling to English
 * would start a second product for the same phone. It is stable there and
 * translated here, which is the only place it is read rather than matched.
 *
 * The rewrite is anchored to the end and only fires when the suffix is there.
 * A shop that renamed the row to "iPhone 13 segunda mano" keeps that name.
 *
 * NO BACKSLASHES in the pattern, deliberately. It is written here in a
 * template literal and read there as a SQL string, and `\s` is not a valid
 * escape in either — it collapses to a bare `s`, so the first version of this
 * shipped the regex `s*(usado)s*$`, which matches nothing anybody has and
 * quietly did nothing at all. Bracket expressions say the same thing and
 * cannot be eaten on the way: `[(]` is a literal paren, `[[:space:]]` is a
 * space.
 */
export function productName(expr: string, locale: Locale): SQL {
  return locale === "en"
    ? sql.raw(`regexp_replace(${expr}, '[[:space:]]*[(]usado[)][[:space:]]*$', ' (used)')`)
    : sql.raw(expr);
}

/**
 * What a till is called.
 *
 * "Caja 1" is our prefill, written into the setup wizard before the shop typed
 * anything, and the till itself already translates it (`useTillName`) while it
 * is still the one we suggested. The cloud was showing the stored string raw,
 * so an English dashboard listed a till called "Caja 1" under a column headed
 * "Till". Same rule, second half of the product.
 *
 * Both spellings are checked because a shop set up in English has "Till 1" in
 * the column, and switching the dashboard to Spanish should move it back.
 * Anything else — "Mostrador", "Taller" — is the shop's word and is returned
 * untouched, in every language, forever.
 */
export const OUR_TILL_NAMES = ["Caja 1", "Till 1"] as const;

export function tillName(stored: string, locale: Locale): string {
  const given = stored.trim();
  const ours = OUR_TILL_NAMES.some((name) => name.toLowerCase() === given.toLowerCase());
  if (!ours) return stored;
  return locale === "en" ? "Till 1" : "Caja 1";
}
