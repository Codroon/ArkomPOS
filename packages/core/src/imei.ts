/** IMEI utilities: 15 digits, last one a Luhn check digit (req 6.1). */
import { appError } from "./errors";

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

/**
 * A serialized stock-entry line brings in `expectedQty` phones and must carry
 * exactly that many valid, distinct IMEIs (req 6.1). Returns the normalized
 * list; throws the typed error the panel renders inline.
 */
export function validateImeiBatch(args: { expectedQty: number; imeis: ReadonlyArray<string> }): string[] {
  const { expectedQty } = args;
  if (!Number.isInteger(expectedQty) || expectedQty < 1) {
    throw appError("VALIDATION", "La cantidad debe ser un entero ≥ 1.", "qty");
  }
  const imeis = args.imeis.map((imei) => imei.trim());
  if (imeis.length !== expectedQty) {
    throw appError("VALIDATION", `Faltan IMEIs: ${imeis.length} de ${expectedQty}.`, "imeis");
  }
  const seen = new Set<string>();
  for (const imei of imeis) {
    if (!isValidImei(imei)) throw appError("VALIDATION", "IMEI no válido (15 dígitos).", "imei");
    if (seen.has(imei)) throw appError("DUPLICATE_IMEI", "Ese IMEI está repetido en la entrada.", "imei");
    seen.add(imei);
  }
  return imeis;
}
