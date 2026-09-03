/**
 * Ticket ops → ESC/POS bytes.
 *
 * node-thermal-printer does the byte-level work (command set, code page,
 * cut and drawer sequences); this file only walks the op list core produced.
 * We ask it for `getBuffer()` rather than letting it do the I/O, because its
 * `printer:<name>` interface needs a native node-printer module — a second
 * native dependency, an Electron ABI rebuild, and one more thing to go wrong
 * on the shop's machine. Delivering the bytes ourselves (see raw-windows.ts)
 * keeps the printer name from settings as the target and adds nothing native.
 */
import { ThermalPrinter, PrinterTypes, CharacterSet } from "node-thermal-printer";
import { COLUMNS_BY_PAPER, type PaperWidthMm, type TicketOp } from "@arkom/core";

/* Two command sets (v0.18.1). Anything else — including the values a v0.18.0
   database may still hold — falls through to Epson, which is what a receipt
   printer that speaks anything speaks. */
const TYPES: Record<string, PrinterTypes> = {
  epson: PrinterTypes.EPSON,
  star: PrinterTypes.STAR,
};

export function encodeEscPos(ops: TicketOp[], commandSet: string, paperWidthMm: PaperWidthMm): Buffer {
  const printer = new ThermalPrinter({
    type: TYPES[commandSet] ?? PrinterTypes.EPSON,
    // never touched: we take the buffer out before any I/O happens
    interface: "buffer://arkom",
    width: COLUMNS_BY_PAPER[paperWidthMm],
    // PC858 is the Latin-1 page that carries € as well as ñ and the accents —
    // a ticket that prints "Espa?a" or a blank where the euro sign goes is a
    // ticket the customer cannot check
    characterSet: CharacterSet.PC858_EURO,
  });

  for (const op of ops) {
    switch (op.op) {
      case "barcode": {
        printer.alignCenter();
        /* type 73 is CODE128 in ESC/POS. hriPos 2 prints the human-readable
           text UNDER the bars, which is what makes a torn receipt still usable
           by somebody typing it in (ADR-0019). */
        printer.printBarcode(op.data, 73, { hriPos: 2, hriFont: 0, width: 2, height: 60 });
        printer.alignLeft();
        break;
      }
      case "text": {
        if (op.align === "center") printer.alignCenter();
        else if (op.align === "right") printer.alignRight();
        else printer.alignLeft();

        printer.bold(op.bold);
        if (op.size === "big") printer.setTextSize(1, 1);
        else if (op.size === "wide") printer.setTextSize(0, 1);
        else if (op.size === "tall") printer.setTextSize(1, 0);
        else printer.setTextNormal();

        printer.println(op.text);

        // leave the head in a known state so the next op starts from normal
        printer.setTextNormal();
        printer.bold(false);
        printer.alignLeft();
        break;
      }
      case "rule":
        printer.drawLine(op.char);
        break;
      case "feed":
        for (let i = 0; i < op.lines; i++) printer.newLine();
        break;
      case "cut":
        printer.cut();
        break;
      case "drawer":
        printer.openCashDrawer();
        break;
    }
  }

  return printer.getBuffer();
}
