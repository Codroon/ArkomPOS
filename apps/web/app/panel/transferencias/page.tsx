/**
 * Transferencias — the Western Union shadow log (ADR-0018).
 *
 * The one thing this screen must not do is add the principal to the shop's
 * takings. It is a customer's money passing through a counter; the shop's
 * revenue is the FEE. So the two are totalled separately, labelled as what
 * they are, and a cancelled transfer counts as neither — cancelling reverses in
 * full.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { transfersForAccount } from "../../../src/db/workshop-queries";
import { dateTime, euros } from "../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, Stat, TD, TH, TR, Table } from "../../../src/ui";

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

  const live = transfers.filter((row) => !row.cancelledAt && row.status !== "cancelled");
  const principal = live.reduce((sum, row) => sum + row.principalCents, 0);
  const fees = live.reduce((sum, row) => sum + row.feeCents, 0);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap divide-line sm:divide-x">
        {/* deliberately not one combined figure */}
        <Stat label={t("tf.principal")} value={euros(principal)} sub={t("tf.hint")} />
        <Stat label={t("tf.fee")} value={euros(fees)} />
      </Card>

      <Card>
        <CardHead title={t("tf.title")} hint={t("tf.hint")} />
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("doc.when")}</TH>
                <TH>{t("tf.kind")}</TH>
                <TH>{t("tf.mtcn")}</TH>
                <TH>{t("tf.sender")}</TH>
                <TH>{t("tf.receiver")}</TH>
                <TH>{t("tf.country")}</TH>
                <TH right>{t("tf.principal")}</TH>
                <TH right>{t("tf.fee")}</TH>
                <TH>{t("tf.status")}</TH>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => {
                const cancelled = Boolean(transfer.cancelledAt) || transfer.status === "cancelled";
                return (
                  <TR key={transfer.id}>
                    <TD>{dateTime(transfer.createdAt)}</TD>
                    <TD>{t(`tfk.${transfer.kind}` as "tfk.send")}</TD>
                    <TD className="tabular text-muted">{transfer.mtcn ?? "—"}</TD>
                    <TD>{transfer.senderName ?? "—"}</TD>
                    <TD>{transfer.receiverName ?? "—"}</TD>
                    <TD>{transfer.countryCode ?? "—"}</TD>
                    <TD right className={cancelled ? "text-subtle line-through" : undefined}>
                      {euros(transfer.principalCents)}
                    </TD>
                    <TD right className={cancelled ? "text-subtle line-through" : undefined}>
                      {euros(transfer.feeCents)}
                    </TD>
                    <TD>
                      <Chip tone={cancelled ? "bad" : "ok"}>
                        {cancelled ? t("tfs.cancelled") : t("tfs.paid")}
                      </Chip>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
