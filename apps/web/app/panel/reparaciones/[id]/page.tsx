/**
 * One repair ticket: what came in, what was done to it, what it was quoted at.
 *
 * The three facts a shop rings up about — deposit, promised date, quote — are
 * figures at the top rather than rows in a definition list, because they are
 * what somebody is being asked on the phone while they look at this screen.
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
import {
  Card,
  CardBody,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Stat,
  StatGrid,
  type Column,
} from "../../../../src/ui";

export const dynamic = "force-dynamic";

export default async function RepairPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  const { t } = await getT();
  const { id } = await params;

  const detail = await repairDetail(account.id, id);
  if (!detail) notFound();

  const { ticket, lines } = detail;
  const quoted = lines.reduce((sum, line) => sum + line.chargeCents, 0);

  const columns: Column<(typeof lines)[number]>[] = [
    {
      key: "what",
      header: t("doc.concept"),
      card: "title",
      render: (l) => l.description ?? "—",
    },
    {
      key: "kind",
      header: t("rp.kind"),
      card: "badge",
      render: (l) => <Chip>{t(`rpk.${l.kind}` as "rpk.labor")}</Chip>,
    },
    {
      key: "supplier",
      header: t("rp.supplier"),
      card: "meta",
      className: "text-muted",
      render: (l) => l.supplier ?? "—",
    },
    {
      key: "ordered",
      header: t("rp.ordered"),
      card: "meta",
      render: (l) => (l.orderedAt ? dateTime(l.orderedAt) : "—"),
    },
    {
      key: "received",
      header: t("rp.received"),
      card: "meta",
      render: (l) => (l.receivedAt ? dateTime(l.receivedAt) : "—"),
    },
    { key: "qty", header: t("doc.qty"), align: "right", card: "figure", render: (l) => l.qty },
    {
      key: "charge",
      header: t("doc.total"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (l) => euros(l.chargeCents),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/panel/reparaciones"
        className="inline-flex h-9 items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden />
        {t("rp.back")}
      </Link>

      <Card>
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h1 className="text-[18px] leading-tight font-semibold text-ink sm:text-[20px]">
              {ticket.device}
            </h1>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              {ticket.customerName ?? "—"}
              {ticket.imei ? <span className="tabular"> · {ticket.imei}</span> : null}
              {" · "}
              {dateTime(ticket.createdAt)}
            </p>
          </div>
          <Chip tone={ticket.status === "ready" ? "ok" : "neutral"} className="self-start">
            {t(`rps.${ticket.status}` as "rps.received")}
          </Chip>
        </div>

        <CardBody>
          <div className="text-[11px] font-semibold tracking-[0.07em] text-muted uppercase">
            {t("rp.fault")}
          </div>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{ticket.fault ?? "—"}</p>
        </CardBody>

        <div className="border-t border-line px-4 py-2.5 text-[11px] text-subtle sm:px-5">
          {t("rp.noPasscode")}
        </div>
      </Card>

      <StatGrid>
        <Stat label={t("rp.quoted")} value={euros(quoted)} />
        <Stat label={t("rp.deposit")} value={euros(ticket.depositCents)} />
        <Stat label={t("rp.promised")} value={ticket.promisedDate ?? "—"} />
        <Stat label={t("rp.parts")} value={String(lines.length)} />
      </StatGrid>

      <Card>
        <CardHead title={t("rp.lines")} />
        <DataTable
          rows={lines}
          columns={columns}
          rowKey={(l, i) => `${l.description ?? "line"}-${i}`}
          empty={<EmptyState title={t("empty.noData")} />}
        />
      </Card>
    </div>
  );
}
