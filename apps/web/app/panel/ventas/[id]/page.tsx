/**
 * One document, the way the paper read.
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
import { dateTime, euros  } from "../../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, TD, TH, TR, Table } from "../../../../src/ui";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  const { t } = await getT();
  const { id } = await params;

  const detail = await documentDetail(account.id, id);
  if (!detail) notFound();

  const { head, lines, tenders } = detail;
  const tendered = tenders.reduce((sum, tender) => sum + tender.amountCents, 0);

  return (
    <div className="space-y-4">
      <Link
        href="/panel/ventas"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
        {t("doc.back")}
      </Link>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <h1 className="tabular text-[20px] leading-none font-semibold">
              {head.docNumber ?? "—"}
            </h1>
            <p className="mt-1.5 text-[12px] text-muted">
              {labelFor(t, "docType", head.docType)} · {head.shopName} · {dateTime(head.completedAt)}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {t("doc.total")}
            </div>
            <div className="tabular text-[24px] leading-none font-semibold">{euros(head.totalCents)}</div>
          </div>
        </div>

        <CardBody className="pt-3">
          <Table>
            <thead>
              <tr>
                <TH className="w-8">#</TH>
                <TH>{t("doc.concept")}</TH>
                <TH right>{t("doc.qty")}</TH>
                <TH right>{t("doc.price")}</TH>
                <TH>{t("doc.regime")}</TH>
                <TH right>{t("doc.base")}</TH>
                <TH right>{t("doc.tax")}</TH>
                <TH right>{t("doc.total")}</TH>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <TR key={line.lineNo}>
                  <TD className="text-subtle">{line.lineNo}</TD>
                  <TD>
                    {line.description}
                    {line.priceOverridden ? (
                      <span className="ml-2 align-middle">
                        <Chip tone="warn">{t("doc.overridden")}</Chip>
                      </span>
                    ) : null}
                  </TD>
                  <TD right>{line.qty}</TD>
                  <TD right>{euros(line.unitPriceCents)}</TD>
                  <TD>{labelFor(t, "regime", line.taxRegime)}</TD>
                  <TD right>{euros(line.baseCents)}</TD>
                  <TD right>{euros(line.taxCents)}</TD>
                  <TD right>{euros(line.totalCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>

          <div className="mt-4 flex justify-end">
            <dl className="w-full max-w-[280px] text-[13px]">
              <div className="flex justify-between py-1">
                <dt className="text-muted">{t("doc.taxBase")}</dt>
                <dd className="tabular">{euros(head.subtotalCents)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-muted">{t("doc.tax")}</dt>
                <dd className="tabular">{euros(head.taxCents)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-line pt-2">
                <dt className="font-semibold">{t("doc.total")}</dt>
                <dd className="tabular text-[16px] font-semibold">{euros(head.totalCents)}</dd>
              </div>
            </dl>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHead title={t("doc.payment")} hint={t("doc.paymentHint")} />
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("doc.type")}</TH>
                <TH right>{t("doc.total")}</TH>
              </tr>
            </thead>
            <tbody>
              {tenders.map((tender, index) => (
                <TR key={`${tender.method}-${index}`}>
                  <TD>{labelFor(t, "tender", tender.method)}</TD>
                  <TD right>{euros(tender.amountCents)}</TD>
                </TR>
              ))}
              {tendered !== head.totalCents && tenders.length > 0 ? (
                <TR>
                  <TD className="text-muted">{t("doc.change")}</TD>
                  <TD right className="text-muted">{euros(tendered - head.totalCents)}</TD>
                </TR>
              ) : null}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
