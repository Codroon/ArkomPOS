/**
 * The period every screen is looking at.
 *
 * Held in the URL rather than in a component: a link somebody sends themselves
 * from their phone should open on the same figures, and a Server Component can
 * read it without a round trip.
 *
 * Measured in DAYS rather than timestamps, because the boundary that matters is
 * a shop's day and that is decided in SQL, in Madrid — a sale at 00:30 belongs
 * to the day the shop thinks it does, not to whatever UTC was doing.
 */
export const RANGE_KEYS = ["today", "7d", "30d", "90d"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

const DAYS: Record<RangeKey, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export interface Period {
  key: RangeKey;
  /** how many shop-days the window covers, today included */
  days: number;
}

const DEFAULT: RangeKey = "30d";

/**
 * Anything unrecognised becomes the default rather than an error: a URL is
 * something people edit and paste, and a dashboard that throws at a typo is a
 * dashboard somebody stops trusting.
 */
export function parseRange(value: string | string[] | undefined): Period {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = (RANGE_KEYS as readonly string[]).includes(raw ?? "") ? (raw as RangeKey) : DEFAULT;
  return { key, days: DAYS[key] };
}
