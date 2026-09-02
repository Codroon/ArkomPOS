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

/** Spanish, always: this file is for the shop's accountant, not for the UI. */
const ES = {
  sales: "informe-ventas",
  repairsOpen: "informe-reparaciones-abiertas",
  repairsClosed: "informe-reparaciones-cerradas",
  used: "informe-dispositivos-usados",
  valuation: "informe-valoracion",
  deadStock: "informe-stock-muerto",
} as const;

const TITLES: Record<keyof typeof ES, string> = {
  sales: "Ventas",
  repairsOpen: "Reparaciones abiertas",
  repairsClosed: "Reparaciones cerradas",
  used: "Dispositivos usados en depósito",
  valuation: "Valoración de inventario",
  deadStock: "Stock muerto",
};

/**
 * The warning, in the file.
 *
 * It sits above the header row so it cannot be lost by exporting: a margin that
 * is part estimate must say so wherever it is read (handoff §8).
 */
function preambleFor(title: string, subtitle: string, estimate: CostEstimate | null): string[] {
  const lines = [`${title} — ${subtitle}`];
  if (estimate && isEstimated(estimate)) {
    lines.push(
      `AVISO: ${estimate.estimatedLines} de ${estimate.estimatedLines + estimate.exactLines} líneas son anteriores a v0.14.0 y usan el coste actual del artículo. El margen es aproximado.`,
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
  report: keyof typeof ES,
  filters: Filters,
  withCosts: boolean,
): { text: string; rows: number; suggestedName: string } {
  const suggestedName = csvFileName(ES[report]);

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

      const columns: CsvColumn<(typeof rows)[number]>[] = [
        { header: "Concepto", cell: (r) => r.label },
        { header: "Operaciones", cell: (r) => r.count },
        { header: "Unidades", cell: (r) => r.qty },
        { header: "Base", cell: (r) => csvMoney(r.netCents) },
        { header: "IVA", cell: (r) => csvMoney(r.taxCents) },
        { header: "Total", cell: (r) => csvMoney(r.grossCents) },
      ];
      if (withCosts) {
        columns.push(
          { header: "Coste", cell: (r) => csvMoney(r.costCents) },
          { header: "Margen", cell: (r) => csvMoney(r.marginCents) },
          { header: "Margen %", cell: (r) => csvNumber(r.marginPct ?? null, 1) },
        );
      }
      return {
        text: renderCsv({
          columns,
          rows,
          preamble: [
            ...preambleFor(TITLES.sales, f.shiftId ? "Turno" : rangeLabel(f.fromMs, f.toMs), estimate),
            `Tickets: ${summary.tickets}`,
            `Base: ${csvMoney(summary.netCents)}  IVA: ${csvMoney(summary.taxCents)}  Total: ${csvMoney(summary.grossCents)}`,
            `Usado (REBU, sin IVA): ${csvMoney(summary.usedSalesCents)}`,
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
            { header: "Nº", cell: (r) => r.docNumber },
            { header: "Cliente", cell: (r) => r.customerName },
            { header: "Dispositivo", cell: (r) => r.device },
            { header: "Estado", cell: (r) => r.status },
            { header: "Días en estado", cell: (r) => r.daysInStatus },
            { header: "Días desde entrada", cell: (r) => r.daysSinceIntake },
            { header: "Técnico", cell: (r) => r.technicianName ?? "" },
            { header: "Prometido", cell: (r) => csvDate(r.promisedAtMs) },
            { header: "Vencida", cell: (r) => (r.overdue ? "Sí" : "No") },
          ],
          rows,
          preamble: preambleFor(TITLES.repairsOpen, "Ahora", null),
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
            { header: "Nº", cell: (r) => r.docNumber },
            { header: "Ticket", cell: (r) => r.collectionNumber },
            { header: "Cliente", cell: (r) => r.customerName },
            { header: "Dispositivo", cell: (r) => r.device },
            { header: "Entrada", cell: (r) => csvDate(r.intakeAtMs) },
            { header: "Entrega", cell: (r) => csvDate(r.collectedAtMs) },
            { header: "Días", cell: (r) => r.turnaroundDays },
            { header: "Ingresos", cell: (r) => csvMoney(r.revenueCents) },
            { header: "Piezas", cell: (r) => csvMoney(r.partsCostCents) },
            { header: "Mano de obra", cell: (r) => csvMoney(r.laborCents) },
            { header: "Margen", cell: (r) => csvMoney(r.marginCents) },
            { header: "Técnico", cell: (r) => r.technicianName ?? "" },
          ],
          rows,
          preamble: preambleFor(TITLES.repairsClosed, rangeLabel(f.fromMs, f.toMs), null),
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
            { header: "Nº compra", cell: (r) => r.docNumber },
            { header: "Modelo", cell: (r) => r.model },
            { header: "Grado", cell: (r) => r.grade ?? "" },
            { header: "Estado", cell: (r) => r.state },
            { header: "Coste", cell: (r) => csvMoney(r.costCents) },
            { header: "PVP", cell: (r) => csvMoney(r.salePriceCents) },
            { header: "Días retenido", cell: (r) => r.daysHeld },
          ],
          rows,
          preamble: [
            ...preambleFor(TITLES.used, "Ahora", null),
            `Saldo a favor pendiente: ${credit.count} vales, ${csvMoney(credit.totalCents)}`,
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
            { header: "Artículo", cell: (r) => r.name },
            { header: "Grupo", cell: (r) => r.groupName ?? "Sin grupo" },
            { header: "Existencias", cell: (r) => r.onHand },
            { header: "Coste unitario", cell: (r) => csvMoney(r.unitCostCents) },
            { header: "Valor", cell: (r) => csvMoney(r.valueCents) },
          ],
          rows: result.products,
          preamble: [
            ...preambleFor(TITLES.valuation, "Ahora", null),
            `Total a coste: ${csvMoney(result.totalCents)}`,
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
            { header: "Artículo", cell: (r) => r.name },
            { header: "Grupo", cell: (r) => r.groupName ?? "Sin grupo" },
            { header: "Existencias", cell: (r) => r.onHand },
            { header: "Coste inmovilizado", cell: (r) => csvMoney(r.costTiedUpCents) },
            { header: "Última venta", cell: (r) => (r.lastSaleAtMs === null ? "nunca" : csvDate(r.lastSaleAtMs)) },
            { header: "Días", cell: (r) => r.daysSinceSale },
          ],
          rows,
          preamble: preambleFor(TITLES.deadStock, `Sin venta en ${thresholdDays} días`, null),
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
  req: { report: keyof typeof ES; filters: Filters },
  withCosts: boolean,
): Promise<{ kind: "saved"; path: string; rows: number } | { kind: "cancelled" }> {
  const built = buildCsv(db, ctx, req.report, req.filters, withCosts);

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
  report: keyof typeof ES,
  filters: Filters,
  withCosts: boolean,
): string {
  return buildCsv(db, ctx, report, filters, withCosts).text;
}

export { bool };
