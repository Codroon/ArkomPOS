/**
 * One repair ticket: what came in, what was done to it, what it was quoted at.
 *
 * The note about the passcode is on the screen on purpose. A shop owner looking
 * for it should be told it is absent BY DESIGN rather than left wondering
 * whether something failed to sync (ADR-0020 §3).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAccount } from "../../../../src/auth/session";
import { getT } from "../../../../src/i18n/server";
import { repairDetail } from "../../../../src/db/workshop-queries";
import { dateTime, euros } from "../../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, TD, TH, TR, Table } from "../../../../src/ui";

export const dynamic = "force-dynamic";

export default async function RepairPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  const { t } = await getT();
  const { id } = await params;

  const detail = await repairDetail(account.id, id);
  if (!detail) notFound();

  const { ticket, lines } = detail;
  const quoted = lines.reduce((sum, line) => sum + line.chargeCents, 0);

  return (
    <div className="space-y-4">
      <Link
        href="/panel/reparaciones"
        className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
        {t("rp.back")}
      </Link>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div>
            <h1 className="text-[19px] leading-tight font-semibold">{ticket.device}</h1>
            <p className="mt-1.5 text-[12px] text-muted">
              {ticket.customerName ?? "—"}
              {ticket.imei ? <span className="tabular"> · {ticket.imei}</span> : null}
              {" · "}
              {dateTime(ticket.createdAt)}
            </p>
          </div>
          <Chip tone={ticket.status === "ready" ? "ok" : "neutral"}>
            {t(`rps.${ticket.status}` as "rps.received")}
          </Chip>
        </div>

        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              {t("rp.fault")}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed">{ticket.fault ?? "—"}</p>
          </div>
          <dl className="text-[13px]">
            <div className="flex justify-between py-1">
              <dt className="text-muted">{t("rp.deposit")}</dt>
              <dd className="tabular">{euros(ticket.depositCents)}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted">{t("rp.promised")}</dt>
              <dd>{ticket.promisedDate ?? "—"}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted">{t("rp.quoted")}</dt>
              <dd className="tabular font-semibold">{euros(quoted)}</dd>
            </div>
          </dl>
        </CardBody>

        <div className="border-t border-line px-4 py-2.5 text-[11px] text-subtle sm:px-5">
          {t("rp.noPasscode")}
        </div>
      </Card>

      <Card>
        <CardHead title={t("rp.lines")} />
        {lines.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("rp.kind")}</TH>
                  <TH>{t("doc.concept")}</TH>
                  <TH>{t("rp.supplier")}</TH>
                  <TH>{t("rp.ordered")}</TH>
                  <TH>{t("rp.received")}</TH>
                  <TH right>{t("doc.qty")}</TH>
                  <TH right>{t("doc.total")}</TH>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <TR key={`${line.description}-${index}`}>
                    <TD>{t(`rpk.${line.kind}` as "rpk.labor")}</TD>
                    <TD>{line.description ?? "—"}</TD>
                    <TD className="text-muted">{line.supplier ?? "—"}</TD>
                    <TD>{line.orderedAt ? dateTime(line.orderedAt) : "—"}</TD>
                    <TD>{line.receivedAt ? dateTime(line.receivedAt) : "—"}</TD>
                    <TD right>{line.qty}</TD>
                    <TD right>{euros(line.chargeCents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        )}
      </Card>
    </div>
  );
}
