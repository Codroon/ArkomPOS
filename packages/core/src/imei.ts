/** IMEI utilities: 15 digits, last one a Luhn check digit (req 6.1). */

export function imeiCheckDigit(base14: string): number {
  if (!/^\d{14}$/.test(base14)) {
    throw new Error(`imeiCheckDigit: expected 14 digits, got "${base14}"`);
  }
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(base14[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function imeiWithCheckDigit(base14: string): string {
  return base14 + imeiCheckDigit(base14).toString();
}

export function isValidImei(code: string): boolean {
  return /^\d{15}$/.test(code) && imeiCheckDigit(code.slice(0, 14)) === Number(code[14]);
}
