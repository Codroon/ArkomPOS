/**
 * One document, the way the paper read.
 *
 * Laid out like a receipt on purpose: number and total at the top where a
 * customer's eye goes, the lines in the middle, the totals block bottom-right
 * where every till receipt in Spain puts it. On a phone each line becomes a card
 * with base/IVA/total in the strip, so the tax breakdown is readable without
 * turning the handset sideways.
 *
 * The figures are the ones snapshotted onto the lines when they were written
 * (ADR-0007 A1), not a recomputation from a rate — this is a copy of a fiscal
 * record, and a second opinion about a number already handed to a customer is
 * not something a dashboard should offer.
 *
 * `notFound()` covers both "no such document" and "not this account's
 * document", deliberately: the query is scoped by account, so a valid id
 * belonging to another shop returns nothing and a stranger learns nothing from
 * the difference.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAccount } from "../../../../src/auth/session";
import { getT } from "../../../../src/i18n/server";
import { labelFor } from "../../../../src/i18n";
import { documentDetail } from "../../../../src/db/document-queries";
import { dateTime, euros } from "../../../../src/lib/format";
import {
  Card,
  CardBody,
  CardHead,
  Chip,
  DataTable,
  Figure,
  type Column,
} from "../../../../src/ui";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  const { t } = await getT();
  const { id } = await params;

  const detail = await documentDetail(account.id, id);
  if (!detail) notFound();

  const { head, lines, tenders } = detail;
  const tendered = tenders.reduce((sum, tender) => sum + tender.amountCents, 0);

  const lineColumns: Column<(typeof lines)[number]>[] = [
    { key: "no", header: "#", card: "none", className: "w-8 text-subtle", render: (l) => l.lineNo },
    {
      key: "what",
      header: t("doc.concept"),
      card: "title",
      render: (l) => (
        <>
          {l.description}
          {l.priceOverridden ? (
            <span className="ml-2 align-middle">
              <Chip tone="warn">{t("doc.overridden")}</Chip>
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "qty",
      header: t("doc.qty"),
      align: "right",
      card: "meta",
      render: (l) => l.qty,
    },
    {
      key: "unit",
      header: t("doc.price"),
      align: "right",
      card: "meta",
      render: (l) => euros(l.unitPriceCents),
    },
    {
      key: "regime",
      header: t("doc.regime"),
      card: "meta",
      render: (l) => labelFor(t, "regime", l.taxRegime),
    },
    {
      key: "base",
      header: t("doc.base"),
      align: "right",
      card: "figure",
      render: (l) => euros(l.baseCents),
    },
    {
      key: "tax",
      header: t("doc.tax"),
      align: "right",
      card: "figure",
      render: (l) => euros(l.taxCents),
    },
    {
      key: "total",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (l) => euros(l.totalCents),
    },
  ];

  const tenderColumns: Column<(typeof tenders)[number]>[] = [
    {
      key: "method",
      header: t("doc.type"),
      card: "title",
      render: (x) => labelFor(t, "tender", x.method),
    },
    {
      key: "amount",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      render: (x) => euros(x.amountCents),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/panel/ventas"
        className="inline-flex h-9 items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
        {t("doc.back")}
      </Link>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0">
            <Figure size="lg" className="tabular">
              {head.docNumber ?? "—"}
            </Figure>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              {labelFor(t, "docType", head.docType)} · {head.shopName}
              <br className="sm:hidden" />
              <span className="hidden sm:inline"> · </span>
              {dateTime(head.completedAt)}
            </p>
          </div>
          <div className="shrink-0 sm:text-right">
            <div className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
              {t("doc.total")}
            </div>
            <Figure size="lg" className="mt-1">
              {euros(head.totalCents)}
            </Figure>
          </div>
        </div>

        <DataTable rows={lines} columns={lineColumns} rowKey={(l) => String(l.lineNo)} />

        <CardBody className="flex justify-end border-t border-line">
          <dl className="w-full text-[13px] sm:max-w-[300px]">
            <div className="flex items-baseline justify-between py-1">
              <dt className="text-muted">{t("doc.taxBase")}</dt>
              <dd className="tabular">{euros(head.subtotalCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between py-1">
              <dt className="text-muted">{t("doc.tax")}</dt>
              <dd className="tabular">{euros(head.taxCents)}</dd>
            </div>
            <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-semibold">{t("doc.total")}</dt>
              <dd>
                <Figure size="md">{euros(head.totalCents)}</Figure>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHead title={t("doc.payment")} hint={t("doc.paymentHint")} />
        <DataTable
          rows={tenders}
          columns={tenderColumns}
          rowKey={(x, i) => `${x.method}-${i}`}
          footer={
            tendered !== head.totalCents && tenders.length > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[12px] text-muted">{t("doc.change")}</span>
                <span className="tabular text-[13px] text-muted">
                  {euros(tendered - head.totalCents)}
                </span>
              </div>
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}
