/**
 * The repair documents, as pure functions.
 *
 * The intake receipt is the one that matters most. In Spain a shop that takes a
 * customer's device has to give them a written record of what it took and in
 * what state, and the sentence about not doing chargeable work without approval
 * is not boilerplate — it is the thing that makes the rest of the process legal.
 * Everything else on the page serves that.
 *
 * ADR-0011: fixed Spanish, never the UI dictionary. The customer is handed this;
 * flipping the staff locale to English must not change a character of it.
 *
 * **No document in this file prints the device passcode** (ADR-0014 §10). It is
 * not in the input type at all, so a future edit cannot add it by reaching for a
 * field that happens to be in scope.
 */
import { formatCents } from "./money";
import {
  COLUMNS_BY_PAPER,
  formatPrintDate,
  letterSpaced,
  opBuilder,
  type PaperWidthMm,
  type TicketOp,
} from "./print-ops";
import type { ShopProfile } from "./ticket";

export interface RepairDocDevice {
  description: string;
  imei: string | null;
  reportedFault: string;
  conditionAtIntake: string | null;
  damage: { screen: boolean; back: boolean; dents: boolean; water: boolean };
  damageNote: string | null;
  accessories: string | null;
}

/**
 * What the intake receipt is built from.
 *
 * Note what is absent: the passcode. Not optional, not nullable — absent. A type
 * that cannot carry it is a document that cannot print it.
 */
export interface IntakeReceiptDoc {
  docNumber: string;
  receivedAtMs: number;
  terminalName: string;
  cashierName: string;
  isCopy: boolean;
  customerName: string;
  customerPhone: string;
  device: RepairDocDevice;
  depositCents: number;
  /** the signed "repair up to X" authorization, or null if none was given */
  authorizedCapCents: number | null;
  /** printed only when non-zero — a fee not announced here may not be charged */
  diagnosisFeeCents: number;
  warrantyMonths: number;
  promisedAtMs: number | null;
  promisedHalf: "morning" | "afternoon" | null;
}

export const REPAIR_ES = {
  copy: "COPIA",
  brand: "ARKOM",
  tagline: "ELECTRONICS · PHONES",
  nif: "NIF",
  intakeTitle: "RESGUARDO DE DEPÓSITO",
  attendedBy: "Atendido por",
  customer: "CLIENTE",
  device: "DISPOSITIVO",
  imei: "IMEI",
  fault: "Avería",
  condition: "Estado",
  damage: "Daños",
  accessories: "Accesorios",
  none: "ninguno",
  deposit: "Depósito entregado",
  cap: "Autorizado a reparar hasta",
  diagnosisFee: "Tarifa de diagnóstico",
  promised: "Entrega prevista",
  morning: "mañana",
  afternoon: "tarde",
  warranty: "La reparación tiene {n} meses de garantía en piezas y mano de obra.",
  authorizationNotice:
    "No se realizará ningún trabajo con cargo sin la aprobación previa del cliente.",
  authorizationNoticeCapped:
    "No se realizará ningún trabajo con cargo por encima del importe autorizado sin la aprobación previa del cliente.",
  signature: "Firma del cliente",
  signatureRule: "X",
  thanks: "Gracias por su visita",
} as const;

export const DAMAGE_ES = {
  screen: "pantalla rota",
  back: "trasera rota",
  dents: "golpes",
  water: "testigo de humedad",
} as const;

/** "pantalla rota, golpes" — or nothing at all, which is also information. */
export function damageLine(device: RepairDocDevice): string {
  const marks: string[] = (Object.keys(DAMAGE_ES) as Array<keyof typeof DAMAGE_ES>)
    .filter((key) => device.damage[key])
    .map((key) => DAMAGE_ES[key]);
  if (device.damageNote?.trim()) marks.push(device.damageNote.trim());
  return marks.join(", ");
}

/** "11/08/2026 tarde" */
export function promisedLine(atMs: number | null, half: "morning" | "afternoon" | null): string | null {
  if (atMs === null) return null;
  const date = formatPrintDate(atMs).slice(0, 10);
  if (!half) return date;
  return `${date} ${half === "morning" ? REPAIR_ES.morning : REPAIR_ES.afternoon}`;
}

/**
 * The intake receipt → the ops that print it.
 *
 * Three things on it are legally load-bearing and are therefore unconditional:
 * the description of the device and its condition, the warranty statement, and
 * the notice about approval. The deposit, the cap and the diagnosis fee print
 * only when they exist, because a line reading "Depósito 0,00 €" invites a
 * customer to wonder what happened to their money.
 */
export function renderIntakeReceipt(
  doc: IntakeReceiptDoc,
  shop: ShopProfile,
  width: PaperWidthMm = 80,
): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const b = opBuilder(cols);

  if (doc.isCopy) {
    b.text(letterSpaced(REPAIR_ES.copy, cols), { align: "center", bold: true });
    b.feed(1);
  }
  b.text(REPAIR_ES.brand, { align: "center", bold: true, size: "big" });
  b.text(letterSpaced(REPAIR_ES.tagline, cols), { align: "center" });
  b.feed(1);
  b.text(shop.legalName, { align: "center", bold: true });
  b.text(`${REPAIR_ES.nif} ${shop.nif}`, { align: "center" });
  b.text(shop.address, { align: "center" });

  b.rule();
  b.text(REPAIR_ES.intakeTitle, { bold: true });
  b.pair(doc.docNumber, formatPrintDate(doc.receivedAtMs));
  b.text(`${doc.terminalName} · ${REPAIR_ES.attendedBy} ${doc.cashierName}`);

  /* ---- who left it ---- */
  b.rule();
  b.text(REPAIR_ES.customer, { bold: true });
  b.text(`${doc.customerName} · ${doc.customerPhone}`);

  /* ---- what they left, and in what state ---- */
  b.rule();
  b.text(REPAIR_ES.device, { bold: true });
  b.text(doc.device.description);
  if (doc.device.imei) b.text(`${REPAIR_ES.imei} ${doc.device.imei}`);
  b.text(`${REPAIR_ES.fault}: ${doc.device.reportedFault}`);
  if (doc.device.conditionAtIntake?.trim()) {
    b.text(`${REPAIR_ES.condition}: ${doc.device.conditionAtIntake.trim()}`);
  }
  const damage = damageLine(doc.device);
  // the marks protect the shop when a customer says the dent was not there
  // before, so they print whenever there are any
  if (damage) b.text(`${REPAIR_ES.damage}: ${damage}`);
  b.text(`${REPAIR_ES.accessories}: ${doc.device.accessories?.trim() || REPAIR_ES.none}`);

  /* ---- what was agreed ---- */
  const promised = promisedLine(doc.promisedAtMs, doc.promisedHalf);
  if (doc.depositCents > 0 || doc.authorizedCapCents !== null || doc.diagnosisFeeCents > 0 || promised) {
    b.rule();
    if (doc.depositCents > 0) b.pair(REPAIR_ES.deposit, formatCents(doc.depositCents), { bold: true });
    if (doc.authorizedCapCents !== null) b.pair(REPAIR_ES.cap, formatCents(doc.authorizedCapCents));
    // a fee that does not appear here may not be charged later (ADR-0014 §8)
    if (doc.diagnosisFeeCents > 0) b.pair(REPAIR_ES.diagnosisFee, formatCents(doc.diagnosisFeeCents));
    if (promised) b.pair(REPAIR_ES.promised, promised);
  }

  /* ---- the promises that make this a legal record ---- */
  b.rule();
  b.text(REPAIR_ES.warranty.replace("{n}", String(doc.warrantyMonths)));
  b.feed(1);
  b.text(
    doc.authorizedCapCents !== null
      ? REPAIR_ES.authorizationNoticeCapped
      : REPAIR_ES.authorizationNotice,
  );

  b.feed(2);
  b.text(REPAIR_ES.signature);
  // three blank lines before the rule: a customer signs this with a real pen,
  // and a box they have to squeeze into is a signature nobody can stand behind
  b.feed(3);
  b.raw(`${REPAIR_ES.signatureRule} ${"_".repeat(Math.max(0, cols - 2))}`);

  b.rule();
  b.text(REPAIR_ES.thanks, { align: "center" });
  b.feed(2);
  b.cut();

  return b.ops;
}
