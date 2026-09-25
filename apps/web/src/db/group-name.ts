/**
 * A shelf's name, in the language the reader chose — and only when it is OURS.
 *
 * The till ships a set of starter groups and stores an English name beside the
 * Spanish one (`product_group.nameEn`). Those are our words, written into the
 * database before anybody typed, so an English dashboard showing "Fundas y
 * carcasas" is the app talking to itself — the same reason the till translates
 * the terminal it prefilled as "Caja 1" and stops the moment a shop renames it.
 *
 * A group the shop made has no `nameEn`, and falls through to its own name in
 * both languages. That is not a gap: "Repuestos Samsung" is what they call that
 * shelf, and translating a shop's own words would be inventing data.
 *
 * Resolved in SQL rather than in each page, because there are four queries and
 * five places that render a group, and a rule applied in five places is a rule
 * broken in the sixth.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Locale } from "../i18n";

/**
 * `alias` is the folded CTE row, e.g. `g.row`.
 *
 * `nullif(..., '')` matters: an empty string is not a translation, and
 * `coalesce` would happily take one.
 */
export function groupName(alias: string, locale: Locale): SQL {
  return locale === "en"
    ? sql.raw(`coalesce(nullif(${alias}->>'nameEn', ''), ${alias}->>'name')`)
    : sql.raw(`${alias}->>'name'`);
}
