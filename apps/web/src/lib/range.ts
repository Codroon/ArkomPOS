/**
 * The period every screen is looking at.
 *
 * Held in the URL rather than in a component: a link somebody sends themselves
 * from their phone should open on the same figures, and a Server Component can
 * read it without a round trip.
 *
 * A period is now a pair of SHOP DATES rather than a count of days back. The
 * presets still read as "the last 30 days"; the difference is that the window
 * is resolved once, here, into `from`/`to`, so a custom range — "what did we do
 * between the 3rd and the 17th" — is the same shape as a preset instead of a
 * second code path through nine queries. The gestor asks for a month that
 * ended; a dashboard that can only count backwards from today cannot answer.
 *
 * The boundary that matters is a SHOP's day, decided in Madrid: a sale at 00:30
 * belongs to the day the shop thinks it does, not to whatever UTC was doing.
 * These strings are therefore plain `YYYY-MM-DD` in that zone, compared against
 * `(completed_at at time zone 'Europe/Madrid')::date` in SQL, and never
 * `Date` objects — a Date would carry this server's zone into the comparison.
 */
export const RANGE_KEYS = ["today", "7d", "30d", "90d", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

/** The presets, as a number of shop-days ending today. */
const DAYS: Record<Exclude<RangeKey, "custom">, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const SHOP_ZONE = "Europe/Madrid";

export interface Period {
  key: RangeKey;
  /** inclusive, `YYYY-MM-DD`, in the shop's zone */
  from: string;
  to: string;
  /** how many shop-days the window covers, both ends included */
  days: number;
}

const DEFAULT: Exclude<RangeKey, "custom"> = "30d";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today where the shop is, not where this server is. */
export function shopToday(now = new Date()): string {
  /* en-CA gives YYYY-MM-DD, which is the one format that sorts and parses */
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Calendar arithmetic on a plain date string, with no zone to get wrong. */
function shift(date: string, byDays: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + byDays);
  return at.toISOString().slice(0, 10);
}

/** Inclusive day count between two shop dates. */
function span(from: string, to: string): number {
  const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

const isDate = (value: unknown): value is string =>
  typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));

const one = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Anything unrecognised becomes the default rather than an error: a URL is
 * something people edit and paste, and a dashboard that throws at a typo is a
 * dashboard somebody stops trusting. A custom range with a bad date, or only
 * one of the two, falls back the same way.
 */
export function parseRange(
  value: string | string[] | undefined,
  from?: string | string[] | undefined,
  to?: string | string[] | undefined,
  now = new Date(),
): Period {
  const today = shopToday(now);
  const raw = one(value);

  if (raw === "custom") {
    let a = one(from);
    let b = one(to);
    if (isDate(a) && isDate(b)) {
      /* back to front is a slip, not an error — swap it and show them the
         window they meant rather than an empty screen */
      if (a > b) [a, b] = [b, a];
      /* a range that has not happened yet returns nothing and looks broken;
         clamping to today shows the part of it that exists */
      if (b > today) b = today;
      if (a > today) a = today;
      return { key: "custom", from: a, to: b, days: span(a, b) };
    }
  }

  const key: Exclude<RangeKey, "custom"> =
    raw === "today" || raw === "7d" || raw === "30d" || raw === "90d" ? raw : DEFAULT;
  const days = DAYS[key];
  return { key, from: shift(today, -(days - 1)), to: today, days };
}

/**
 * "the last N shop-days, today included", for a caller that has a number rather
 * than a preset — a report fixed at 90 days, or a test.
 */
export function lastDays(n: number, now = new Date()): Period {
  const to = shopToday(now);
  const from = shift(to, -(n - 1));
  return { key: "custom", from, to, days: n };
}

/** The window of the same length immediately before this one. */
export function previousPeriod(period: Period): { from: string; to: string } {
  return { from: shift(period.from, -period.days), to: shift(period.from, -1) };
}

/** What goes back into a URL, so a link opens on the same figures. */
export function rangeParams(period: Period): Record<string, string> {
  return period.key === "custom"
    ? { range: "custom", from: period.from, to: period.to }
    : { range: period.key };
}

/** "1 – 17 sep 2026", for a screen that has to say which window it is showing. */
export function describePeriod(period: Period, locale: string): string {
  const fmt = (d: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${d}T12:00:00Z`));
  return period.from === period.to ? fmt(period.to) : `${fmt(period.from)} – ${fmt(period.to)}`;
}
