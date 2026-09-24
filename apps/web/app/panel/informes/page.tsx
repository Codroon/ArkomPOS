/**
 * Informes — the reports the till has at nav 10, for somebody who is not in the
 * shop.
 *
 * Four questions an owner and their gestor actually ask: what did we charge in
 * VAT and under which regime, what is the stock worth, what is not moving, and
 * how much do we owe in vouchers.
 *
 * The tax table is the one to be careful about. Its figures are the ones
 * snapshotted onto each line when it was written (ADR-0007 A1); nothing here
 * multiplies a base by a rate. A report that re-derives tax is a report that
 * can disagree with the receipt in a customer's hand.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { parseRange } from "../../../src/lib/range";
import { deadStock, outstandingCredit, taxByRegime, valuation } from "../../../src/db/report-queries";
import { dateTime, euros } from "../../../src/lib/format";
import { Card, CardBody, CardHead, EmptyState, TD, TH, TR, Table } from "../../../src/ui";

export const dynamic = "force-dynamic";

const REGIMES: Record<string, string> = {
  IVA21: "IVA 21%",
  IVA10: "IVA 10%",
  IVA4: "IVA 4%",
  REBU: "REBU",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const period = parseRange((await searchParams).range);

  const [tax, stock, dead, vouchers] = await Promise.all([
    taxByRegime(account.id, period.days),
    valuation(account.id),
    deadStock(account.id, 90),
    outstandingCredit(account.id),
  ]);

  const atCost = stock.reduce((sum, row) => sum + row.atCostCents, 0);
  const atRetail = stock.reduce((sum, row) => sum + row.atRetailCents, 0);
  const owed = vouchers.reduce((sum, row) => sum + row.remainingCents, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHead title={t("inf.tax")} hint={t("inf.taxHint")} />
        {tax.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("inf.regime")}</TH>
                  <TH right>{t("inf.lines")}</TH>
                  <TH right>{t("doc.base")}</TH>
                  <TH right>{t("doc.tax")}</TH>
                  <TH right>{t("doc.total")}</TH>
                </tr>
              </thead>
              <tbody>
                {tax.map((row) => (
                  <TR key={row.regime}>
                    <TD>{REGIMES[row.regime] ?? row.regime}</TD>
                    <TD right>{row.lines}</TD>
                    <TD right>{euros(row.baseCents)}</TD>
                    <TD right>{euros(row.taxCents)}</TD>
                    <TD right className="font-semibold">{euros(row.totalCents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHead
          title={t("inf.valuation")}
          hint={t("inf.valuationHint")}
          action={
            <span className="tabular text-[12px] text-muted">
              {euros(atCost)} · {euros(atRetail)}
            </span>
          }
        />
        {stock.length === 0 ? (
          <EmptyState title={t("empty.noData")} />
        ) : (
          <CardBody className="pt-2">
            <Table>
              <thead>
                <tr>
                  <TH>{t("cat.group")}</TH>
                  <TH right>{t("inf.items")}</TH>
                  <TH right>{t("inf.units")}</TH>
                  <TH right>{t("inf.atCost")}</TH>
                  <TH right>{t("inf.atRetail")}</TH>
                </tr>
              </thead>
              <tbody>
                {stock.map((row) => (
                  <TR key={row.group}>
                    <TD>{row.group}</TD>
                    <TD right>{row.items}</TD>
                    <TD right>{row.units}</TD>
                    <TD right>{euros(row.atCostCents)}</TD>
                    <TD right>{euros(row.atRetailCents)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </CardBody>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title={t("inf.dead")} hint={t("inf.deadHint")} />
          {dead.length === 0 ? (
            <EmptyState title={t("empty.noData")} />
          ) : (
            <CardBody className="pt-2">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("cat.item")}</TH>
                    <TH right>{t("cat.stock")}</TH>
                    <TH right>{t("inf.atCost")}</TH>
                    <TH>{t("inf.lastSold")}</TH>
                  </tr>
                </thead>
                <tbody>
                  {dead.map((row) => (
                    <TR key={row.name}>
                      <TD>{row.name}</TD>
                      <TD right>{row.onHand}</TD>
                      <TD right>{euros(row.atCostCents)}</TD>
                      <TD className={row.lastSoldAt ? undefined : "text-muted"}>
                        {row.lastSoldAt ? dateTime(row.lastSoldAt) : t("inf.never")}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHead
            title={t("inf.credit")}
            hint={t("inf.creditHint")}
            action={<span className="tabular text-[12px] text-muted">{euros(owed)}</span>}
          />
          {vouchers.length === 0 ? (
            <EmptyState title={t("empty.noData")} />
          ) : (
            <CardBody className="pt-2">
              <Table>
                <thead>
                  <tr>
                    <TH>{t("doc.when")}</TH>
                    <TH right>{t("inf.issued")}</TH>
                    <TH right>{t("inf.remaining")}</TH>
                  </tr>
                </thead>
                <tbody>
                  {vouchers.map((row) => (
                    <TR key={row.id}>
                      <TD>{dateTime(row.createdAt)}</TD>
                      <TD right>{euros(row.amountCents)}</TD>
                      <TD right className="font-semibold">{euros(row.remainingCents)}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          )}
        </Card>
      </div>
    </div>
  );
}
