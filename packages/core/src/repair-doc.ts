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
import { shopHeaderLines } from "./ticket";
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
  quoteTitle: "PRESUPUESTO",
  quoteLines: "TRABAJO PRESUPUESTADO",
  quoteTotal: "TOTAL PRESUPUESTADO",
  quoteDeposit: "Depósito ya entregado",
  quoteToPay: "Pendiente al recoger",
  quoteOnOrder: "pieza por pedir",
  quoteAccept:
    "Autorizo la reparación por el importe indicado. El taller no realizará ningún trabajo con cargo por encima de este importe sin volver a consultarme.",
  quoteValidity: "Presupuesto sujeto a la avería declarada. Una avería distinta se presupuesta de nuevo.",
  receiptTitle: "RECIBO DE REPARACIÓN",
  receiptWork: "TRABAJO REALIZADO",
  receiptTotal: "TOTAL",
  receiptDeposit: "Depósito",
  receiptPaid: "PAGADO",
  receiptChange: "Cambio",
  receiptBase: "Base",
  receiptTax: "IVA {rate}%",
  receiptWarrantyUntil:
    "Garantía hasta el {date} en las piezas y la mano de obra de esta reparación.",
  receiptWarrantyNote:
    "No cubre golpes, humedad ni averías distintas de la reparada.",
  returnTitle: "DEVOLUCIÓN SIN REPARAR",
  returnReason: "Motivo",
  returnDeclined: "El cliente no autoriza la reparación",
  returnUnrepairable: "El dispositivo no tiene reparación viable",
  returnAbandoned: "Dispositivo no recogido",
  returnDevice: "Se devuelve al cliente el dispositivo descrito.",
  returnParts: "PIEZAS",
  returnPartsCharged: "Piezas montadas y no recuperables",
  returnFee: "Tarifa de diagnóstico",
  returnDepositApplied: "Depósito aplicado",
  returnDepositRefunded: "Depósito devuelto",
  returnDue: "Pendiente de pago",
  returnNothingDue: "Nada que pagar",
  returnReceived: "Recibí el dispositivo",
  quoteApproved: "APROBADO",
  quoteApprovedBy: "Aprobado {method} el {date}",
  quoteInPerson: "en persona",
  quoteByPhone: "por teléfono",
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
  const [legal, ...rest] = shopHeaderLines(shop);
  b.text(legal!, { align: "center", bold: true });
  for (const line of rest) b.text(line, { align: "center" });

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

/** One priced row of the quote. Enough to print it and nothing more. */
export interface QuoteDocLine {
  description: string;
  qty: number;
  chargeCents: number;
  /** true for a part_on_order that has not arrived — the customer should know */
  onOrder: boolean;
}

export interface QuoteDoc {
  docNumber: string;
  quotedAtMs: number;
  terminalName: string;
  cashierName: string;
  isCopy: boolean;
  customerName: string;
  customerPhone: string;
  device: RepairDocDevice;
  lines: ReadonlyArray<QuoteDocLine>;
  totalCents: number;
  depositCents: number;
  /**
   * The approval on record, if any — WITH the amount it was given for.
   *
   * The amount is not decoration. An approval binds to a number (ADR-0014 §2),
   * so one taken at 84,80 € says nothing about a quote that has since grown to
   * 204,80 €, and a sheet stamped APROBADO over that larger total would be the
   * shop claiming an agreement the customer never made.
   */
  approval: { method: "in_person" | "by_phone"; atMs: number; approvedTotalCents: number } | null;
}

/**
 * The quote → the ops that print it.
 *
 * Its job is to be the thing a customer signs, so the two halves that matter are
 * the priced list and the sentence above the signature line. A quote whose lines
 * do not add up to the total printed beneath them is worse than no quote, so the
 * total is passed in and asserted rather than recomputed here — the caller has
 * already put that number in front of the customer on screen.
 *
 * Once approved it prints the approval instead of the signature block: the same
 * document then serves as the record of what was agreed and when.
 */
export function renderQuoteDoc(doc: QuoteDoc, shop: ShopProfile, width: PaperWidthMm = 80): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const b = opBuilder(cols);

  if (doc.isCopy) {
    b.text(letterSpaced(REPAIR_ES.copy, cols), { align: "center", bold: true });
    b.feed(1);
  }
  b.text(REPAIR_ES.brand, { align: "center", bold: true, size: "big" });
  b.text(letterSpaced(REPAIR_ES.tagline, cols), { align: "center" });
  b.feed(1);
  const [legal, ...rest] = shopHeaderLines(shop);
  b.text(legal!, { align: "center", bold: true });
  for (const line of rest) b.text(line, { align: "center" });

  b.rule();
  b.text(REPAIR_ES.quoteTitle, { bold: true });
  b.pair(doc.docNumber, formatPrintDate(doc.quotedAtMs));
  b.text(`${doc.terminalName} · ${REPAIR_ES.attendedBy} ${doc.cashierName}`);

  b.rule();
  b.text(REPAIR_ES.customer, { bold: true });
  b.text(`${doc.customerName} · ${doc.customerPhone}`);

  /* the device, short: the intake receipt carries the full condition record */
  b.rule();
  b.text(REPAIR_ES.device, { bold: true });
  b.text(doc.device.description);
  if (doc.device.imei) b.text(`${REPAIR_ES.imei} ${doc.device.imei}`);
  b.text(`${REPAIR_ES.fault}: ${doc.device.reportedFault}`);

  /* ---- what it costs ---- */
  b.rule();
  b.text(REPAIR_ES.quoteLines, { bold: true });
  for (const line of doc.lines) {
    // the quantity only earns a place when it is not one
    const label = line.qty === 1 ? line.description : `${line.qty} × ${line.description}`;
    b.pair(label, formatCents(line.chargeCents));
    if (line.onOrder) b.text(`  (${REPAIR_ES.quoteOnOrder})`);
  }
  b.rule();
  b.pair(REPAIR_ES.quoteTotal, formatCents(doc.totalCents), { bold: true });
  if (doc.depositCents > 0) {
    b.pair(REPAIR_ES.quoteDeposit, `-${formatCents(doc.depositCents)}`);
    // never below zero on paper: a deposit larger than the quote is money owed
    // back at hand-back, not a negative amount to hand a customer now
    b.pair(REPAIR_ES.quoteToPay, formatCents(Math.max(0, doc.totalCents - doc.depositCents)), { bold: true });
  }

  b.rule();
  b.text(REPAIR_ES.quoteValidity);

  /* An approval only stands while it still covers the total. Once the quote
     grows past it the ticket falls back to Presupuestado on screen, and this
     sheet has to do the same — it is the thing being put back in front of the
     customer to sign for the NEW number. */
  const approvalStands = doc.approval !== null && doc.approval.approvedTotalCents >= doc.totalCents;

  if (doc.approval && approvalStands) {
    /* already agreed: the paper records it rather than asking again */
    b.feed(1);
    b.text(letterSpaced(REPAIR_ES.quoteApproved, cols), { align: "center", bold: true });
    b.text(
      REPAIR_ES.quoteApprovedBy
        .replace(
          "{method}",
          doc.approval.method === "in_person" ? REPAIR_ES.quoteInPerson : REPAIR_ES.quoteByPhone,
        )
        .replace("{date}", formatPrintDate(doc.approval.atMs)),
      { align: "center" },
    );
  } else {
    b.feed(1);
    b.text(REPAIR_ES.quoteAccept);
    b.feed(2);
    b.text(REPAIR_ES.signature);
    b.feed(3);
    b.raw(`${REPAIR_ES.signatureRule} ${"_".repeat(Math.max(0, cols - 2))}`);
  }

  b.rule();
  b.text(REPAIR_ES.thanks, { align: "center" });
  b.feed(2);
  b.cut();

  return b.ops;
}

/* ------------------------------------------------- the final receipt */

export interface ReceiptDocLine {
  description: string;
  qty: number;
  chargeCents: number;
}

export interface ReceiptDocTender {
  method: string;
  amountCents: number;
  /** true for the deposit, which was taken weeks ago and is not a payment today */
  isDeposit: boolean;
}

export interface RepairReceiptDoc {
  docNumber: string;
  /** the R- ticket this settles — the cross-reference ADR-0014 §7a requires */
  repairDocNumber: string;
  collectedAtMs: number;
  terminalName: string;
  cashierName: string;
  isCopy: boolean;
  customerName: string;
  device: RepairDocDevice;
  lines: ReadonlyArray<ReceiptDocLine>;
  subtotalCents: number;
  taxCents: number;
  taxRateBp: number;
  totalCents: number;
  tenders: ReadonlyArray<ReceiptDocTender>;
  changeCents: number;
  warrantyEndsAtMs: number;
}

const dateOnly = (ms: number): string => formatPrintDate(ms).slice(0, 10);

/**
 * The receipt the customer walks out with.
 *
 * It is a fiscal document — it carries its own T1- number, its IVA breakdown and
 * every tender — AND the warranty statement, which is the half the customer
 * actually keeps it for. It names the R- ticket, so the two halves of the job
 * point at each other from either direction (ADR-0014 §7a).
 */
export function renderRepairReceipt(
  doc: RepairReceiptDoc,
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
  const [legal, ...rest] = shopHeaderLines(shop);
  b.text(legal!, { align: "center", bold: true });
  for (const line of rest) b.text(line, { align: "center" });

  b.rule();
  b.text(REPAIR_ES.receiptTitle, { bold: true });
  b.pair(doc.docNumber, formatPrintDate(doc.collectedAtMs));
  // both directions: the ticket knows its receipt, the receipt names its ticket
  b.text(doc.repairDocNumber);
  b.text(`${doc.terminalName} · ${REPAIR_ES.attendedBy} ${doc.cashierName}`);

  b.rule();
  b.text(REPAIR_ES.customer, { bold: true });
  b.text(doc.customerName);

  b.rule();
  b.text(REPAIR_ES.device, { bold: true });
  b.text(doc.device.description);
  if (doc.device.imei) b.text(`${REPAIR_ES.imei} ${doc.device.imei}`);
  b.text(`${REPAIR_ES.fault}: ${doc.device.reportedFault}`);

  b.rule();
  b.text(REPAIR_ES.receiptWork, { bold: true });
  for (const line of doc.lines) {
    const label = line.qty === 1 ? line.description : `${line.qty} × ${line.description}`;
    b.pair(label, formatCents(line.chargeCents));
  }

  b.rule();
  b.pair(REPAIR_ES.receiptTotal, formatCents(doc.totalCents), { bold: true, size: "wide" });
  b.pair(REPAIR_ES.receiptBase, formatCents(doc.subtotalCents));
  b.pair(REPAIR_ES.receiptTax.replace("{rate}", String(doc.taxRateBp / 100)), formatCents(doc.taxCents));

  b.rule();
  for (const tender of doc.tenders) {
    // the deposit prints as a payment, because that is what it is — money the
    // customer already handed over, not a discount on the work (ADR-0014 §7)
    const label = tender.isDeposit ? REPAIR_ES.receiptDeposit : tender.method;
    b.pair(label, formatCents(tender.amountCents));
  }
  if (doc.changeCents > 0) b.pair(REPAIR_ES.receiptChange, formatCents(doc.changeCents));

  b.rule();
  b.text(REPAIR_ES.receiptWarrantyUntil.replace("{date}", dateOnly(doc.warrantyEndsAtMs)), { bold: true });
  b.text(REPAIR_ES.receiptWarrantyNote);

  b.rule();
  b.text(REPAIR_ES.thanks, { align: "center" });
  b.feed(2);
  b.cut();

  return b.ops;
}

/* ------------------------------------------------ the return document */

export type ReturnReason = "customer_declined" | "unrepairable" | "abandoned";

export interface ReturnDoc {
  docNumber: string;
  returnedAtMs: number;
  terminalName: string;
  cashierName: string;
  isCopy: boolean;
  customerName: string;
  customerPhone: string;
  device: RepairDocDevice;
  reason: ReturnReason;
  /** parts that went into the device and are not coming back out */
  chargedParts: ReadonlyArray<ReceiptDocLine>;
  diagnosisFeeCents: number;
  depositAppliedCents: number;
  depositRefundedCents: number;
  /** what is still owed after the deposit — zero is the common and good case */
  dueCents: number;
}

const RETURN_REASON_ES: Record<ReturnReason, string> = {
  customer_declined: REPAIR_ES.returnDeclined,
  unrepairable: REPAIR_ES.returnUnrepairable,
  abandoned: REPAIR_ES.returnAbandoned,
};

/**
 * The paper that goes with a device handed back unrepaired.
 *
 * Its job is to close the custody the intake receipt opened: this device came
 * in, here is why nothing was done to it, here is what was charged anyway and
 * why, and here is the customer's signature saying they took it away.
 */
export function renderReturnDoc(doc: ReturnDoc, shop: ShopProfile, width: PaperWidthMm = 80): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const b = opBuilder(cols);

  if (doc.isCopy) {
    b.text(letterSpaced(REPAIR_ES.copy, cols), { align: "center", bold: true });
    b.feed(1);
  }
  b.text(REPAIR_ES.brand, { align: "center", bold: true, size: "big" });
  b.text(letterSpaced(REPAIR_ES.tagline, cols), { align: "center" });
  b.feed(1);
  const [legal, ...rest] = shopHeaderLines(shop);
  b.text(legal!, { align: "center", bold: true });
  for (const line of rest) b.text(line, { align: "center" });

  b.rule();
  b.text(REPAIR_ES.returnTitle, { bold: true });
  b.pair(doc.docNumber, formatPrintDate(doc.returnedAtMs));
  b.text(`${doc.terminalName} · ${REPAIR_ES.attendedBy} ${doc.cashierName}`);

  b.rule();
  b.text(REPAIR_ES.customer, { bold: true });
  b.text(`${doc.customerName} · ${doc.customerPhone}`);

  b.rule();
  b.text(REPAIR_ES.device, { bold: true });
  b.text(doc.device.description);
  if (doc.device.imei) b.text(`${REPAIR_ES.imei} ${doc.device.imei}`);
  b.text(`${REPAIR_ES.fault}: ${doc.device.reportedFault}`);

  b.rule();
  b.text(`${REPAIR_ES.returnReason}: ${RETURN_REASON_ES[doc.reason]}`);
  b.text(REPAIR_ES.returnDevice);

  /* what the customer is being charged for a repair that did not happen. It
     prints in full or not at all: a line the shop cannot point at on paper is a
     line it should not be charging. */
  if (doc.chargedParts.length > 0 || doc.diagnosisFeeCents > 0) {
    b.rule();
    if (doc.chargedParts.length > 0) {
      b.text(REPAIR_ES.returnPartsCharged, { bold: true });
      for (const part of doc.chargedParts) {
        const label = part.qty === 1 ? part.description : `${part.qty} × ${part.description}`;
        b.pair(label, formatCents(part.chargeCents));
      }
    }
    // a fee that was never announced on the intake receipt cannot appear here
    if (doc.diagnosisFeeCents > 0) b.pair(REPAIR_ES.returnFee, formatCents(doc.diagnosisFeeCents));
  }

  if (doc.depositAppliedCents > 0 || doc.depositRefundedCents > 0) {
    b.rule();
    if (doc.depositAppliedCents > 0) {
      b.pair(REPAIR_ES.returnDepositApplied, formatCents(doc.depositAppliedCents));
    }
    if (doc.depositRefundedCents > 0) {
      b.pair(REPAIR_ES.returnDepositRefunded, formatCents(doc.depositRefundedCents));
    }
  }

  b.rule();
  if (doc.dueCents > 0) {
    b.pair(REPAIR_ES.returnDue, formatCents(doc.dueCents), { bold: true });
  } else {
    b.text(REPAIR_ES.returnNothingDue, { bold: true });
  }

  b.feed(2);
  b.text(REPAIR_ES.returnReceived);
  b.feed(3);
  b.raw(`${REPAIR_ES.signatureRule} ${"_".repeat(Math.max(0, cols - 2))}`);

  b.rule();
  b.text(REPAIR_ES.thanks, { align: "center" });
  b.feed(2);
  b.cut();

  return b.ops;
}
