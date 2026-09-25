/**
 * Any report, as a file.
 *
 * It **re-runs the same query the screen ran**, from the same URL parameters —
 * the tab and the period. A handler that took rows from the client could hand
 * the gestor a file that differs from the report the shop looked at
 * (ADR-0016 §4).
 *
 * The bytes are `packages/core/src/csv.ts`, the till's own function rather than
 * a second implementation, so a file exported from a browser and one exported
 * at the counter are byte-identical: semicolons, decimal commas, dd/mm/yyyy and
 * a BOM, because it will be opened by double-clicking it on a Spanish Windows
 * whatever language the screen was in (ADR-0016 §6, A1).
 */
import { NextResponse, type NextRequest } from "next/server";
import { csvDate, csvDateTime, csvFileName, csvMoney, renderCsv, type CsvColumn } from "@arkom/core";
import { currentUser } from "../../../../src/auth/supabase";
import { accountForUser } from "../../../../src/db/pg-accounts";
import { getT } from "../../../../src/i18n/server";
import { labelFor, type Locale, type Translate } from "../../../../src/i18n";
import { describePeriod, parseRange, type Period } from "../../../../src/lib/range";
import {
  deadStock,
  repairsClosed,
  repairsOpen,
  salesByGroup,
  taxByRegime,
  usedHolding,
  valuation,
} from "../../../../src/db/report-queries";

export const dynamic = "force-dynamic";

const REPORTS = ["sales", "repairs", "used", "valuation", "dead"] as const;
type Report = (typeof REPORTS)[number];

/** One report → its rows, its columns and the name the file gets. */
async function build(
  report: Report,
  accountId: string,
  period: Period,
  t: Translate,
  /* ADR-0016 A1: the export's WORDS follow the staff language, and a shelf's
     name is one of its words when the name is the one we shipped */
  locale: Locale,
): Promise<{ slug: string; body: string; title: string }> {
  switch (report) {
    case "sales": {
      const [groups, tax] = await Promise.all([
        salesByGroup(accountId, period, locale),
        taxByRegime(accountId, period),
      ]);
      /* two tables in one file, separated by a blank line and a heading —
         which is what a gestor gets on paper from the till as well */
      const byGroup = renderCsv({
        columns: [
          { header: t("cat.group"), cell: (r) => r.label },
          { header: t("inf.sales.count"), cell: (r) => r.count },
          { header: t("inf.sales.qty"), cell: (r) => r.qty },
          { header: t("doc.base"), cell: (r) => csvMoney(r.netCents) },
          { header: t("doc.tax"), cell: (r) => csvMoney(r.taxCents) },
          { header: t("doc.total"), cell: (r) => csvMoney(r.grossCents) },
        ] satisfies ReadonlyArray<CsvColumn<(typeof groups)[number]>>,
        rows: groups,
        preamble: [t("inf.sales.byGroup")],
      });
      const byRegime = renderCsv({
        columns: [
          { header: t("inf.regime"), cell: (r) => labelFor(t, "regime", r.regime) },
          { header: t("inf.lines"), cell: (r) => r.lines },
          { header: t("doc.base"), cell: (r) => csvMoney(r.baseCents) },
          { header: t("doc.tax"), cell: (r) => csvMoney(r.taxCents) },
          { header: t("doc.total"), cell: (r) => csvMoney(r.totalCents) },
        ] satisfies ReadonlyArray<CsvColumn<(typeof tax)[number]>>,
        rows: tax,
        preamble: [t("inf.tax")],
      });
      /* the second BOM is stripped: one file, one byte-order mark */
      return {
        slug: t("file.sales"),
        title: t("inf.tab.sales"),
        body: byGroup + "\r\n" + byRegime.replace(/^﻿/, ""),
      };
    }

    case "repairs": {
      const [open, closed] = await Promise.all([repairsOpen(accountId), repairsClosed(accountId)]);
      const openCsv = renderCsv({
        columns: [
          { header: t("rp.device"), cell: (r) => r.device },
          { header: t("rp.customer"), cell: (r) => r.customerName },
          { header: t("rp.status"), cell: (r) => labelFor(t, "rps", r.status) },
          { header: t("inf.rep.days"), cell: (r) => r.daysSinceIntake },
          { header: t("rp.promised"), cell: (r) => r.promisedDate ?? "" },
          { header: t("inf.rep.overdue"), cell: (r) => (r.overdue ? "1" : "") },
        ] satisfies ReadonlyArray<CsvColumn<(typeof open)[number]>>,
        rows: open,
        preamble: [t("inf.rep.open")],
      });
      const closedCsv = renderCsv({
        columns: [
          { header: t("rp.device"), cell: (r) => r.device },
          { header: t("rp.customer"), cell: (r) => r.customerName },
          { header: t("rp.status"), cell: (r) => labelFor(t, "rps", r.status) },
          { header: t("inf.rep.turnaround"), cell: (r) => r.turnaroundDays },
          { header: t("inf.rep.parts"), cell: (r) => csvMoney(r.partsCostCents) },
          { header: t("inf.rep.labour"), cell: (r) => csvMoney(r.labourCents) },
          { header: t("inf.rep.charged"), cell: (r) => csvMoney(r.chargedCents) },
        ] satisfies ReadonlyArray<CsvColumn<(typeof closed)[number]>>,
        rows: closed,
        /* the missing column is named in the file too, not only on screen */
        preamble: [t("inf.rep.closed"), t("inf.rep.noMargin")],
      });
      return {
        slug: t("file.repairs"),
        title: t("inf.tab.repairs"),
        body: openCsv + "\r\n" + closedCsv.replace(/^﻿/, ""),
      };
    }

    case "used": {
      const rows = await usedHolding(accountId);
      return {
        slug: t("file.used"),
        title: t("inf.tab.used"),
        body: renderCsv({
          columns: [
            { header: t("us.device"), cell: (r) => r.model },
            { header: t("us.grade"), cell: (r) => r.grade ?? "" },
            { header: t("us.state"), cell: (r) => labelFor(t, "uss", r.state) },
            { header: t("inf.used.days"), cell: (r) => r.daysHeld },
            { header: t("inf.used.cost"), cell: (r) => csvMoney(r.costCents) },
            { header: t("us.price"), cell: (r) => csvMoney(r.salePriceCents) },
          ] satisfies ReadonlyArray<CsvColumn<(typeof rows)[number]>>,
          rows,
          preamble: [t("inf.used.title")],
        }),
      };
    }

    case "valuation": {
      const rows = await valuation(accountId, locale);
      return {
        slug: t("file.valuation"),
        title: t("inf.tab.valuation"),
        body: renderCsv({
          columns: [
            { header: t("cat.group"), cell: (r) => r.group },
            { header: t("inf.items"), cell: (r) => r.items },
            { header: t("inf.units"), cell: (r) => r.units },
            { header: t("inf.atCost"), cell: (r) => csvMoney(r.atCostCents) },
            { header: t("inf.atRetail"), cell: (r) => csvMoney(r.atRetailCents) },
          ] satisfies ReadonlyArray<CsvColumn<(typeof rows)[number]>>,
          rows,
          preamble: [t("inf.valuation")],
        }),
      };
    }

    case "dead": {
      const rows = await deadStock(accountId, 90, locale);
      return {
        slug: t("file.dead"),
        title: t("inf.tab.dead"),
        body: renderCsv({
          columns: [
            { header: t("cat.item"), cell: (r) => r.name },
            { header: t("cat.group"), cell: (r) => r.group ?? "" },
            { header: t("cat.stock"), cell: (r) => r.onHand },
            { header: t("inf.atCost"), cell: (r) => csvMoney(r.atCostCents) },
            {
              header: t("inf.lastSold"),
              cell: (r) => (r.lastSoldAt ? csvDate(r.lastSoldAt.getTime()) : t("inf.never")),
            },
          ] satisfies ReadonlyArray<CsvColumn<(typeof rows)[number]>>,
          rows,
          preamble: [t("inf.dead")],
        }),
      };
    }
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const account = await accountForUser(user.id);
  if (!account) return NextResponse.json({ error: "NO_ACCOUNT" }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const asked = params.get("report") ?? "";
  if (!(REPORTS as readonly string[]).includes(asked)) {
    return NextResponse.json({ error: "NO_SUCH_REPORT" }, { status: 404 });
  }

  const { t, locale } = await getT();
  const period = parseRange(params.get("range") ?? undefined, params.get("from") ?? undefined, params.get("to") ?? undefined);
  const report = await build(asked as Report, account.id, period, t, locale);

  /* the shop and the period travel with the file: a report nobody can tell the
     period of is one somebody misreads next quarter */
  const header = renderCsv({
    columns: [{ header: report.title, cell: () => "" }],
    rows: [],
    preamble: [`${report.title} — ${account.name}`, `${t("range.label")}: ${describePeriod(period, locale)}`,
               `${csvDateTime(Date.now())}`],
  }).split("\r\n").slice(0, 3).join("\r\n");

  return new NextResponse(header + "\r\n" + report.body.replace(/^﻿/, ""), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFileName(report.slug)}"`,
      "cache-control": "no-store",
    },
  });
}
