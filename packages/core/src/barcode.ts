/**
 * EAN-13 utilities. Internal barcodes (req 4.2 "Generar") use the in-store
 * GS1 prefix "20", 10 random digits and a valid check digit. Randomness comes
 * from Web Crypto (never Math.random per CLAUDE.md); injectable for tests.
 * Uniqueness is enforced where the data lives (repository, at save).
 */

export function ean13CheckDigit(base12: string): number {
  if (!/^\d{12}$/.test(base12)) {
    throw new Error(`ean13CheckDigit: expected 12 digits, got "${base12}"`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function cryptoDigits(count: number): string {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < count; i++) out += (bytes[i]! % 10).toString();
  return out;
}

/** Generate an internal EAN-13 ("20" + 10 digits + check). */
export function generateInternalEan13(digits: (count: number) => string = cryptoDigits): string {
  const base12 = `20${digits(10)}`;
  return base12 + ean13CheckDigit(base12).toString();
}
