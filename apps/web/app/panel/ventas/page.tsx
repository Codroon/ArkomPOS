/**
 * Transacciones — every completed document in the period.
 *
 * The question is "what has been sold, and can I find this one receipt". So the
 * list is ordered newest first, the number is the thing you scan for, and the
 * total sits on a shared right edge all the way down. On a phone each document
 * is a card with its number and time on top and base/IVA/total in a strip — the
 * figures used to be off-screen behind a sideways scroll, reachable only by
 * swiping inside a row.
 *
 * The filters are a plain GET form, so the state lives in the URL: a link
 * somebody sends themselves opens on the same rows, the back button does what
 * it should, and the export below re-runs the same query rather than being
 * handed a list that might differ from the one on screen (ADR-0016 §4).
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor, plural } from "../../../src/i18n";
import { parseRange, rangeParams } from "../../../src/lib/range";
import { documentsInPeriod } from "../../../src/db/dashboard-queries";
import { dateTime, euros } from "../../../src/lib/format";
import {
  Card,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Figure,
  ghostClass,
  inputClass,
  selectClass,
  type Column,
} from "../../../src/ui";
import { Filters } from "../../../src/ui/filters";

export const dynamic = "force-dynamic";

/**
 * The four a till writes to this list.
 *
 * `used_purchase` used to be here and is not a document type any till has ever
 * produced — the value is `purchase` (schema.ts, DOC_TYPES). So the filter had
 * an option that matched nothing and the twenty rows it should have matched
 * were labelled with their raw code. `invoice`, `credit_note` and `shift` are
 * real types this screen never sees: the first two are not built (CLAUDE.md)
 * and a Z is not a transaction.
 */
const TYPES = ["ticket", "refund", "repair", "purchase"];

const TONE: Record<string, "neutral" | "ok" | "warn" | "bad" | "info"> = {
  ticket: "ok",
  refund: "bad",
  repair: "info",
  purchase: "warn",
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const params = await searchParams;
  const period = parseRange(params.range, params.from, params.to);

  const search = typeof params.q === "string" ? params.q : "";
  const docType = typeof params.type === "string" ? params.type : "";

  const documents = await documentsInPeriod(account.id, period, { search, docType });

  const exportQuery = new URLSearchParams(rangeParams(period));
  if (search) exportQuery.set("q", search);
  if (docType) exportQuery.set("type", docType);

  const total = documents.reduce((sum, doc) => sum + doc.totalCents, 0);

  const columns: Column<(typeof documents)[number]>[] = [
    {
      key: "number",
      header: t("doc.number"),
      card: "title",
      className: "tabular",
      render: (d) => d.docNumber,
    },
    {
      key: "type",
      header: t("doc.type"),
      card: "badge",
      render: (d) => <Chip tone={TONE[d.docType] ?? "neutral"}>{labelFor(t, "docType", d.docType)}</Chip>,
    },
    { key: "when", header: t("doc.when"), card: "sub", render: (d) => dateTime(d.completedAt) },
    {
      key: "base",
      header: t("doc.base"),
      align: "right",
      card: "figure",
      render: (d) => euros(d.totalCents - d.taxCents),
    },
    {
      key: "tax",
      header: t("doc.tax"),
      align: "right",
      card: "figure",
      render: (d) => euros(d.taxCents),
    },
    {
      key: "total",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (d) => euros(d.totalCents),
    },
  ];

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

      <Filters
        label={t("filter.label")}
        apply={t("filter.apply")}
        close={t("app.close")}
        active={(search ? 1 : 0) + (docType ? 1 : 0)}
        summary={plural(t, "sales.count", documents.length)}
      >
        {/* the filter form is a GET: without these the window resets to the
            default the moment somebody searches inside a custom range */}
        {Object.entries(rangeParams(period)).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Field label={t("sales.search")} className="md:w-[260px]">
          <input
            className={inputClass}
            type="search"
            name="q"
            defaultValue={search}
            placeholder={t("sales.search")}
          />
        </Field>
        <Field label={t("doc.type")} className="md:w-[190px]">
          <select className={selectClass} name="type" defaultValue={docType}>
            <option value="">{t("sales.allTypes")}</option>
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {labelFor(t, "docType", type)}
              </option>
            ))}
          </select>
        </Field>
        <button className={`${ghostClass} hidden md:inline-flex`} type="submit">
          {t("filter.apply")}
        </button>
      </Filters>

      <DataTable
        rows={documents}
        columns={columns}
        rowKey={(d) => d.id}
        rowHref={(d) => `/panel/ventas/${d.id}`}
        empty={<EmptyState title={t("sales.empty")} />}
        footer={
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-[12px] text-muted">{plural(t, "sales.count", documents.length)}</span>
            <Figure size="md">{euros(total)}</Figure>
          </div>
        }
      />
    </Card>
  );
}
