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
import { BrowserWindow, shell, dialog } from "electron";
import { extname, resolve, sep } from "node:path";
import { mkdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import {
  appError,
  mutate,
  renderPurchaseDoc,
  renderIntakeReceipt,
  renderQuoteDoc,
  renderRepairReceipt,
  renderReturnDoc,
  renderZReport,
  warrantyEndsAt,
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
  type QuoteDoc,
  type RepairReceiptDoc,
  type ReturnDoc,
} from "@arkom/core";
import type { ShiftReportDoc, ShiftTotals } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { peek } from "../repos/sale";
import { getSettings, shopProfile } from "../repos/settings";
import { openShift, shiftById, shiftTotals } from "../repos/shift";
import { getDetail } from "../repos/repair";
import { tillContext } from "../context";
import { encodeEscPos } from "./escpos";
import { pdfTempDir, renderTicketPdf } from "./pdf";
import { sendRawToPrinter } from "./raw-windows";

export { cleanPdfTemp, pdfTempDir } from "./pdf";

/**
 * Open a saved ticket in the system viewer, or show it in the file manager.
 *
 * The renderer supplies the path, so it is resolved against the tickets folder
 * and required to be a .pdf before the shell ever sees it — this is a door into
 * the OS and it opens onto exactly one directory.
 */
export async function revealTicket(path: string, mode: "open" | "folder"): Promise<{ ok: boolean }> {
  const target = resolve(path);
  const dir = resolve(pdfTempDir());

  // the render folder itself is openable, and created lazily on the first render
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
  /* A refund prints as a refund, naming the ticket it reverses. The doc type is
     read from the row rather than guessed from a negative total, because a
     total is an amount and a type is a fact (ADR-0019). */
  const row = db
    .select({ docType: schema.documents.docType, refundsDocumentId: schema.documents.refundsDocumentId })
    .from(schema.documents)
    .where(eq(schema.documents.id, docId))
    .all()[0];
  let refundOf: string | undefined;
  if (row?.docType === "refund" && row.refundsDocumentId) {
    refundOf =
      db
        .select({ docNumber: schema.documents.docNumber })
        .from(schema.documents)
        .where(eq(schema.documents.id, row.refundsDocumentId))
        .all()[0]?.docNumber ?? undefined;
  }
  return {
    ...(refundOf ? { refundOf } : {}),
    docNumber: ticket.docNumber,
    completedAtMs: ticket.completedAtMs,
    // the rate the taxed lines were sold at, for the "IVA 21%" label; a ticket
    // of margin-scheme lines only has none to name
    vatRateBp: ticket.lines.reduce<number | undefined>(
      (top, l) => ((l.taxRateBp ?? 0) > 0 && (l.taxRateBp ?? 0) > (top ?? 0) ? (l.taxRateBp ?? 0) : top),
      undefined,
    ),
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
  /* An automatic print with no printer configured writes NOTHING (v0.18.0).
     The fallback PDF exists for a person who asked for paper; the till asking
     on its own behalf, once per document, filed a file nobody opened and put a
     "PDF saved" toast in front of the next customer. */
  if (req.auto && req.target !== "pdf" && !settings.printerName) return { kind: "noPrinter" };

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
  /* "Imprimir prueba" answers one question — does the machine on the counter
     print what this till sends? — and there is nothing to answer with when no
     printer is configured. The button is disabled in Ajustes; this is the same
     rule in main, where it cannot be forgotten (v0.18.1). */
  if (target !== "pdf" && !settings.printerName) {
    throw appError("PRINTER_REQUIRED", "No hay impresora configurada. Elige una en Ajustes.");
  }
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
    /* THE one artefact in this app that cannot be recovered from the database.
       Writing it to the temp folder we empty at every launch was a way to lose
       it by doing nothing, so the shop is asked where to keep it (v0.18.2). */
    const suggested = `codigo-recuperacion-${new Date().toISOString().slice(0, 10)}.pdf`;
    const win = BrowserWindow.getFocusedWindow();
    const chosen = await (win
      ? dialog.showSaveDialog(win, { defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] })
      : dialog.showSaveDialog({ defaultPath: suggested, filters: [{ name: "PDF", extensions: ["pdf"] }] }));
    const path = await renderTicketPdf(
      ops,
      settings.paperWidthMm,
      "CODIGO-RECUPERACION",
      chosen.canceled || !chosen.filePath ? undefined : chosen.filePath,
    );
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
function loadQuoteDoc(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  isCopy: boolean,
): { doc: QuoteDoc; documentId: string } {
  const detail = getDetail(db, ctx, ticketId);
  const intake = loadIntakeDoc(db, ctx, ticketId, isCopy);
  // the most recent approval is the one that stands; older ones stay on the
  // ticket but the paper describes the agreement in force
  const approval = detail.approvals[0] ?? null;

  return {
    documentId: intake.documentId,
    doc: {
      docNumber: detail.docNumber,
      quotedAtMs: Date.now(),
      terminalName: intake.doc.terminalName,
      cashierName: intake.doc.cashierName,
      isCopy,
      customerName: detail.customer.name,
      customerPhone: detail.customer.phone,
      device: detail.device,
      lines: detail.lines.map((line) => ({
        description: line.description,
        qty: line.qty,
        chargeCents: line.chargeCents,
        onOrder: line.kind === "part_on_order" && line.receivedAt === null,
      })),
      totalCents: detail.quoteTotalCents,
      depositCents: detail.depositCents,
      approval: approval
        ? { method: approval.method, atMs: approval.createdAt, approvedTotalCents: approval.approvedTotalCents }
        : null,
    },
  };
}

/**
 * The collection receipt: the fiscal document AND the warranty statement.
 *
 * It reads the T1- the ticket points at, so what prints is the document that
 * exists rather than a re-derivation of it — the amounts on paper are the
 * amounts in the books by construction.
 */
function loadReceiptDoc(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  isCopy: boolean,
): { doc: RepairReceiptDoc; documentId: string } {
  const detail = getDetail(db, ctx, ticketId);
  const intake = loadIntakeDoc(db, ctx, ticketId, isCopy);
  if (!detail.collectionDocumentId) {
    throw appError("VALIDATION", "Esta ficha todavía no se ha cobrado.");
  }

  const { documents, documentLines, documentTenders } = schema;
  const doc = db
    .select()
    .from(documents)
    .where(eq(documents.id, detail.collectionDocumentId))
    .limit(1)
    .all()[0];
  if (!doc) throw appError("VALIDATION", "No se encuentra el recibo.");

  const lines = db.select().from(documentLines).where(eq(documentLines.documentId, doc.id)).all();
  const tenders = db.select().from(documentTenders).where(eq(documentTenders.documentId, doc.id)).all();
  const paid = tenders.reduce((total, t) => total + t.amountCents, 0);

  return {
    documentId: doc.id,
    doc: {
      docNumber: doc.docNumber ?? "",
      repairDocNumber: detail.docNumber,
      collectedAtMs: (doc.completedAt ?? doc.createdAt).getTime(),
      terminalName: intake.doc.terminalName,
      cashierName: intake.doc.cashierName,
      isCopy,
      customerName: detail.customer.name,
      device: detail.device,
      lines: lines.map((l) => ({ description: l.description, qty: l.qty, chargeCents: l.totalCents })),
      subtotalCents: doc.subtotalCents,
      taxCents: doc.taxCents,
      taxRateBp: lines[0]?.taxRateBp ?? getSettings(db, ctx).vatRateBp,
      totalCents: doc.totalCents,
      tenders: tenders.map((t) => ({
        method: TENDER_ES[t.method] ?? t.method,
        amountCents: t.amountCents,
        isDeposit: t.method === "deposit",
      })),
      changeCents: Math.max(0, paid - doc.totalCents),
      warrantyEndsAtMs: warrantyEndsAt(doc.completedAt ?? doc.createdAt, detail.warrantyMonths).getTime(),
    },
  };
}

/** The paper that closes a ticket nobody repaired. */
function loadReturnDoc(
  db: ArkomDb,
  ctx: MutationCtx,
  ticketId: string,
  isCopy: boolean,
): { doc: ReturnDoc; documentId: string } {
  const detail = getDetail(db, ctx, ticketId);
  const intake = loadIntakeDoc(db, ctx, ticketId, isCopy);
  if (!detail.notRepairedAt || !detail.notRepairedReason) {
    throw appError("VALIDATION", "Esta ficha no está cerrada como no reparada.");
  }

  const { cashMovements } = schema;
  const cash = db.select().from(cashMovements).where(eq(cashMovements.ticketId, ticketId)).all();
  const sumOf = (reason: string) =>
    cash.filter((c) => c.reason === reason).reduce((total, c) => total + Math.abs(c.amountCents), 0);
  const applied = sumOf("repair_deposit_applied");
  const refunded = sumOf("repair_deposit_refund");

  // whatever survived the resolution is what the customer is being charged for
  const chargedParts = detail.lines.filter((l) => l.kind === "inventory_part");
  const owed = chargedParts.reduce((total, l) => total + l.chargeCents, 0) + detail.diagnosisFeeCents;

  return {
    documentId: detail.documentId,
    doc: {
      docNumber: detail.docNumber,
      returnedAtMs: detail.notRepairedAt,
      terminalName: intake.doc.terminalName,
      cashierName: intake.doc.cashierName,
      isCopy,
      customerName: detail.customer.name,
      customerPhone: detail.customer.phone,
      device: detail.device,
      reason: detail.notRepairedReason,
      chargedParts: chargedParts.map((l) => ({
        description: l.description,
        qty: l.qty,
        chargeCents: l.chargeCents,
      })),
      diagnosisFeeCents: chargedParts.length > 0 || applied > 0 ? detail.diagnosisFeeCents : 0,
      depositAppliedCents: applied,
      depositRefundedCents: refunded,
      dueCents: Math.max(0, owed - applied),
    },
  };
}

/** Fixed Spanish for the tender names on printed paper (ADR-0011). */
const TENDER_ES: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  transfer: "Transferencia",
  store_credit: "Saldo a favor",
  deposit: "Depósito",
};

export async function printRepair(
  db: ArkomDb,
  ctx: MutationCtx,
  req: RepairPrintRequest,
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  /* An automatic print with no printer configured writes NOTHING (v0.18.0).
     The fallback PDF exists for a person who asked for paper; the till asking
     on its own behalf, once per document, filed a file nobody opened and put a
     "PDF saved" toast in front of the next customer. */
  if (req.auto && req.target !== "pdf" && !settings.printerName) return { kind: "noPrinter" };

  const shop = shopProfile(db, ctx);

  const loaded =
    req.what === "quote"
      ? loadQuoteDoc(db, ctx, req.ticketId, req.copy)
      : req.what === "receipt"
        ? loadReceiptDoc(db, ctx, req.ticketId, req.copy)
        : req.what === "return"
          ? loadReturnDoc(db, ctx, req.ticketId, req.copy)
          : loadIntakeDoc(db, ctx, req.ticketId, req.copy);

  const ops =
    req.what === "quote"
      ? renderQuoteDoc((loaded as { doc: QuoteDoc }).doc, shop, settings.paperWidthMm)
      : req.what === "receipt"
        ? renderRepairReceipt((loaded as { doc: RepairReceiptDoc }).doc, shop, settings.paperWidthMm)
        : req.what === "return"
          ? renderReturnDoc((loaded as { doc: ReturnDoc }).doc, shop, settings.paperWidthMm)
          : renderIntakeReceipt((loaded as { doc: IntakeReceiptDoc }).doc, shop, settings.paperWidthMm);
  const suffix =
    req.what === "quote" ? "-presupuesto" : req.what === "return" ? "-devolucion" : "";
  const fileBase = `${loaded.doc.docNumber || "REPARACION"}${suffix}${req.copy ? "-COPIA" : ""}`;

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
  /* An automatic print with no printer configured writes NOTHING (v0.18.0).
     The fallback PDF exists for a person who asked for paper; the till asking
     on its own behalf, once per document, filed a file nobody opened and put a
     "PDF saved" toast in front of the next customer. */
  if (req.auto && req.target !== "pdf" && !settings.printerName) return { kind: "noPrinter" };

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

/* ----------------------------------------------------- the Z and the X */

/**
 * A shift print is not a document print.
 *
 * `logPrintAttempt` hangs its entry off a `documents` row, and a Z has none — it
 * is the shop's summary of a period, not one of the things in it. Its own entity
 * keeps `db:audit --entity document` meaning what it has always meant.
 */
function logShiftPrint(db: ArkomDb, ctx: MutationCtx, shiftId: string, after: Record<string, unknown>): void {
  mutate(makeMutateRunner(db), ctx, (_tx, log) => {
    log({ entity: "shift", entityId: shiftId, action: "print", before: null, after });
  });
}

/**
 * A shift's own paper.
 *
 * A **reprint renders the stored snapshot** and never a recomputation
 * (ADR-0015 §7): the Z is the shop's statement about a day, and a later change
 * to the underlying rows must not silently rewrite a document somebody already
 * signed and filed. An X, by contrast, is a live computation by definition.
 */
/** The frozen Z (or the live X) as a document — shared by print and save. */
export function shiftReportDoc(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { shiftId?: string; what: "z" | "x"; copy: boolean },
): ShiftReportDoc {
  const { users } = schema;
  const shift = req.shiftId ? shiftById(db, req.shiftId) : openShift(db, ctx);
  if (!shift) throw appError("VALIDATION", "No hay ningún turno que imprimir.");

  const snapshot = shift.snapshot as
    | {
        totals: ShiftTotals;
        countedCashCents: number;
        varianceCents: number;
        varianceReason: string | null;
        approvedByUserId: string | null;
      }
    | null;

  const isZ = req.what === "z" && snapshot !== null;
  const totals = isZ ? snapshot!.totals : shiftTotals(db, shift);
  const name = (id: string | null) =>
    id ? (db.select({ name: users.name }).from(users).where(eq(users.id, id)).all()[0]?.name ?? null) : null;

  const doc: ShiftReportDoc = {
    zDocNumber: isZ ? shift.zDocNumber : null,
    terminalName: tillContext(db).meta.terminal.name,
    openedAtMs: shift.openedAt.getTime(),
    openedByName: name(shift.openedByUserId),
    closedAtMs: isZ ? (shift.closedAt?.getTime() ?? null) : null,
    closedByName: isZ ? name(shift.closedByUserId) : null,
    printedAtMs: Date.now(),
    isCopy: req.copy,
    totals,
    countedCashCents: isZ ? snapshot!.countedCashCents : null,
    varianceCents: isZ ? snapshot!.varianceCents : null,
    varianceReason: isZ ? snapshot!.varianceReason : null,
    approvedByName: isZ ? name(snapshot!.approvedByUserId) : null,
  };
  return doc;
}

export async function printShiftReport(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { shiftId?: string; what: "z" | "x"; target: "auto" | "pdf"; copy: boolean; locale?: "es" | "en"; auto?: boolean },
): Promise<PrintTicketResponse> {
  const settings = getSettings(db, ctx);
  /* An automatic print with no printer configured writes NOTHING (v0.18.0).
     The fallback PDF exists for a person who asked for paper; the till asking
     on its own behalf, once per document, filed a file nobody opened and put a
     "PDF saved" toast in front of the next customer. */
  if (req.auto && req.target !== "pdf" && !settings.printerName) return { kind: "noPrinter" };

  const shop = shopProfile(db, ctx);
  const doc = shiftReportDoc(db, ctx, req);
  const shift = (req.shiftId ? shiftById(db, req.shiftId) : openShift(db, ctx))!;
  const isZ = doc.zDocNumber !== null;

  /* A Z is the shop talking to itself, so it follows the staff language — unlike
     a customer document, which stays fixed Spanish (ADR-0015 amendment). */
  const ops = renderZReport(doc, shop, settings.paperWidthMm, req.locale ?? "es");
  const fileBase = `${doc.zDocNumber ?? "X"}${req.copy ? "-COPIA" : ""}`;
  const what = isZ ? "shift_z" : "shift_x";

  if (req.target === "pdf" || !settings.printerName) {
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logShiftPrint(db, ctx, shift.id, {
      ok: true,
      target: "pdf",
      path,
      what,
      copy: req.copy,
      ...(settings.printerName ? {} : { fallback: "NO_PRINTER" }),
    });
    return { kind: "pdf", path };
  }

  try {
    await sendRawToPrinter(settings.printerName, encodeEscPos(ops, settings.commandSet, settings.paperWidthMm));
    logShiftPrint(db, ctx, shift.id, { ok: true, target: "printer", printer: settings.printerName, what, copy: req.copy });
    return { kind: "printed", printer: settings.printerName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logShiftPrint(db, ctx, shift.id, {
      ok: false,
      target: "printer",
      printer: settings.printerName,
      what,
      copy: req.copy,
      error: message,
    });
    const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase);
    logShiftPrint(db, ctx, shift.id, { ok: true, target: "pdf", path, what, copy: req.copy, fallback: "PRINTER_FAILED" });
    return { kind: "pdf", path };
  }
}

/* ------------------------------------------ save a PDF where asked (v0.17.0) */

/**
 * One document, one file, at a path the shop chose.
 *
 * The till stopped writing a PDF per sale: a reprint renders from the stored
 * snapshot, so the file was a duplicate of a record that already existed and a
 * slow leak of disk nobody swept. What is left is this — an explicit "Guardar
 * PDF…", which is the only time a shop actually wants a file.
 *
 * Cancelling the dialog returns `cancelled` rather than throwing. Closing a
 * save dialog is a decision, and a red toast for it would be the till arguing.
 */
export async function saveDocumentPdf(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { docId: string; kind: "ticket" | "repair" | "purchase" | "shift"; what?: string | null; copy: boolean },
): Promise<{ kind: "saved"; path: string } | { kind: "cancelled" }> {
  const settings = getSettings(db, ctx);
  const shop = shopProfile(db, ctx);

  let ops: TicketOp[];
  let fileBase: string;

  if (req.kind === "repair") {
    const what = req.what ?? "intake";
    const loaded =
      what === "quote"
        ? loadQuoteDoc(db, ctx, req.docId, req.copy)
        : what === "receipt"
          ? loadReceiptDoc(db, ctx, req.docId, req.copy)
          : what === "return"
            ? loadReturnDoc(db, ctx, req.docId, req.copy)
            : loadIntakeDoc(db, ctx, req.docId, req.copy);
    ops =
      what === "quote"
        ? renderQuoteDoc((loaded as { doc: QuoteDoc }).doc, shop, settings.paperWidthMm)
        : what === "receipt"
          ? renderRepairReceipt((loaded as { doc: RepairReceiptDoc }).doc, shop, settings.paperWidthMm)
          : what === "return"
            ? renderReturnDoc((loaded as { doc: ReturnDoc }).doc, shop, settings.paperWidthMm)
            : renderIntakeReceipt((loaded as { doc: IntakeReceiptDoc }).doc, shop, settings.paperWidthMm);
    fileBase = loaded.doc.docNumber || "REPARACION";
  } else if (req.kind === "purchase") {
    const loaded = loadPurchaseDoc(db, ctx, req.docId, req.copy);
    ops = renderPurchaseDoc(loaded.doc, shop, settings.paperWidthMm);
    fileBase = loaded.doc.docNumber || "COMPRA";
  } else if (req.kind === "shift") {
    const built = shiftReportDoc(db, ctx, { shiftId: req.docId, what: "z", copy: req.copy });
    ops = renderZReport(built, shop, settings.paperWidthMm);
    fileBase = built.zDocNumber ?? "X";
  } else {
    const doc = toTicketDoc(db, ctx, req.docId, req.copy);
    ops = renderTicket(doc, shop, settings.paperWidthMm);
    fileBase = doc.docNumber;
  }

  const chosen = await dialog.showSaveDialog({
    defaultPath: `${fileBase}${req.copy ? "-COPIA" : ""}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (chosen.canceled || !chosen.filePath) return { kind: "cancelled" };

  const path = await renderTicketPdf(ops, settings.paperWidthMm, fileBase, chosen.filePath);
  logPrintAttempt(db, ctx, req.docId, { ok: true, target: "pdf", path, copy: req.copy, saved: true });
  return { kind: "saved", path };
}

/**
 * Kick the drawer with nothing to sell.
 *
 * The "is it plugged in" test, and the only way to answer it without ringing up
 * a fake sale. It goes through the configured command set, because a drawer
 * that opens on a test and not on a ticket has told the shop nothing.
 */
export async function testDrawerKick(db: ArkomDb, ctx: MutationCtx): Promise<{ ok: boolean }> {
  const settings = getSettings(db, ctx);
  if (!settings.printerName) throw appError("PRINT_FAILED", "No hay impresora configurada en Ajustes.");
  /* the drawer is wired to the printer, so the pulse is a printer command with
     no paper behind it */
  const bytes = encodeEscPos([{ op: "drawer" }], settings.commandSet, settings.paperWidthMm);
  try {
    await sendRawToPrinter(settings.printerName, bytes);
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      log({ entity: "printer", entityId: settings.printerName, action: "test", before: null, after: { drawer: true, ok: true } });
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mutate(makeMutateRunner(db), ctx, (_tx, log) => {
      log({ entity: "printer", entityId: settings.printerName, action: "test", before: null, after: { drawer: true, ok: false, error: message } });
    });
    throw appError("PRINT_FAILED", message);
  }
}
