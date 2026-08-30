/**
 * The print bridge.
 *
 * One rule governs this file: **a print failure never touches the sale.** The
 * money is taken, the stock has moved and the number is allocated before any
 * of this runs. A jammed printer is a paper problem, so it surfaces as a typed
 * PRINT_FAILED the UI turns into "Reintentar / Guardar PDF" — never as a
 * rollback, and never as a blocked till.
 *
 * Every attempt, successful or not, writes `document.print` to the oplog with
 * its target, so "did that ticket ever come out?" is answerable afterwards.
 */
import { BrowserWindow, shell } from "electron";
import { extname, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import {
  appError,
  mutate,
  renderPurchaseDoc,
  renderIntakeReceipt,
  renderShelfLabel,
  renderTicket,
  wrapText,
  type MutationCtx,
  type PrinterInfo,
  type PrintTicketRequest,
  type PrintTicketResponse,
  type PurchaseDoc,
  type TicketDoc,
  type TicketOp,
  type UsedPrintRequest,
  type RepairPrintRequest,
  type IntakeReceiptDoc,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { peek } from "../repos/sale";
import { getSettings, shopProfile } from "../repos/settings";
import { tillContext } from "../context";
import { encodeEscPos } from "./escpos";
import { renderTicketPdf, ticketsDir as ticketsDirPath } from "./pdf";
import { sendRawToPrinter } from "./raw-windows";

export { ticketsDir } from "./pdf";

/**
 * Open a saved ticket in the system viewer, or show it in the file manager.
 *
 * The renderer supplies the path, so it is resolved against the tickets folder
 * and required to be a .pdf before the shell ever sees it — this is a door into
 * the OS and it opens onto exactly one directory.
 */
export async function revealTicket(path: string, mode: "open" | "folder"): Promise<{ ok: boolean }> {
  const target = resolve(path);
  const dir = resolve(ticketsDirPath());

  // the tickets folder itself is openable — that is the "Abrir carpeta" button
  // in Ajustes, and the folder is created lazily on the first save
  if (target === dir) {
    await mkdir(dir, { recursive: true });
    const problem = await shell.openPath(dir);
    if (problem) throw appError("VALIDATION", problem);
    return { ok: true };
  }

  if (!target.startsWith(dir + sep) || extname(target).toLowerCase() !== ".pdf") {
    throw appError("VALIDATION", "Solo se pueden abrir tickets guardados.");
  }
  if (mode === "folder") {
    shell.showItemInFolder(target);
    return { ok: true };
  }
  // openPath returns "" on success, or the OS's reason for refusing
  const problem = await shell.openPath(target);
  if (problem) throw appError("VALIDATION", problem);
  return { ok: true };
}

/** The OS printer list, for the Ajustes dropdown. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name }));
}

/** Record the attempt. Its own transaction — the sale's closed long ago. */
function logPrintAttempt(
  db: ArkomDb,
  ctx: MutationCtx,
  docId: string,
  after: Record<string, unknown>,
): void {
  mutate(makeMutateRunner(db), ctx, (_tx, log) => {
    log({ entity: "document", entityId: docId, action: "print", before: null, after });
  });
}

function toTicketDoc(db: ArkomDb, ctx: MutationCtx, docId: string, isCopy: boolean): TicketDoc {
  const ticket = peek(db, ctx, docId);
  if (ticket.status !== "completed" || !ticket.docNumber || ticket.completedAtMs === null) {
    throw appError("VALIDATION", "Solo se pueden imprimir tickets completados.");
  }
  return {
    docNumber: ticket.docNumber,
    completedAtMs: ticket.completedAtMs,
    terminalName: tillContext(db).meta.terminal.name,
    isCopy,
    lines: ticket.lines,
    subtotalCents: ticket.subtotalCents,
    taxCents: ticket.taxCents,
    totalCents: ticket.totalCents,
    tenders: ticket.tenders,
    changeCents: ticket.changeCents,
  };
}

export async function printTicket(
  db: ArkomDb,
  ctx: MutationCtx,
  req: PrintTicketRequest,
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  const doc = toTicketDoc(db, ctx, req.docId, req.copy);
  // ONE render feeds both targets — the paper and the PDF cannot disagree
  const ops = renderTicket(doc, shopProfile(db, ctx), settings.paperWidthMm);
  const fileBase = `${doc.docNumber}${req.copy ? "-COPIA" : ""}`;

  if (req.target === "pdf") {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, req.docId, { ok: true, target: "pdf", path, copy: req.copy });
    return { kind: "pdf", path };
  }

  /* No printer configured is a SETTING, not a failure.
     Throwing here produced a red toast offering "Reintentar" — which would fail
     identically, because nothing about the till has changed — and left the
     document nowhere. A shop still setting itself up, or one whose printer died
     mid-morning, gets the PDF instead and a button that opens it. A printer that
     is configured and then fails is a different thing: that IS a failure, it
     probably means paper, and retrying is exactly right. */
  if (!settings.printerName) {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, req.docId, {
      ok: true,
      target: "pdf",
      path,
      copy: req.copy,
      fallback: "NO_PRINTER",
    });
    return { kind: "pdf", path };
  }

  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logPrintAttempt(db, ctx, req.docId, {
      ok: true,
      target: "printer",
      printer: settings.printerName,
      copy: req.copy,
    });
    return { kind: "printed", printer: settings.printerName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logPrintAttempt(db, ctx, req.docId, {
      ok: false,
      target: "printer",
      printer: settings.printerName,
      copy: req.copy,
      error: message,
    });
    // the sale stands; the UI offers Reintentar and Guardar PDF
    throw appError("PRINT_FAILED", `No se pudo imprimir en ${settings.printerName}.`);
  }
}

/**
 * A sample ticket for "Imprimir prueba". Deliberately not a real document: the
 * owner testing the printer should not consume a ticket number or leave a
 * phantom sale in the books. It is logged against the printer, not a document.
 */
export async function printTest(
  db: ArkomDb,
  ctx: MutationCtx,
  target: "auto" | "pdf",
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  const sample: TicketDoc = {
    docNumber: "PRUEBA",
    completedAtMs: Date.now(),
    terminalName: tillContext(db).meta.terminal.name,
    isCopy: false,
    lines: [
      {
        description: "Prueba de impresión",
        qty: 1,
        unitPriceCents: 100,
        totalCents: 100,
        imei: null,
        priceOverridden: false,
      },
    ],
    subtotalCents: 83,
    taxCents: 17,
    totalCents: 100,
    // no cash tender: a test must not kick the drawer open in front of a customer
    tenders: [{ method: "card", amountCents: 100, cardReference: null }],
    changeCents: 0,
  };
  const ops = renderTicket(sample, shopProfile(db, ctx), settings.paperWidthMm);

  const logTest = (after: Record<string, unknown>) =>
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      log({ entity: "printer", entityId: settings.printerName || "none", action: "test", before: null, after });
    });

  if (target === "pdf") {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, "PRUEBA");
    logTest({ ok: true, target: "pdf", path });
    return { kind: "pdf", path };
  }
  if (!settings.printerName) {
    logTest({ ok: false, target: "printer", error: "NO_PRINTER" });
    throw appError("PRINT_FAILED", "No hay impresora configurada en Ajustes.");
  }
  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logTest({ ok: true, target: "printer", printer: settings.printerName });
    return { kind: "printed", printer: settings.printerName };
  } catch (err) {
    logTest({
      ok: false,
      target: "printer",
      printer: settings.printerName,
      error: err instanceof Error ? err.message : String(err),
    });
    throw appError("PRINT_FAILED", `No se pudo imprimir en ${settings.printerName}.`);
  }
}

/**
 * Print the owner's recovery code on the thermal printer.
 *
 * Deliberately its own tiny document rather than a ticket: it carries no shop
 * totals, no number, and must not look like a receipt someone can throw away.
 * If there is no printer it falls back to a PDF like everything else, so the
 * code can still be saved on a till that has not been wired up yet.
 */
export async function printRecoveryCode(
  db: ArkomDb,
  ctx: MutationCtx,
  ownerName: string,
  code: string,
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  const shop = shopProfile(db, ctx);
  const cols = settings.paperWidthMm === 58 ? 32 : 42;
  const centre = (text: string) => ({
    op: "text" as const,
    text,
    align: "center" as const,
    bold: false,
    size: "normal" as const,
  });

  const ops: TicketOp[] = [
    { op: "text", text: "ARKOM", align: "center", bold: true, size: "big" },
    centre("CODIGO DE RECUPERACION"),
    { op: "rule", char: "-" },
    centre(shop.legalName),
    centre(`Responsable: ${ownerName}`),
    centre(new Date().toLocaleDateString("es-ES")),
    { op: "feed", lines: 1 },
    { op: "text", text: code, align: "center", bold: true, size: "wide" },
    { op: "feed", lines: 1 },
    { op: "rule", char: "-" },
    ...wrapText(
      "Guarda este papel fuera de la caja. Permite recuperar el acceso si olvidas tu PIN. No se volvera a mostrar.",
      cols,
    ).map(centre),
    { op: "feed", lines: 2 },
    { op: "cut" },
  ];

  const logPrint = (after: Record<string, unknown>) =>
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      // the CODE never enters the payload — only that one was printed
      log({ entity: "user", entityId: ctx.userId ?? "owner", action: "recovery_printed", before: null, after });
    });

  if (!settings.printerName) {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, "CODIGO-RECUPERACION");
    logPrint({ ok: true, target: "pdf" });
    return { kind: "pdf", path };
  }
  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logPrint({ ok: true, target: "printer", printer: settings.printerName });
    return { kind: "printed", printer: settings.printerName };
  } catch {
    // a failed print must not lose the code — fall through to a file
    const path = await renderTicketPdf(ops, settings.paperWidthMm, "CODIGO-RECUPERACION");
    logPrint({ ok: false, target: "printer", fellBackToPdf: true });
    return { kind: "pdf", path };
  }
}


/* --------------------------------------------------- used devices (ADR-0013) */

/**
 * Load a purchase for printing.
 *
 * Reads the seller block unconditionally — it is ON the document, which is the
 * point of the document. Who may CAUSE a print is decided by the guard: logging
 * a purchase prints it under `usedDevices.create`, because the cashier typed
 * those details a moment ago and the seller has to sign the slip; a reprint
 * afterwards needs `usedDevices.viewSeller`, because that is a way to read the
 * register back off a till that will not show it on screen (ADR-0013 §6).
 */
function loadPurchaseDoc(db: ArkomDb, ctx: MutationCtx, purchaseId: string, isCopy: boolean): {
  doc: PurchaseDoc;
  documentId: string;
  barcode: string | null;
  sellPriceCents: number | null;
} {
  const { usedPurchases, documents, units, users } = schema;
  const row = db
    .select({ purchase: usedPurchases, docNumber: documents.docNumber, documentId: documents.id, userId: documents.userId })
    .from(usedPurchases)
    .innerJoin(documents, eq(documents.id, usedPurchases.documentId))
    .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.id, purchaseId)))
    .limit(1)
    .all()[0];
  if (!row) throw appError("VALIDATION", "Esa compra no existe.");

  const cashier = row.userId
    ? db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1).all()[0]
    : undefined;

  const unit = row.purchase.unitId
    ? db.select({ salePriceCents: units.salePriceCents }).from(units).where(eq(units.id, row.purchase.unitId)).limit(1).all()[0]
    : undefined;

  const accessories = (row.purchase.accessories ?? {}) as Partial<Record<"charger" | "box" | "cable" | "case", boolean>>;

  return {
    documentId: row.documentId,
    barcode: row.purchase.barcode,
    sellPriceCents: unit?.salePriceCents ?? null,
    doc: {
      docNumber: row.docNumber ?? "",
      purchasedAtMs: row.purchase.purchasedAt.getTime(),
      terminalName: tillContext(db).meta.terminal.name,
      cashierName: cashier?.name ?? "—",
      isCopy,
      device: {
        brand: row.purchase.brand,
        model: row.purchase.model,
        storage: row.purchase.storage,
        color: row.purchase.color,
        grade: row.purchase.grade,
        batteryPct: row.purchase.batteryPct,
        imei: row.purchase.imei,
        accessories: {
          charger: accessories.charger === true,
          box: accessories.box === true,
          cable: accessories.cable === true,
          case: accessories.case === true,
        },
      },
      seller: {
        name: row.purchase.sellerName,
        phone: row.purchase.sellerPhone,
        idType: row.purchase.sellerIdType,
        idNumber: row.purchase.sellerIdNumber,
        channel: row.purchase.acquisitionChannel,
      },
      buyPriceCents: row.purchase.buyPriceCents,
      payout: row.purchase.payoutMethod,
      payoutReference: row.purchase.payoutReference,
      voucherNumber: row.purchase.payoutMethod === "store_credit" ? (row.docNumber ?? null) : null,
    },
  };
}

/**
 * Print a purchase document or its shelf label.
 *
 * Same rule as the sale ticket: **a print failure never touches the record.**
 * The purchase is logged, numbered and in the books before this runs, so a
 * jammed printer surfaces as PRINT_FAILED with a PDF to fall back on — never as
 * a purchase that half happened.
 */
/**
 * Load one repair ticket as the intake receipt.
 *
 * Note what this function CANNOT do: build a document carrying the passcode.
 * `IntakeReceiptDoc` has no field for it (ADR-0014 §10), so the column is not
 * read here and a future edit that reaches for it does not compile.
 */
function loadIntakeDoc(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  isCopy: boolean,
): { doc: IntakeReceiptDoc; documentId: string } {
  const { repairTickets, customers, documents, users } = schema;
  const row = db
    .select({
      ticket: repairTickets,
      docNumber: documents.docNumber,
      documentId: documents.id,
      userId: documents.userId,
      customerName: customers.name,
      customerPhone: customers.phone,
    })
    .from(repairTickets)
    .innerJoin(documents, eq(documents.id, repairTickets.documentId))
    .innerJoin(customers, eq(customers.id, repairTickets.customerId))
    .where(and(eq(repairTickets.tenantId, ctx.tenantId), eq(repairTickets.id, ticketId)))
    .limit(1)
    .all()[0];
  if (!row) throw appError("VALIDATION", "Esa ficha no existe.");

  const cashier = row.userId
    ? db.select({ name: users.name }).from(users).where(eq(users.id, row.userId)).limit(1).all()[0]
    : undefined;

  return {
    documentId: row.documentId,
    doc: {
      docNumber: row.docNumber ?? "",
      receivedAtMs: row.ticket.createdAt.getTime(),
      terminalName: tillContext(db).meta.terminal.name,
      cashierName: cashier?.name ?? "—",
      isCopy,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      device: {
        description: row.ticket.deviceDescription,
        imei: row.ticket.imei,
        reportedFault: row.ticket.reportedFault,
        conditionAtIntake: row.ticket.conditionAtIntake,
        damage: {
          screen: row.ticket.damageScreen,
          back: row.ticket.damageBack,
          dents: row.ticket.damageDents,
          water: row.ticket.damageWater,
        },
        damageNote: row.ticket.damageNote,
        accessories: row.ticket.accessories,
      },
      depositCents: row.ticket.depositCents,
      authorizedCapCents: row.ticket.authorizedCapCents,
      diagnosisFeeCents: row.ticket.diagnosisFeeCents,
      warrantyMonths: row.ticket.warrantyMonths,
      promisedAtMs: row.ticket.promisedDate?.getTime() ?? null,
      promisedHalf: row.ticket.promisedHalf,
    },
  };
}

/**
 * Print, reprint or PDF one of the repair documents.
 *
 * Only the intake receipt exists in this slice; the quote, the final receipt and
 * the not-repaired return note arrive with the slices that create the facts they
 * report, and are refused rather than half-rendered until then.
 */
export async function printRepair(
  db: ArkomDb,
  ctx: MutationCtx,
  req: RepairPrintRequest,
): Promise<PrintTicketResponse> {
  if (req.what !== "intake") {
    throw appError("VALIDATION", "Ese documento todavía no existe.");
  }
  const settings = getSettings(db, ctx);
  const loaded = loadIntakeDoc(db, ctx, req.ticketId, req.copy);
  const shop = shopProfile(db, ctx);

  const ops = renderIntakeReceipt(loaded.doc, shop, settings.paperWidthMm);
  const fileBase = `${loaded.doc.docNumber || "REPARACION"}${req.copy ? "-COPIA" : ""}`;

  if (req.target === "pdf" || !settings.printerName) {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: true,
      target: "pdf",
      path,
      what: req.what,
      copy: req.copy,
      ...(settings.printerName ? {} : { fallback: "NO_PRINTER" }),
    });
    return { kind: "pdf", path };
  }

  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: true,
      target: "printer",
      printer: settings.printerName,
      what: req.what,
      copy: req.copy,
    });
    return { kind: "printed", printer: settings.printerName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: false,
      target: "printer",
      printer: settings.printerName,
      what: req.what,
      copy: req.copy,
      error: message,
    });
    // same bargain as everywhere else: the ticket exists, the paper is a retry
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: true,
      target: "pdf",
      path,
      what: req.what,
      copy: req.copy,
      fallback: "PRINTER_FAILED",
    });
    return { kind: "pdf", path };
  }
}

export async function printPurchase(
  db: ArkomDb,
  ctx: MutationCtx,
  req: UsedPrintRequest,
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  const loaded = loadPurchaseDoc(db, ctx, req.purchaseId, req.copy);
  const shop = shopProfile(db, ctx);

  const ops =
    req.what === "label"
      ? renderShelfLabel(
          {
            barcode: loaded.barcode,
            device: loaded.doc.device,
            docNumber: loaded.doc.docNumber,
            sellPriceCents: loaded.sellPriceCents,
          },
          settings.paperWidthMm,
        )
      : renderPurchaseDoc(loaded.doc, shop, settings.paperWidthMm);

  const suffix = req.what === "label" ? "-etiqueta" : req.copy ? "-COPIA" : "";
  const fileBase = `${loaded.doc.docNumber || "COMPRA"}${suffix}`;

  if (req.target === "pdf") {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, loaded.documentId, { ok: true, target: "pdf", path, what: req.what, copy: req.copy });
    return { kind: "pdf", path };
  }

  // same bargain as the ticket: no printer means a PDF, not a dead end
  if (!settings.printerName) {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: true,
      target: "pdf",
      path,
      what: req.what,
      copy: req.copy,
      fallback: "NO_PRINTER",
    });
    return { kind: "pdf", path };
  }

  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: true,
      target: "printer",
      printer: settings.printerName,
      what: req.what,
      copy: req.copy,
    });
    return { kind: "printed", printer: settings.printerName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logPrintAttempt(db, ctx, loaded.documentId, {
      ok: false,
      target: "printer",
      printer: settings.printerName,
      what: req.what,
      copy: req.copy,
      error: message,
    });
    throw appError("PRINT_FAILED", `No se pudo imprimir en ${settings.printerName}.`);
  }
}


/**
 * One purchase, for the on-screen peek.
 *
 * Reads the same rows `renderPurchaseDoc` reads, and returns them as fields
 * rather than as a rendered receipt — the modal lays them out the way the sale
 * peek lays out a ticket. Printing still goes through the renderer, so the two
 * cannot drift apart in the way that matters: what the seller signs.
 */
export function peekPurchase(db: ArkomDb, ctx: MutationCtx, ref: { purchaseId?: string; documentId?: string }) {
  const { usedPurchases, storeCreditVouchers } = schema;
  const purchaseId =
    ref.purchaseId ??
    db
      .select({ id: usedPurchases.id })
      .from(usedPurchases)
      .where(and(eq(usedPurchases.tenantId, ctx.tenantId), eq(usedPurchases.documentId, ref.documentId ?? "")))
      .limit(1)
      .all()[0]?.id;
  if (!purchaseId) throw appError("VALIDATION", "Esa compra no existe.");

  const loaded = loadPurchaseDoc(db, ctx, purchaseId, false);
  const doc = loaded.doc;

  const voucher = db
    .select({
      amountCents: storeCreditVouchers.amountCents,
      status: storeCreditVouchers.status,
      remainingCents: storeCreditVouchers.remainingCents,
    })
    .from(storeCreditVouchers)
    .where(eq(storeCreditVouchers.purchaseId, purchaseId))
    .limit(1)
    .all()[0];

  const accessories = (["charger", "box", "cable", "case"] as const).filter((key) => doc.device.accessories[key]);

  return {
    purchaseId,
    docNumber: doc.docNumber,
    purchasedAtMs: doc.purchasedAtMs,
    cashierName: doc.cashierName,
    device: {
      brand: doc.device.brand,
      model: doc.device.model,
      storage: doc.device.storage,
      color: doc.device.color,
      grade: doc.device.grade,
      batteryPct: doc.device.batteryPct,
      imei: doc.device.imei,
      accessories,
    },
    seller: {
      name: doc.seller.name,
      phone: doc.seller.phone,
      idType: doc.seller.idType,
      idNumber: doc.seller.idNumber,
    },
    buyPriceCents: doc.buyPriceCents,
    payout: doc.payout,
    payoutReference: doc.payoutReference,
    voucher: voucher ?? null,
  };
}
