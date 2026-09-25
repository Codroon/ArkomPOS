/**
 * Transferencias — the Western Union shadow log (ADR-0018).
 *
 * The one thing this screen must not do is add the principal to the shop's
 * takings. It is a customer's money passing through a counter; the shop's
 * revenue is the FEE. So the two are totalled separately, labelled as what
 * they are, never placed where an eye could add them, and a cancelled transfer
 * counts as neither — cancelling reverses in full.
 *
 * On a card the sender and receiver lead, because that is how somebody looks a
 * transfer up when a customer comes back about it; the MTCN is there to confirm
 * they have the right one.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { transfersForAccount } from "../../../src/db/workshop-queries";
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

export default async function TransfersPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const transfers = await transfersForAccount(account.id);

  if (transfers.length === 0) {
    return (
      <Card>
        <EmptyState title={t("tf.empty")} hint={t("tf.emptyHint")} />
      </Card>
    );
  }

  const cancelledRow = (row: (typeof transfers)[number]) =>
    Boolean(row.cancelledAt) || row.status === "cancelled";

  const live = transfers.filter((row) => !cancelledRow(row));
  const principal = live.reduce((sum, row) => sum + row.principalCents, 0);
  const fees = live.reduce((sum, row) => sum + row.feeCents, 0);

  const columns: Column<(typeof transfers)[number]>[] = [
    {
      key: "who",
      header: t("tf.sender"),
      card: "title",
      render: (x) => `${x.senderName ?? "—"} → ${x.receiverName ?? "—"}`,
    },
    {
      key: "when",
      header: t("doc.when"),
      card: "sub",
      render: (x) => dateTime(x.createdAt),
    },
    {
      key: "status",
      header: t("tf.status"),
      card: "badge",
      render: (x) => (
        <Chip tone={cancelledRow(x) ? "bad" : "ok"}>
          {cancelledRow(x) ? t("tfs.cancelled") : t("tfs.paid")}
        </Chip>
      ),
    },
    { key: "kind", header: t("tf.kind"), card: "meta", render: (x) => t(`tfk.${x.kind}` as "tfk.send") },
    {
      key: "mtcn",
      header: t("tf.mtcn"),
      card: "meta",
      className: "tabular text-muted",
      render: (x) => x.mtcn ?? "—",
    },
    { key: "country", header: t("tf.country"), card: "meta", render: (x) => x.countryCode ?? "—" },
    {
      key: "principal",
      header: t("tf.principal"),
      align: "right",
      card: "figure",
      render: (x) => (
        <span className={cancelledRow(x) ? "text-subtle line-through" : undefined}>
          {euros(x.principalCents)}
        </span>
      ),
    },
    {
      key: "fee",
      header: t("tf.fee"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (x) => (
        <span className={cancelledRow(x) ? "text-subtle line-through" : undefined}>
          {euros(x.feeCents)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* deliberately not one combined figure, and deliberately not adjacent
          columns of the same weight: one is the shop's, the other never is */}
      <StatGrid>
        <Stat label={t("tf.fee")} value={euros(fees)} sub={t("tf.feeHint")} />
        <Stat label={t("tf.principal")} value={euros(principal)} sub={t("tf.principalHint")} />
        <Stat label={t("tf.live")} value={String(live.length)} />
        <Stat label={t("tf.all")} value={String(transfers.length)} />
      </StatGrid>

      <Card>
        <CardHead title={t("tf.title")} hint={t("tf.hint")} />
        <DataTable rows={transfers} columns={columns} rowKey={(x) => x.id} />
      </Card>
    </div>
  );
}
