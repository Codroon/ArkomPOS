/**
 * Ventas — every completed document in the period.
 *
 * The filters are a plain GET form, so the state lives in the URL: a link
 * somebody sends themselves opens on the same rows, the back button does what
 * it should, and the export below re-runs the same query rather than being
 * handed a list that might differ from the one on screen (ADR-0016 §4).
 */
import Link from "next/link";
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor } from "../../../src/i18n";
import { parseRange } from "../../../src/lib/range";
import { documentsInPeriod } from "../../../src/db/dashboard-queries";
import { dateTime, euros  } from "../../../src/lib/format";
import { Card, CardHead, CardBody, EmptyState, TD, TH, TR, Table, ghostClass, inputClass } from "../../../src/ui";

export const dynamic = "force-dynamic";

const TYPES = ["ticket", "refund", "repair", "used_purchase"];

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const params = await searchParams;
  const period = parseRange(params.range);

  const search = typeof params.q === "string" ? params.q : "";
  const docType = typeof params.type === "string" ? params.type : "";

  const documents = await documentsInPeriod(account.id, period.days, { search, docType });

  const exportQuery = new URLSearchParams({ range: period.key });
  if (search) exportQuery.set("q", search);
  if (docType) exportQuery.set("type", docType);

  return (
    <Card>
      <CardHead
        title={t("sales.title")}
        hint={t("sales.hint")}
        action={
          <a className={ghostClass} href={`/panel/ventas/export?${exportQuery.toString()}`}>
            {t("sales.export")}
          </a>
        }
      />

      <CardBody className="border-b border-line">
        {/* GET, so the filters end up in the address bar where they belong */}
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="range" value={period.key} />
          <div className="min-w-[180px] flex-1">
            <input
              className={inputClass}
              type="search"
              name="q"
              defaultValue={search}
              placeholder={t("sales.search")}
              aria-label={t("sales.search")}
            />
          </div>
          <select className={`${inputClass} w-auto`} name="type" defaultValue={docType} aria-label={t("doc.type")}>
            <option value="">{t("sales.allTypes")}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {labelFor(t, "docType", type)}
              </option>
            ))}
          </select>
          <button className={ghostClass} type="submit">
            {t("sales.search")}
          </button>
        </form>
      </CardBody>

      {documents.length === 0 ? (
        <EmptyState title={t("sales.empty")} />
      ) : (
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("doc.number")}</TH>
                <TH>{t("doc.type")}</TH>
                <TH>{t("doc.when")}</TH>
                <TH right>{t("doc.base")}</TH>
                <TH right>{t("doc.tax")}</TH>
                <TH right>{t("doc.total")}</TH>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <TR key={doc.id}>
                  <TD className="tabular">
                    <Link className="underline underline-offset-2" href={`/panel/ventas/${doc.id}`}>
                      {doc.docNumber}
                    </Link>
                  </TD>
                  <TD>{labelFor(t, "docType", doc.docType)}</TD>
                  <TD>{dateTime(doc.completedAt)}</TD>
                  <TD right>{euros(doc.totalCents - doc.taxCents)}</TD>
                  <TD right>{euros(doc.taxCents)}</TD>
                  <TD right className="font-semibold">{euros(doc.totalCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
