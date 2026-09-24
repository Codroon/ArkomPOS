/**
 * The sales list, as a file.
 *
 * It **re-runs the same query the screen ran**, from the same URL parameters. A
 * handler that took rows from the client could hand the accountant a file that
 * differs from the report the shop looked at (ADR-0016 §4).
 *
 * The bytes are `packages/core/src/csv.ts` — the same function the till uses,
 * imported rather than reimplemented, so a file exported from the browser and
 * one exported from the counter are byte-identical: semicolons, decimal commas,
 * dd/mm/yyyy and a BOM, because it will be opened by double-clicking it on a
 * Spanish Windows whatever language the screen was in (ADR-0016 §6, A1).
 */
import { NextResponse, type NextRequest } from "next/server";
import { csvDateTime, csvFileName, csvMoney, renderCsv, type CsvColumn } from "@arkom/core";
import { currentUser } from "../../../../src/auth/supabase";
import { accountForUser } from "../../../../src/db/pg-accounts";
import { documentsInPeriod, type DocumentRow } from "../../../../src/db/dashboard-queries";
import { getT } from "../../../../src/i18n/server";
import { labelFor } from "../../../../src/i18n";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const account = await accountForUser(user.id);
  if (!account) return NextResponse.json({ error: "NO_ACCOUNT" }, { status: 403 });

  const { t } = await getT();
  const params = request.nextUrl.searchParams;
  const { parseRange } = await import("../../../../src/lib/range");
  const period = parseRange(params.get("range") ?? undefined);

  const rows = await documentsInPeriod(account.id, period.days, {
    search: params.get("q") ?? "",
    docType: params.get("type") ?? "",
    limit: 5000,
  });

  const columns: ReadonlyArray<CsvColumn<DocumentRow>> = [
    { header: t("doc.number"), cell: (row) => row.docNumber },
    { header: t("doc.type"), cell: (row) => labelFor(t, "docType", row.docType) },
    { header: t("doc.when"), cell: (row) => csvDateTime(row.completedAt.getTime()) },
    { header: t("doc.base"), cell: (row) => csvMoney(row.totalCents - row.taxCents) },
    { header: t("doc.tax"), cell: (row) => csvMoney(row.taxCents) },
    { header: t("doc.total"), cell: (row) => csvMoney(row.totalCents) },
  ];

  const body = renderCsv({
    columns,
    rows,
    /* the filters travel with the file: a report nobody can tell the period of
       is a report somebody will misread next quarter */
    preamble: [`${t("sales.title")} — ${account.name}`, `${t("range.label")}: ${period.key}`],
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${csvFileName("ventas")}"`,
      "cache-control": "no-store",
    },
  });
}
