/**
 * Calendar days at the counter — typed, not picked.
 *
 * Everything the till prints and shows is dd/mm/yyyy, fixed, because the shop
 * is in Spain and a receipt is not a place for the machine's opinion about
 * locale. A native `<input type=date>` renders in the OS locale, so a Windows
 * installed in en-US shows mm/dd/yyyy on one screen while every other date in
 * the app says dd/mm/yyyy — the same day, printed two ways, in one session.
 * These helpers replace it: the shop types the date it reads.
 *
 * A day is a Date at LOCAL midnight. The shop's calendar is the shop's, not
 * UTC's: a promise made for "the 3rd" is the 3rd in Madrid, and midnight UTC
 * would be the 2nd there for two hours of the year.
 */

/** The local midnight that owns this instant. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight, n days on. Handles month ends and DST because Date does. */
export function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** A Date (or epoch ms) → "dd/mm/yyyy". The only spelling the app uses. */
export function dayToInput(day: Date | number): string {
  const d = typeof day === "number" ? new Date(day) : day;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** The window a plausible counter date falls in. Outside it, a typo. */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Parse a typed day to local midnight, or null.
 *
 * Accepts, all read as day-first because that is what the shop reads:
 *   "3/9/2026" · "03/09/2026" · "3-9-2026" · "3.9.2026" (any of / - . as separator)
 *   "3/9/26"   — two-digit year, this century
 *   "3/9"      — no year: the NEXT 3 September, so typing a day in December
 *                for a January promise does not land eleven months in the past
 *   "0309" · "030926" · "03092026" — digits only, for someone who never leaves
 *                the number pad
 *
 * Returns null on anything malformed or impossible (31/02, 13th month, a year
 * outside the window). Null is the caller's VALIDATION — never a guess, the
 * same contract as parseMoneyInput.
 */
export function parseDayInput(raw: string, today: Date = new Date()): number | null {
  const s = raw.trim();
  if (!s) return null;

  let dd: number;
  let mm: number;
  let yy: number | null;

  const digits = /^\d+$/.test(s) ? s : null;
  if (digits) {
    // ddmm | ddmmyy | ddmmyyyy — anything else is not a date, it is a typo
    if (digits.length !== 4 && digits.length !== 6 && digits.length !== 8) return null;
    dd = Number(digits.slice(0, 2));
    mm = Number(digits.slice(2, 4));
    yy = digits.length === 4 ? null : Number(digits.slice(4));
    if (digits.length === 6) yy = 2000 + yy!;
  } else {
    const parts = s.split(/[/\-.\s]+/).filter((p) => p !== "");
    if (parts.length < 2 || parts.length > 3) return null;
    if (!parts.every((p) => /^\d{1,4}$/.test(p))) return null;
    dd = Number(parts[0]!);
    mm = Number(parts[1]!);
    if (parts.length === 2) {
      yy = null;
    } else {
      const rawYear = parts[2]!;
      if (rawYear.length === 3) return null; // "202" — half-typed, not a year
      yy = rawYear.length <= 2 ? 2000 + Number(rawYear) : Number(rawYear);
    }
  }

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  if (yy === null) {
    // no year: this year, or next if that day has already gone by
    const base = startOfDay(today);
    const thisYear = build(dd, mm, base.getFullYear());
    if (thisYear === null) return null;
    if (thisYear >= base.getTime()) return thisYear;
    return build(dd, mm, base.getFullYear() + 1);
  }

  if (yy < MIN_YEAR || yy > MAX_YEAR) return null;
  return build(dd, mm, yy);
}

/**
 * Build the day, or null if the calendar does not have it.
 *
 * Date rolls 31/02 forward to 3 March without complaint, which is exactly the
 * kind of quiet correction that puts the wrong promise on a printed receipt.
 * Reading the fields back is the only honest check.
 */
function build(dd: number, mm: number, yyyy: number): number | null {
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d.getTime();
}
