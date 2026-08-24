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
import { BrowserWindow } from "electron";
import {
  appError,
  mutate,
  renderTicket,
  type MutationCtx,
  type PrinterInfo,
  type PrintTicketRequest,
  type PrintTicketResponse,
  type TicketDoc,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import { makeMutateRunner } from "../mutate-runner";
import { peek } from "../repos/sale";
import { getSettings, shopProfile } from "../repos/settings";
import { tillContext } from "../context";
import { encodeEscPos } from "./escpos";
import { renderTicketPdf } from "./pdf";
import { sendRawToPrinter } from "./raw-windows";

export { ticketsDir } from "./pdf";

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

  if (!settings.printerName) {
    logPrintAttempt(db, ctx, req.docId, {
      ok: false,
      target: "printer",
      printer: null,
      copy: req.copy,
      error: "NO_PRINTER",
    });
    throw appError("PRINT_FAILED", "No hay impresora configurada en Ajustes.");
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
