/**
 * CSV export — ADR-0016 §4 and §6.
 *
 * The export **re-runs the same query** the screen ran, from the same filters. A
 * renderer that supplied the rows could supply different ones from those on
 * screen, and the file the accountant opens has to be the report the shop
 * looked at.
 *
 * The bytes themselves are `packages/core/src/csv.ts`'s business: semicolons,
 * decimal commas, dd/mm/yyyy and a BOM, so the file opens correctly when
 * somebody double-clicks it on a Spanish Windows.
 */
import { writeFile } from "node:fs/promises";
import { dialog, BrowserWindow } from "electron";
import {
  appError,
  csvDate,
  csvFileName,
  csvMoney,
  csvNumber,
  isEstimated,
  renderCsv,
  type CostEstimate,
  type CsvColumn,
  type MutationCtx,
} from "@arkom/core";
import type { ArkomDb } from "@arkom/db";
import {
  deadStock,
  notRepairedInPeriod,
  repairsClosed,
  repairsOpen,
  salesEstimate,
  salesRows,
  salesSummary,
  storeCreditOutstanding,
  usedHolding,
  valuation,
} from "./repos/reports";
import { getSettings } from "./repos/settings";

export type ReportId = "sales" | "repairsOpen" | "repairsClosed" | "used" | "valuation" | "deadStock";
export type CsvLocale = "es" | "en";

/**
 * The words in the file — v0.18.1.
 *
 * These used to be Spanish always, on the reasoning that the file is for the
 * shop's gestor. That was half the story: the person who presses Exportar is
 * the owner, reading a screen in their own language, and handing them a file
 * whose columns they cannot read to check is not respect for the accountant,
 * it is a report they cannot proof-read. So the CSV says what the screen said.
 *
 * What does NOT follow the language is the FORMAT — semicolons, decimal commas,
 * dd/mm/yyyy, the BOM (ADR-0016 §6). Those exist so the file opens correctly in
 * the Excel on the counter, which is a Spanish Windows whatever the toggle says.
 * Format is about the machine; words are about the reader.
 */
interface CsvHeaders {
  concept: string;
  operations: string;
  units: string;
  base: string;
  vat: string;
  total: string;
  cost: string;
  margin: string;
  marginPct: string;
  number: string;
  customer: string;
  device: string;
  status: string;
  daysInStatus: string;
  daysSinceIntake: string;
  technician: string;
  promised: string;
  overdue: string;
  ticket: string;
  intake: string;
  handover: string;
  days: string;
  revenue: string;
  parts: string;
  labor: string;
  purchaseNumber: string;
  model: string;
  grade: string;
  price: string;
  daysHeld: string;
  item: string;
  group: string;
  onHand: string;
  unitCost: string;
  value: string;
  tiedUpCost: string;
  lastSale: string;
}

interface CsvWords {
  slug: Record<ReportId, string>;
  title: Record<ReportId, string>;
  header: CsvHeaders;
  now: string;
  shift: string;
  noGroup: string;
  never: string;
  yes: string;
  no: string;
  tickets: string;
  base: string;
  vat: string;
  total: string;
  usedRebu: string;
  totalAtCost: string;
  creditOutstanding: (count: number, money: string) => string;
  noSaleIn: (days: number) => string;
  estimateWarning: (estimated: number, all: number) => string;
  repairStatus: Record<string, string>;
  usedState: Record<string, string>;
  method: Record<string, string>;
}

const WORDS: Record<CsvLocale, CsvWords> = {
  es: {
    slug: {
      sales: "informe-ventas",
      repairsOpen: "informe-reparaciones-abiertas",
      repairsClosed: "informe-reparaciones-cerradas",
      used: "informe-dispositivos-usados",
      valuation: "informe-valoracion",
      deadStock: "informe-stock-muerto",
    },
    title: {
      sales: "Ventas",
      repairsOpen: "Reparaciones abiertas",
      repairsClosed: "Reparaciones cerradas",
      used: "Dispositivos usados en depósito",
      valuation: "Valoración de inventario",
      deadStock: "Stock muerto",
    },
    header: {
      concept: "Concepto",
      operations: "Operaciones",
      units: "Unidades",
      base: "Base",
      vat: "IVA",
      total: "Total",
      cost: "Coste",
      margin: "Margen",
      marginPct: "Margen %",
      number: "Nº",
      customer: "Cliente",
      device: "Dispositivo",
      status: "Estado",
      daysInStatus: "Días en estado",
      daysSinceIntake: "Días desde entrada",
      technician: "Técnico",
      promised: "Prometido",
      overdue: "Vencida",
      ticket: "Ticket",
      intake: "Entrada",
      handover: "Entrega",
      days: "Días",
      revenue: "Ingresos",
      parts: "Piezas",
      labor: "Mano de obra",
      purchaseNumber: "Nº compra",
      model: "Modelo",
      grade: "Grado",
      price: "PVP",
      daysHeld: "Días retenido",
      item: "Artículo",
      group: "Grupo",
      onHand: "Existencias",
      unitCost: "Coste unitario",
      value: "Valor",
      tiedUpCost: "Coste inmovilizado",
      lastSale: "Última venta",
    },
    now: "Ahora",
    shift: "Turno",
    noGroup: "Sin grupo",
    never: "nunca",
    yes: "Sí",
    no: "No",
    tickets: "Tickets",
    base: "Base",
    vat: "IVA",
    total: "Total",
    usedRebu: "Usado (REBU, sin IVA)",
    totalAtCost: "Total a coste",
    creditOutstanding: (count, money) => `Saldo a favor pendiente: ${count} vales, ${money}`,
    noSaleIn: (days) => `Sin venta en ${days} días`,
    estimateWarning: (estimated, all) =>
      `AVISO: ${estimated} de ${all} líneas son anteriores a v0.14.0 y usan el coste actual del artículo. El margen es aproximado.`,
    repairStatus: {
      received: "Recibido",
      quoted: "Presupuestado",
      waiting_part: "Esperando pieza",
      in_repair: "En reparación",
      ready: "Listo",
      collected: "Entregado",
      not_repaired: "No reparado",
    },
    usedState: { held: "En depósito", needs_review: "Pendiente de revisión", in_stock: "En stock" },
    method: {
      cash: "Efectivo",
      card: "Tarjeta",
      bizum: "Bizum",
      transfer: "Transferencia",
      store_credit: "Saldo a favor",
      deposit: "Depósito",
    },
  },
  en: {
    slug: {
      sales: "sales-report",
      repairsOpen: "open-repairs-report",
      repairsClosed: "closed-repairs-report",
      used: "used-devices-report",
      valuation: "valuation-report",
      deadStock: "dead-stock-report",
    },
    title: {
      sales: "Sales",
      repairsOpen: "Open repairs",
      repairsClosed: "Closed repairs",
      used: "Used devices in holding",
      valuation: "Inventory valuation",
      deadStock: "Dead stock",
    },
    header: {
      concept: "Concept",
      operations: "Operations",
      units: "Units",
      base: "Net",
      vat: "VAT",
      total: "Total",
      cost: "Cost",
      margin: "Margin",
      marginPct: "Margin %",
      number: "No.",
      customer: "Customer",
      device: "Device",
      status: "Status",
      daysInStatus: "Days in status",
      daysSinceIntake: "Days since intake",
      technician: "Technician",
      promised: "Promised",
      overdue: "Overdue",
      ticket: "Ticket",
      intake: "Taken in",
      handover: "Handed back",
      days: "Days",
      revenue: "Revenue",
      parts: "Parts",
      labor: "Labour",
      purchaseNumber: "Purchase no.",
      model: "Model",
      grade: "Grade",
      price: "Price",
      daysHeld: "Days held",
      item: "Item",
      group: "Group",
      onHand: "On hand",
      unitCost: "Unit cost",
      value: "Value",
      tiedUpCost: "Cost tied up",
      lastSale: "Last sale",
    },
    now: "Now",
    shift: "Shift",
    noGroup: "No group",
    never: "never",
    yes: "Yes",
    no: "No",
    tickets: "Tickets",
    base: "Net",
    vat: "VAT",
    total: "Total",
    usedRebu: "Used (margin scheme, no VAT)",
    totalAtCost: "Total at cost",
    creditOutstanding: (count, money) => `Store credit outstanding: ${count} vouchers, ${money}`,
    noSaleIn: (days) => `No sale in ${days} days`,
    estimateWarning: (estimated, all) =>
      `NOTE: ${estimated} of ${all} lines predate v0.14.0 and use the item's current cost. The margin is approximate.`,
    repairStatus: {
      received: "Received",
      quoted: "Quoted",
      waiting_part: "Waiting for part",
      in_repair: "In repair",
      ready: "Ready",
      collected: "Handed back",
      not_repaired: "Not repaired",
    },
    usedState: { held: "In holding", needs_review: "Needs review", in_stock: "In stock" },
    method: {
      cash: "Cash",
      card: "Card",
      bizum: "Bizum",
      transfer: "Transfer",
      store_credit: "Store credit",
      deposit: "Deposit",
    },
  },
};

/**
 * The warning, in the file.
 *
 * It sits above the header row so it cannot be lost by exporting: a margin that
 * is part estimate must say so wherever it is read (handoff §8).
 */
function preambleFor(L: CsvWords, title: string, subtitle: string, estimate: CostEstimate | null): string[] {
  const lines = [`${title} — ${subtitle}`];
  if (estimate && isEstimated(estimate)) {
    lines.push(
      L.estimateWarning(estimate.estimatedLines, estimate.estimatedLines + estimate.exactLines),
    );
  }
  lines.push("");
  return lines;
}

const rangeLabel = (fromMs: number, toMs: number) =>
  `${csvDate(fromMs)} – ${csvDate(toMs - 86_400_000)}`;

type Filters = Record<string, unknown>;
const num = (f: Filters, k: string, fallback = 0) => (typeof f[k] === "number" ? (f[k] as number) : fallback);
const str = (f: Filters, k: string) => (typeof f[k] === "string" ? (f[k] as string) : null);
const bool = (f: Filters, k: string) => f[k] === true;

/** Build the whole document for one report, from filters alone. */
function buildCsv(
  db: ArkomDb,
  ctx: MutationCtx,
  report: ReportId,
  filters: Filters,
  withCosts: boolean,
  locale: CsvLocale,
): { text: string; rows: number; suggestedName: string } {
  const L = WORDS[locale];
  const suggestedName = csvFileName(L.slug[report]);
  /* a shelf has a name in each language; a product's name is the shop's own */
  const groupOf = (r: { groupName: string | null; groupNameEn?: string | null }) =>
    (locale === "en" ? (r.groupNameEn?.trim() || r.groupName) : r.groupName) ?? L.noGroup;

  switch (report) {
    case "sales": {
      const f = {
        fromMs: num(filters, "fromMs"),
        toMs: num(filters, "toMs"),
        shiftId: str(filters, "shiftId"),
      };
      const groupBy = (str(filters, "groupBy") ?? "day") as "day" | "group" | "product" | "user" | "method";
      const rows = salesRows(db, ctx, { ...f, groupBy }, withCosts);
      const estimate = withCosts ? salesEstimate(db, ctx, f) : null;
      const summary = salesSummary(db, ctx, f);

      /* the label is a DAY, a product's own name, a cashier, a payment method
         or a shelf — and only the last two are ours to word (v0.18.1) */
      const labelOf = (r: (typeof rows)[number]): string => {
        if (groupBy === "method") return L.method[r.label] ?? r.label;
        if (groupBy === "group") return (locale === "en" ? (r.labelEn?.trim() || r.label) : r.label) || L.noGroup;
        return r.label;
      };

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: L.header.concept, cell: labelOf },
        { header: L.header.operations, cell: (r) => r.count },
        { header: L.header.units, cell: (r) => r.qty },
        { header: L.header.base, cell: (r) => csvMoney(r.netCents) },
        { header: L.header.vat, cell: (r) => csvMoney(r.taxCents) },
        { header: L.header.total, cell: (r) => csvMoney(r.grossCents) },
      ];
      if (withCosts) {
        columns.push(
          { header: L.header.cost, cell: (r) => csvMoney(r.costCents) },
          { header: L.header.margin, cell: (r) => csvMoney(r.marginCents) },
          { header: L.header.marginPct, cell: (r) => csvNumber(r.marginPct ?? null, 1) },
        );
      }
      return {
        text: renderCsv({
          columns,
          rows,
          preamble: [
            ...preambleFor(L, L.title.sales, f.shiftId ? L.shift : rangeLabel(f.fromMs, f.toMs), estimate),
            `${L.tickets}: ${summary.tickets}`,
            `${L.base}: ${csvMoney(summary.netCents)}  ${L.vat}: ${csvMoney(summary.taxCents)}  ${L.total}: ${csvMoney(summary.grossCents)}`,
            `${L.usedRebu}: ${csvMoney(summary.usedSalesCents)}`,
            "",
          ],
        }),
        rows: rows.length,
        suggestedName,
      };
    }

    case "repairsOpen": {
      const rows = repairsOpen(db, ctx, { status: str(filters, "status"), technicianId: str(filters, "technicianId") });
      return {
        text: renderCsv({
          columns: [
            { header: L.header.number, cell: (r) => r.docNumber },
            { header: L.header.customer, cell: (r) => r.customerName },
            { header: L.header.device, cell: (r) => r.device },
            { header: L.header.status, cell: (r) => L.repairStatus[r.status] ?? r.status },
            { header: L.header.daysInStatus, cell: (r) => r.daysInStatus },
            { header: L.header.daysSinceIntake, cell: (r) => r.daysSinceIntake },
            { header: L.header.technician, cell: (r) => r.technicianName ?? "" },
            { header: L.header.promised, cell: (r) => csvDate(r.promisedAtMs) },
            { header: L.header.overdue, cell: (r) => (r.overdue ? L.yes : L.no) },
          ],
          rows,
          preamble: preambleFor(L, L.title.repairsOpen, L.now, null),
        }),
        rows: rows.length,
        suggestedName,
      };
    }

    case "repairsClosed": {
      const f = { fromMs: num(filters, "fromMs"), toMs: num(filters, "toMs") };
      const rows = repairsClosed(db, ctx, f);
      return {
        text: renderCsv({
          columns: [
            { header: L.header.number, cell: (r) => r.docNumber },
            { header: L.header.ticket, cell: (r) => r.collectionNumber },
            { header: L.header.customer, cell: (r) => r.customerName },
            { header: L.header.device, cell: (r) => r.device },
            { header: L.header.intake, cell: (r) => csvDate(r.intakeAtMs) },
            { header: L.header.handover, cell: (r) => csvDate(r.collectedAtMs) },
            { header: L.header.days, cell: (r) => r.turnaroundDays },
            { header: L.header.revenue, cell: (r) => csvMoney(r.revenueCents) },
            { header: L.header.parts, cell: (r) => csvMoney(r.partsCostCents) },
            { header: L.header.labor, cell: (r) => csvMoney(r.laborCents) },
            { header: L.header.margin, cell: (r) => csvMoney(r.marginCents) },
            { header: L.header.technician, cell: (r) => r.technicianName ?? "" },
          ],
          rows,
          preamble: preambleFor(L, L.title.repairsClosed, rangeLabel(f.fromMs, f.toMs), null),
        }),
        rows: rows.length,
        suggestedName,
      };
    }

    case "used": {
      const rows = usedHolding(db, ctx, { status: str(filters, "status"), grade: str(filters, "grade") });
      const credit = storeCreditOutstanding(db, ctx);
      return {
        text: renderCsv({
          columns: [
            { header: L.header.purchaseNumber, cell: (r) => r.docNumber },
            { header: L.header.model, cell: (r) => r.model },
            { header: L.header.grade, cell: (r) => r.grade ?? "" },
            { header: L.header.status, cell: (r) => L.usedState[r.state] ?? r.state },
            { header: L.header.cost, cell: (r) => csvMoney(r.costCents) },
            { header: L.header.price, cell: (r) => csvMoney(r.salePriceCents) },
            { header: L.header.daysHeld, cell: (r) => r.daysHeld },
          ],
          rows,
          preamble: [
            ...preambleFor(L, L.title.used, L.now, null),
            L.creditOutstanding(credit.count, csvMoney(credit.totalCents)),
            "",
          ],
        }),
        rows: rows.length,
        suggestedName,
      };
    }

    case "valuation": {
      const result = valuation(db, ctx, { groupId: str(filters, "groupId") });
      return {
        text: renderCsv({
          columns: [
            { header: L.header.item, cell: (r) => r.name },
            { header: L.header.group, cell: groupOf },
            { header: L.header.onHand, cell: (r) => r.onHand },
            { header: L.header.unitCost, cell: (r) => csvMoney(r.unitCostCents) },
            { header: L.header.value, cell: (r) => csvMoney(r.valueCents) },
          ],
          rows: result.products,
          preamble: [
            ...preambleFor(L, L.title.valuation, L.now, null),
            `${L.totalAtCost}: ${csvMoney(result.totalCents)}`,
            "",
          ],
        }),
        rows: result.products.length,
        suggestedName,
      };
    }

    case "deadStock": {
      const thresholdDays = getSettings(db, ctx).deadStockDays;
      const rows = deadStock(db, ctx, { groupId: str(filters, "groupId"), thresholdDays });
      return {
        text: renderCsv({
          columns: [
            { header: L.header.item, cell: (r) => r.name },
            { header: L.header.group, cell: groupOf },
            { header: L.header.onHand, cell: (r) => r.onHand },
            { header: L.header.tiedUpCost, cell: (r) => csvMoney(r.costTiedUpCents) },
            { header: L.header.lastSale, cell: (r) => (r.lastSaleAtMs === null ? L.never : csvDate(r.lastSaleAtMs)) },
            { header: L.header.days, cell: (r) => r.daysSinceSale },
          ],
          rows,
          preamble: preambleFor(L, L.title.deadStock, L.noSaleIn(thresholdDays), null),
        }),
        rows: rows.length,
        suggestedName,
      };
    }
  }
}

/** Ask where to put it, then write it. Cancelling is a normal outcome. */
export async function exportReport(
  db: ArkomDb,
  ctx: MutationCtx,
  req: { report: ReportId; filters: Filters; locale?: CsvLocale },
  withCosts: boolean,
): Promise<{ kind: "saved"; path: string; rows: number } | { kind: "cancelled" }> {
  const built = buildCsv(db, ctx, req.report, req.filters, withCosts, req.locale ?? "es");

  const win = BrowserWindow.getFocusedWindow();
  const result = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: built.suggestedName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      })
    : await dialog.showSaveDialog({
        defaultPath: built.suggestedName,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
  if (result.canceled || !result.filePath) return { kind: "cancelled" };

  try {
    await writeFile(result.filePath, built.text, "utf8");
  } catch (err) {
    throw appError("VALIDATION", `No se pudo guardar el archivo: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { kind: "saved", path: result.filePath, rows: built.rows };
}

/** The same document without a dialog — what the tests assert bytes against. */
export function renderReportCsv(
  db: ArkomDb,
  ctx: MutationCtx,
  report: ReportId,
  filters: Filters,
  withCosts: boolean,
  locale: CsvLocale = "es",
): string {
  return buildCsv(db, ctx, report, filters, withCosts, locale).text;
}

export { bool };
