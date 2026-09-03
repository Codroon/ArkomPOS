/**
 * Reading the Windows printer list — v0.18.1.
 *
 * The list a shop PC hands back is mostly not printers: OneNote, Print to PDF,
 * an XPS writer, a fax modem. What the owner is looking for is the one machine
 * on the counter, and it is usually obvious from its name.
 */
import { describe, expect, it } from "vitest";
import { classifyPrinters, isVirtualQueue, looksLikeReceiptPrinter } from "../printers";

const q = (name: string) => ({ name, displayName: name });

/** What this shop's counter PC actually reports. */
const REAL_LIST = [
  q("OneNote (Desktop)"),
  q("Microsoft Print to PDF"),
  q("Fax"),
  q("Microsoft XPS Document Writer"),
  q("CITIZEN CT-S310II"),
];

describe("telling a receipt printer from a file writer", () => {
  it("knows the queues that write a file", () => {
    for (const name of [
      "Microsoft Print to PDF",
      "OneNote (Desktop)",
      "Fax",
      "Microsoft XPS Document Writer",
      "PDFCreator",
      "Adobe PDF",
    ]) {
      expect(isVirtualQueue(q(name)), name).toBe(true);
      // and never suggests one: a ticket sent there stops the counter with a
      // save dialog while the customer waits
      expect(looksLikeReceiptPrinter(q(name)), name).toBe(false);
    }
  });

  it("recognises the machines a phone shop actually has", () => {
    for (const name of [
      "CITIZEN CT-S310II",
      "EPSON TM-T20III Receipt",
      "Star TSP100 Cutter",
      "POS-58 Printer",
      "Generic / Text Only 80mm Thermal",
    ]) {
      expect(looksLikeReceiptPrinter(q(name)), name).toBe(true);
    }
  });

  it("does not mistake the office laser for the till's printer", () => {
    // not virtual, so it stays in the list — just never suggested
    const laser = q("HP LaserJet Pro M404dn");
    expect(isVirtualQueue(laser)).toBe(false);
    expect(looksLikeReceiptPrinter(laser)).toBe(false);
    expect(classifyPrinters([laser]).suggestion).toBeNull();
    expect(classifyPrinters([laser]).physical).toHaveLength(1);
  });
});

describe("what the picker offers", () => {
  it("puts the receipt printer first and the file writers behind the toggle", () => {
    const { physical, virtual, suggestion } = classifyPrinters(REAL_LIST);
    expect(physical.map((p) => p.name)).toEqual(["CITIZEN CT-S310II"]);
    expect(virtual.map((p) => p.name)).toEqual([
      "OneNote (Desktop)",
      "Microsoft Print to PDF",
      "Fax",
      "Microsoft XPS Document Writer",
    ]);
    expect(suggestion?.name).toBe("CITIZEN CT-S310II");
  });

  it("orders receipt-looking queues ahead of the shop's other printers", () => {
    const { physical } = classifyPrinters([q("HP LaserJet Pro"), q("Brother DCP-L2530DW"), q("EPSON TM-T20III")]);
    expect(physical[0]!.name).toBe("EPSON TM-T20III");
    expect(physical).toHaveLength(3); // nothing is hidden, only reordered
  });

  it("suggests nothing when two queues look equally right", () => {
    /* the till has no way to know which of them has paper in it, and a wrong
       guess the owner confirms by reflex is worse than no guess */
    const two = classifyPrinters([q("CITIZEN CT-S310II"), q("EPSON TM-T20III")]);
    expect(two.suggestion).toBeNull();
    expect(two.physical).toHaveLength(2);
  });

  it("suggests nothing on a PC with only file writers", () => {
    const none = classifyPrinters([q("Microsoft Print to PDF"), q("OneNote (Desktop)")]);
    expect(none.suggestion).toBeNull();
    expect(none.physical).toEqual([]);
    expect(none.virtual).toHaveLength(2);
  });

  it("copes with an empty list, which is what a fresh Windows install can give", () => {
    expect(classifyPrinters([])).toEqual({ physical: [], virtual: [], suggestion: null });
  });

  it("matches on the display name too, since that is what the owner reads", () => {
    const shown = [{ name: "USB001", displayName: "Citizen CT-S310II" }];
    expect(classifyPrinters(shown).suggestion?.name).toBe("USB001");
  });
});
