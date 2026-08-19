/**
 * Money utilities — ADR-0006. Money is integer euro cents everywhere; these
 * helpers exist only for the UI/print boundary: parsing user input to cents
 * and formatting cents to Spanish display strings. No floats in the math.
 */

/**
 * Parse user money input to integer cents. Accepts "12,90", "12.90", "12",
 * "12,9", "1.234,56", "1,234.56", "1.234" (es-ES thousands) and tolerates
 * spaces and a € sign. Returns null on anything ambiguous or malformed —
 * callers map null to a VALIDATION error, never guess.
 */
export function parseMoneyInput(raw: string): number | null {
  const s = raw.replace(/[\s€]/g, "");
  if (!s || !/^[0-9.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let intPart: string;
  let decPart: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // both separators: the rightmost is the decimal one, the rest are thousands
    const sepIdx = Math.max(lastComma, lastDot);
    decPart = s.slice(sepIdx + 1);
    intPart = s.slice(0, sepIdx).replace(/[.,]/g, "");
    if (!/^\d{1,2}$/.test(decPart)) return null;
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = s.split(sep);
    if (parts.some((p) => p === "")) return null;
    const tail = parts[parts.length - 1]!;
    if (parts.length === 2 && tail.length <= 2) {
      // "12,90" / "12.9" — decimal separator
      intPart = parts[0]!;
      decPart = tail;
    } else if (sep === "." && parts.slice(1).every((p) => p.length === 3)) {
      // "1.234" / "1.234.567" — es-ES thousands groups (dot only; comma never groups)
      intPart = parts.join("");
      decPart = "0";
    } else {
      return null; // "12,345" and friends: ambiguous, reject
    }
  } else {
    intPart = s;
    decPart = "0";
  }

  if (!/^\d+$/.test(intPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** 1290 → "12,90" (es-ES, '.' thousands, ',' decimals). Input/plain-text form. */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100).toString();
  const withThousands = euros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = (abs % 100).toString().padStart(2, "0");
  return `${sign}${withThousands},${dec}`;
}

/** 1290 → "12,90 €". Display/print form. */
export function formatCents(cents: number): string {
  return `${centsToInput(cents)} €`;
}

/** Margin in cents: PVP − Coste (pure display math, handoff 02 field 5). */
export function marginCents(priceCents: number, costCents: number): number {
  return priceCents - costCents;
}

/**
 * Margin percentage over PVP, rounded half-up to one decimal (e.g. 24.6).
 * Not money — a display-only ratio. Null when price is missing/zero.
 */
export function marginPct(priceCents: number, costCents: number): number | null {
  if (priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 1000) / 10;
}
