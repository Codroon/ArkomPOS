/**
 * Reparaciones — every ticket the workshop holds.
 *
 * The question is "what have we got in, and what is ready to go out". So the
 * three figures at the top say it before the list does, and the list leads with
 * the device rather than the customer: a phone on a bench is identified by what
 * it is, and the name is how you find its owner afterwards.
 *
 * The status column is the one the till DERIVED and stored (ADR-0014 §1). It is
 * displayed, never recomputed: working it out again here would be a second
 * implementation of a rule whose whole point is that there is only one.
 *
 * There is no passcode column, and there never will be. It is stripped before
 * the row leaves the shop (ADR-0020 §3), so the cloud has nothing to show and
 * nothing to leak.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { repairsForAccount } from "../../../src/db/workshop-queries";
import { dateTime, euros } from "../../../src/lib/format";
import {
  Card,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Stat,
  StatGrid,
  type Column,
} from "../../../src/ui";

export const dynamic = "force-dynamic";

/** Which statuses still owe the customer something. */
const OPEN = new Set(["received", "quoted", "waiting_part", "in_repair"]);

const TONE: Record<string, "neutral" | "ok" | "warn" | "bad"> = {
  received: "neutral",
  quoted: "neutral",
  waiting_part: "warn",
  in_repair: "warn",
  ready: "ok",
  collected: "neutral",
  not_repaired: "bad",
};

export default async function RepairsPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const repairs = await repairsForAccount(account.id);

  if (repairs.length === 0) {
    return (
      <Card>
        <EmptyState title={t("rp.empty")} hint={t("rp.emptyHint")} />
      </Card>
    );
  }

  const open = repairs.filter((row) => OPEN.has(row.status));
  const ready = repairs.filter((row) => row.status === "ready");
  const deposits = open.reduce((sum, row) => sum + row.depositCents, 0);

  const columns: Column<(typeof repairs)[number]>[] = [
    { key: "device", header: t("rp.device"), card: "title", render: (r) => r.device },
    {
      key: "customer",
      header: t("rp.customer"),
      card: "sub",
      render: (r) => r.customerName ?? "—",
    },
    {
      key: "status",
      header: t("rp.status"),
      card: "badge",
      render: (r) => (
        <Chip tone={TONE[r.status] ?? "neutral"}>{t(`rps.${r.status}` as "rps.received")}</Chip>
      ),
    },
    {
      key: "imei",
      header: "IMEI",
      card: "meta",
      className: "tabular text-muted",
      render: (r) => r.imei ?? "—",
    },
    {
      key: "fault",
      header: t("rp.fault"),
      card: "meta",
      className: "max-w-[240px] text-muted",
      render: (r) => r.fault ?? "—",
    },
    { key: "when", header: t("doc.when"), card: "meta", render: (r) => dateTime(r.createdAt) },
    { key: "parts", header: t("rp.parts"), align: "right", card: "figure", render: (r) => r.parts },
    {
      key: "quoted",
      header: t("rp.quoted"),
      align: "right",
      card: "figure",
      render: (r) => euros(r.quotedCents),
    },
    {
      key: "deposit",
      header: t("rp.deposit"),
      align: "right",
      card: "figure",
      render: (r) => (r.depositCents > 0 ? euros(r.depositCents) : "—"),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("rp.open")} value={String(open.length)} />
        <Stat label={t("rp.ready")} value={String(ready.length)} />
        <Stat label={t("rp.deposit")} value={euros(deposits)} sub={t("rp.depositHint")} />
        <Stat label={t("rp.all")} value={String(repairs.length)} />
      </StatGrid>

      <Card>
        <CardHead title={t("rp.title")} hint={t("rp.hint")} />
        <DataTable
          rows={repairs}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/panel/reparaciones/${r.id}`}
        />
      </Card>
    </div>
  );
}
