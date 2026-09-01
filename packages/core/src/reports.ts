/**
 * Report vocabulary and the pure arithmetic reports share — ADR-0016.
 *
 * The aggregation itself is SQL in main (§3). What lives here is what must not
 * be written twice: the date-range presets, the margin formula, the way an
 * estimated cost is described, and the shapes both sides agree on.
 */

/* ------------------------------------------------------------ periods */

export const DATE_PRESETS = ["today", "yesterday", "week", "month", "lastMonth", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export interface DateRange {
  /** local midnight at the start of the first day */
  fromMs: number;
  /** local midnight at the start of the day AFTER the last one — half-open */
  toMs: number;
}

/**
 * A preset resolved against a clock.
 *
 * Half-open `[from, to)` on **local** day boundaries. Half-open because the
 * alternative is an end-of-day sentinel, and 23:59:59.999 is a bug waiting for
 * the one sale that lands on the millisecond. Local because a shop's Monday is
 * its own Monday, not UTC's.
 *
 * The week starts on Monday: Spain's does, and so does every calendar the shop
 * owns.
 */
export function resolvePreset(preset: Exclude<DatePreset, "custom">, now: Date = new Date()): DateRange {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const addDays = (ms: number, n: number) => {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };
  const today = startOfDay(now);

  switch (preset) {
    case "today":
      return { fromMs: today, toMs: addDays(today, 1) };
    case "yesterday":
      return { fromMs: addDays(today, -1), toMs: today };
    case "week": {
      // getDay(): 0 = Sunday. Monday-based offset, so Sunday is 6 days in.
      const offset = (new Date(today).getDay() + 6) % 7;
      return { fromMs: addDays(today, -offset), toMs: addDays(today, 1) };
    }
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { fromMs: first, toMs: addDays(today, 1) };
    }
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const next = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { fromMs: first, toMs: next };
    }
  }
}

/* ------------------------------------------------------------- margin */

/** Revenue − cost, in cents. Both are exact integers, so this one is too. */
export function marginCentsOf(revenueCents: number, costCents: number): number {
  return revenueCents - costCents;
}

/**
 * Margin over revenue, as a percentage to one decimal.
 *
 * Null when revenue is zero: a percentage of nothing is not zero, it is
 * undefined, and printing "0,0 %" for a line that sold nothing is a lie the
 * reader will act on. Negative revenue (a correction) is equally undefined here.
 */
export function marginPctOf(revenueCents: number, costCents: number): number | null {
  if (revenueCents <= 0) return null;
  return Math.round(((revenueCents - costCents) / revenueCents) * 1000) / 10;
}

/* ------------------------------------------------------------ estimates */

/**
 * How much of a cost figure was guessed.
 *
 * A line written before v0.14.0 carries no cost snapshot, so the report falls
 * back to the product's CURRENT cost. That is the best answer available and it
 * is not the same kind of answer as a snapshot, so every cost-bearing response
 * carries this and every screen and export says so (ADR-0016 §2).
 */
export interface CostEstimate {
  /** lines whose cost came from a snapshot */
  exactLines: number;
  /** lines that fell back to the product's current cost */
  estimatedLines: number;
}

export const NO_ESTIMATE: CostEstimate = { exactLines: 0, estimatedLines: 0 };

export function isEstimated(e: CostEstimate): boolean {
  return e.estimatedLines > 0;
}

/* ------------------------------------------------------ report vocabulary */

export const REPORT_IDS = ["sales", "repairsOpen", "repairsClosed", "used", "valuation", "deadStock"] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export const SALES_GROUP_BY = ["day", "group", "product", "user", "method"] as const;
export type SalesGroupBy = (typeof SALES_GROUP_BY)[number];

/**
 * Which reports cost money to look at.
 *
 * The split is not paranoia about staff: "how many repairs are late" is a
 * question a senior technician should answer for themselves, and "what margin do
 * we make on screens" is not a question the shop needs to answer to anybody
 * (ADR-0016 §7).
 */
export const COST_BEARING_REPORTS: ReadonlySet<ReportId> = new Set([
  "repairsClosed",
  "used",
  "valuation",
  "deadStock",
]);

/** Sales is viewable without costs; its cost COLUMNS are the gated part. */
export function reportPermission(report: ReportId): "reports.view" | "reports.costs" {
  return COST_BEARING_REPORTS.has(report) ? "reports.costs" : "reports.view";
}

/**
 * Every grouping must add up to the same total.
 *
 * A group-by that loses a row is the most common reporting bug there is, and the
 * only one that looks entirely plausible on screen. The tests call this; so does
 * nothing else, which is the point — it exists to be asserted.
 */
export function totalsAgree(
  grouped: ReadonlyArray<{ netCents: number; taxCents: number; grossCents: number }>,
  ungrouped: { netCents: number; taxCents: number; grossCents: number },
): boolean {
  const sum = grouped.reduce(
    (acc, row) => ({
      netCents: acc.netCents + row.netCents,
      taxCents: acc.taxCents + row.taxCents,
      grossCents: acc.grossCents + row.grossCents,
    }),
    { netCents: 0, taxCents: 0, grossCents: 0 },
  );
  return (
    sum.netCents === ungrouped.netCents &&
    sum.taxCents === ungrouped.taxCents &&
    sum.grossCents === ungrouped.grossCents
  );
}

/** Whole days between two instants, floored — "23 días retenido". */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 86_400_000);
}
