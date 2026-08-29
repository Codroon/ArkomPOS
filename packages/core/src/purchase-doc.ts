/**
 * The purchase document and the shelf label, as pure functions.
 *
 * The purchase document is the reason the buy screen exists. A shop that buys a
 * phone over the counter in Spain has to be able to show who sold it, what was
 * paid, and that the seller declared it theirs — and it is the seller's
 * signature on this piece of paper that makes the declaration a record rather
 * than a note. Everything else on it serves that.
 *
 * ADR-0011: fixed Spanish, never the UI dictionary. The seller is handed this;
 * flipping the staff locale to English must not change a character of it.
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
import type { AcquisitionChannel, DeviceGrade, IdDocType, PayoutMethod } from "./used";
import type { ShopProfile } from "./ticket";

export interface PurchaseDocDevice {
  brand: string;
  model: string;
  storage: string | null;
  color: string | null;
  grade: DeviceGrade;
  batteryPct: number | null;
  imei: string;
  accessories: { charger: boolean; box: boolean; cable: boolean; case: boolean };
}

export interface PurchaseDocSeller {
  name: string;
  phone: string | null;
  idType: IdDocType;
  idNumber: string;
  channel: AcquisitionChannel;
}

export interface PurchaseDoc {
  docNumber: string;
  purchasedAtMs: number;
  terminalName: string;
  /** who was at the till — the document says who bought it, not just when */
  cashierName: string;
  isCopy: boolean;
  device: PurchaseDocDevice;
  seller: PurchaseDocSeller;
  buyPriceCents: number;
  payout: PayoutMethod;
  payoutReference: string | null;
  /** set when the payout was store credit: the voucher the seller walks out with */
  voucherNumber: string | null;
}

export const PURCHASE_ES = {
  copy: "COPIA",
  brand: "ARKOM",
  tagline: "ELECTRONICS · PHONES",
  nif: "NIF",
  title: "COMPRA DE DISPOSITIVO USADO",
  attendedBy: "Atendido por",
  grade: "Grado",
  battery: "Batería",
  imei: "IMEI",
  accessories: "Accesorios",
  noAccessories: "sin accesorios",
  seller: "VENDEDOR",
  paid: "IMPORTE PAGADO",
  payoutLabel: "Forma de pago",
  voucher: "vale",
  declaration:
    "El vendedor declara ser el legítimo propietario del dispositivo y que no procede de actividad ilícita.",
  signature: "Firma del vendedor",
  signatureRule: "X",
  thanks: "Gracias por su visita",
} as const;

export const PURCHASE_ES_PAYOUT: Record<PayoutMethod, string> = {
  cash: "efectivo",
  transfer: "transferencia",
  store_credit: "saldo a favor",
};

export const PURCHASE_ES_ACCESSORIES: Record<keyof PurchaseDocDevice["accessories"], string> = {
  charger: "cargador",
  box: "caja",
  cable: "cable",
  case: "funda",
};

export const PURCHASE_ES_GRADE: Record<DeviceGrade, string> = { A: "A", B: "B", C: "C" };

/** "Apple iPhone SE 2020 · 64GB · Blanco" — whatever of it exists. */
export function deviceHeadline(device: PurchaseDocDevice): string {
  const name = `${device.brand} ${device.model}`.trim();
  const attrs = [device.storage, device.color].map((x) => x?.trim()).filter(Boolean);
  return attrs.length > 0 ? `${name} · ${attrs.join(" · ")}` : name;
}

function accessoryLine(device: PurchaseDocDevice): string {
  const present = (Object.keys(PURCHASE_ES_ACCESSORIES) as Array<keyof typeof PURCHASE_ES_ACCESSORIES>)
    .filter((key) => device.accessories[key])
    .map((key) => PURCHASE_ES_ACCESSORIES[key]);
  return present.length > 0 ? present.join(", ") : PURCHASE_ES.noAccessories;
}

/**
 * The purchase document → the ops that print it.
 *
 * No cut-and-keep stub and no drawer pulse. Paying out cash is a drawer event
 * the shop performs, not something the till decides: the money is counted by
 * hand from the same drawer a sale would open, and popping it automatically
 * while a stranger stands at the counter is the wrong default.
 */
export function renderPurchaseDoc(
  doc: PurchaseDoc,
  shop: ShopProfile,
  width: PaperWidthMm = 80,
): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const b = opBuilder(cols);

  if (doc.isCopy) {
    b.text(letterSpaced(PURCHASE_ES.copy, cols), { align: "center", bold: true });
    b.feed(1);
  }
  b.text(PURCHASE_ES.brand, { align: "center", bold: true, size: "big" });
  b.text(letterSpaced(PURCHASE_ES.tagline, cols), { align: "center" });
  b.feed(1);
  b.text(shop.legalName, { align: "center", bold: true });
  b.text(`${PURCHASE_ES.nif} ${shop.nif}`, { align: "center" });
  b.text(shop.address, { align: "center" });

  b.rule();
  b.text(PURCHASE_ES.title, { bold: true });
  b.pair(doc.docNumber, formatPrintDate(doc.purchasedAtMs));
  // the till's own name, not a label plus it: the shop calls this one "Caja 1",
  // and "Caja Caja 1" is what happens when you prefix a name that is already one
  b.text(`${doc.terminalName} · ${PURCHASE_ES.attendedBy} ${doc.cashierName}`);

  /* ---- the device ---- */
  b.rule();
  b.text(deviceHeadline(doc.device), { bold: true });
  const condition = [`${PURCHASE_ES.grade} ${PURCHASE_ES_GRADE[doc.device.grade]}`];
  if (doc.device.batteryPct !== null) condition.push(`${PURCHASE_ES.battery} ${doc.device.batteryPct}%`);
  b.text(condition.join(" · "));
  b.text(`${PURCHASE_ES.imei} ${doc.device.imei}`);
  b.text(`${PURCHASE_ES.accessories}: ${accessoryLine(doc.device)}`);

  /* ---- who sold it ---- */
  b.rule();
  b.text(PURCHASE_ES.seller, { bold: true });
  b.text(doc.seller.name);
  b.text(`${doc.seller.idType} ${doc.seller.idNumber}`);
  if (doc.seller.phone?.trim()) b.text(`Tel. ${doc.seller.phone.trim()}`);

  /* ---- what was paid ---- */
  b.rule();
  b.pair(PURCHASE_ES.paid, formatCents(doc.buyPriceCents), { bold: true });
  const payout = PURCHASE_ES_PAYOUT[doc.payout];
  const reference =
    doc.payout === "store_credit" && doc.voucherNumber
      ? ` (${PURCHASE_ES.voucher} ${doc.voucherNumber})`
      : doc.payout === "transfer" && doc.payoutReference?.trim()
        ? ` (${doc.payoutReference.trim()})`
        : "";
  b.text(`${PURCHASE_ES.payoutLabel}: ${payout}${reference}`);

  /* ---- the declaration and the signature: the point of the document ---- */
  b.rule();
  b.text(PURCHASE_ES.declaration);
  b.feed(2);
  b.text(PURCHASE_ES.signature);
  // three blank lines, then the rule: a pen needs room, and a signature box the
  // seller has to squeeze into is a signature nobody can later stand behind
  b.feed(3);
  b.raw(`${PURCHASE_ES.signatureRule} ${"_".repeat(Math.max(0, cols - 2))}`);

  b.rule();
  b.text(PURCHASE_ES.thanks, { align: "center" });
  b.feed(2);
  b.cut();

  return b.ops;
}

export interface ShelfLabel {
  barcode: string | null;
  device: PurchaseDocDevice;
  docNumber: string;
  /** set once the device is priced and on the shelf */
  sellPriceCents: number | null;
}

/**
 * The sticker that goes on the box.
 *
 * Short on purpose: it is read at arm's length in a drawer, so the barcode is
 * double-width and everything else is one line each. A device still on hold has
 * no price, and the label says so rather than printing a blank where a number
 * belongs.
 */
export function renderShelfLabel(label: ShelfLabel, width: PaperWidthMm = 80): TicketOp[] {
  const cols = COLUMNS_BY_PAPER[width];
  const b = opBuilder(cols);

  if (label.barcode) {
    b.text(label.barcode, { align: "center", bold: true, size: "big" });
  }
  b.text(deviceHeadline(label.device), { align: "center", bold: true });
  b.text(
    `${PURCHASE_ES.grade} ${PURCHASE_ES_GRADE[label.device.grade]} · ${label.docNumber}`,
    { align: "center" },
  );
  if (label.sellPriceCents !== null) {
    b.text(formatCents(label.sellPriceCents), { align: "center", bold: true, size: "big" });
  }
  b.feed(2);
  b.cut();

  return b.ops;
}
