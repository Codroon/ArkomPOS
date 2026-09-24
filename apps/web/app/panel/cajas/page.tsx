/**
 * Cajas — is each till alive, and is it up to date.
 *
 * "Último envío" is the honest health figure: a till that has not pushed for an
 * hour is a till whose line is down or whose machine is off, and either is
 * something an owner would rather learn here than from a gap in the takings.
 * It never means the shop has stopped selling — that is the whole point of the
 * design (ADR-0001).
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { shopsForAccount, tillsForAccount } from "../../../src/db/panel-queries";
import { dateTime } from "../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, TD, TH, TR, Table } from "../../../src/ui";

export const dynamic = "force-dynamic";

export default async function TillsPage() {
  const account = await requireAccount();
  const { t } = await getT();

  const [tills, shops] = await Promise.all([
    tillsForAccount(account.id),
    shopsForAccount(account.id),
  ]);

  if (tills.length === 0) {
    return (
      <Card>
        <EmptyState title={t("till.none")} hint={t("till.noneHint")} />
      </Card>
    );
  }

  const rowsByShop = new Map(shops.map((shop) => [shop.name, shop.rows]));

  return (
    <Card>
      <CardHead title={t("till.title")} hint={t("till.hint")} />
      <CardBody className="pt-2">
        <Table>
          <thead>
            <tr>
              <TH>{t("till.name")}</TH>
              <TH>{t("till.shop")}</TH>
              <TH>{t("till.version")}</TH>
              <TH>{t("till.lastPush")}</TH>
              <TH right>{t("till.movements")}</TH>
              <TH>{t("till.state")}</TH>
            </tr>
          </thead>
          <tbody>
            {tills.map((till) => (
              <TR key={till.id}>
                <TD className="font-medium">{till.terminalName}</TD>
                <TD>{till.shop}</TD>
                <TD className="tabular text-muted">{till.appVersion}</TD>
                <TD>{dateTime(till.lastPushAt)}</TD>
                <TD right>{rowsByShop.get(till.shop) ?? 0}</TD>
                <TD>
                  <Chip tone={till.revoked ? "neutral" : "ok"}>
                    {till.revoked ? t("till.revoked") : t("till.linked")}
                  </Chip>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
