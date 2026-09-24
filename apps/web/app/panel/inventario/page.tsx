/**
 * Inventario — the shelf's history.
 *
 * Every movement, newest first. This list is what the stock column on the
 * catalogue is a sum of: stock changes are inserts only, never an UPDATE to a
 * quantity (ADR-0004), so a reversal is another row rather than an edit and the
 * history stays readable.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor } from "../../../src/i18n";
import { recentMovements } from "../../../src/db/catalogue-queries";
import { dateTime, euros } from "../../../src/lib/format";
import { Card, CardBody, CardHead, EmptyState, TD, TH, TR, Table } from "../../../src/ui";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const movements = await recentMovements(account.id, 200);

  return (
    <Card>
      <CardHead title={t("inv.title")} hint={t("inv.hint")} />
      {movements.length === 0 ? (
        <EmptyState title={t("empty.noData")} />
      ) : (
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("doc.when")}</TH>
                <TH>{t("cat.item")}</TH>
                <TH>{t("inv.reason")}</TH>
                <TH right>{t("inv.qty")}</TH>
                <TH right>{t("inv.unitCost")}</TH>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement, index) => (
                <TR key={`${movement.createdAt.getTime()}-${index}`}>
                  <TD>{dateTime(movement.createdAt)}</TD>
                  <TD>{movement.productName}</TD>
                  <TD>{labelFor(t, "mv", movement.movementType)}</TD>
                  <TD right className={movement.qty < 0 ? "text-danger-ink" : "text-ink"}>
                    {movement.qty > 0 ? `+${movement.qty}` : movement.qty}
                  </TD>
                  <TD right>{euros(movement.unitCostCents)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
