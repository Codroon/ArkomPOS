/**
 * Formatting, at the edge and nowhere else.
 *
 * Money is integer cents everywhere it is reasoned about — in the till, on the
 * wire, in Postgres and in every query in this app. It becomes a string with a
 * comma in it here, on its way to a screen, and never travels back.
 */

const EUROS = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

export const euros = (cents: number): string => EUROS.format(cents / 100);

const PLAIN = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0 });
const ONE_DP = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 });

/**
 * Money on a chart axis, where there is room for about five characters.
 *
 * The axis has no fixed ceiling and never did — Recharts scales it to the data,
 * so a day of 600 € shows 600 and a day of 8.000 € shows 8.000. What it did NOT
 * do was stay READABLE up there: the old tick was `String(Math.round(cents/100))`,
 * which prints a bare "10000" — no thousands separator, no unit, and wider than
 * the gutter it sits in. A shop turning over five figures should not have to
 * count digits.
 *
 * So: separators below a thousand, and k/M above it. Spanish separators in both
 * languages, like every other figure in this app, because the money is euros in
 * a Spanish shop whatever language the staff prefer.
 */
export const axisEuros = (cents: number): string => {
  const value = cents / 100;
  const size = Math.abs(value);
  if (size >= 1_000_000) return `${ONE_DP.format(value / 1_000_000)} M`;
  if (size >= 1_000) return `${ONE_DP.format(value / 1_000)} k`;
  return PLAIN.format(value);
};

const two = (n: number) => String(n).padStart(2, "0");

export const dateTime = (value: Date | null): string =>
  value ? `${two(value.getDate())}/${two(value.getMonth() + 1)}/${value.getFullYear()} ${two(value.getHours())}:${two(value.getMinutes())}` : "—";

export const time = (value: Date | null): string =>
  value ? `${two(value.getHours())}:${two(value.getMinutes())}` : "—";

/** "2026-09-24" → "24/09/2026", without inventing a timezone on the way. */
export const dayLabel = (iso: string): string => {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
};
