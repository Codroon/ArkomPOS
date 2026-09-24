/**
 * Dispositivos usados — what the shop bought second-hand and where each one is.
 *
 * Two figures that must not be confused, so they sit in different columns: what
 * was PAID to the seller, and what the unit is now priced at. Margin on a sold
 * used device is deliberately not computed here — CLAUDE.md lists it as not
 * built, and a plausible-looking number would be worse than an absent one.
 *
 * The seller's name is here and their ID number is not. Both arrive in the
 * stream (ADR-0020 §3 syncs the rows), but a list on a screen is not where an
 * identity document belongs; the police register is a separate, later job.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { usedForAccount } from "../../../src/db/workshop-queries";
import { dateTime, euros } from "../../../src/lib/format";
import { Card, CardBody, CardHead, Chip, EmptyState, TD, TH, TR, Table } from "../../../src/ui";

export const dynamic = "force-dynamic";

const TONE: Record<string, "neutral" | "ok" | "warn" | "bad"> = {
  held: "warn",
  needs_review: "warn",
  in_stock: "ok",
  reserved: "neutral",
  sold: "neutral",
};

export default async function UsedPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const devices = await usedForAccount(account.id);

  if (devices.length === 0) {
    return (
      <Card>
        <EmptyState title={t("us.empty")} hint={t("us.emptyHint")} />
      </Card>
    );
  }

  /* what is tied up: bought and not yet sold, at what it cost to get there */
  const holding = devices.filter((device) => device.unitStatus !== "sold");
  const tiedUp = holding.reduce(
    (sum, device) => sum + device.buyPriceCents + device.refurbCostCents,
    0,
  );

  return (
    <Card>
      <CardHead
        title={t("us.title")}
        hint={t("us.hint")}
        action={
          <span className="text-[12px] text-muted">
            {t("us.holding", { n: holding.length, value: euros(tiedUp) })}
          </span>
        }
      />
      <CardBody className="pt-2">
        <Table>
          <thead>
            <tr>
              <TH>{t("us.device")}</TH>
              <TH>{t("us.grade")}</TH>
              <TH right>{t("us.battery")}</TH>
              <TH>{t("us.seller")}</TH>
              <TH>{t("us.bought")}</TH>
              <TH right>{t("us.paid")}</TH>
              <TH right>{t("us.refurb")}</TH>
              <TH right>{t("us.price")}</TH>
              <TH>{t("us.state")}</TH>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <TR key={device.id}>
                <TD>
                  {device.device}
                  {device.imei ? (
                    <div className="tabular text-[11px] text-muted">{device.imei}</div>
                  ) : null}
                </TD>
                <TD>{device.grade ?? "—"}</TD>
                <TD right>{device.batteryPct === null ? "—" : `${device.batteryPct}%`}</TD>
                <TD>{device.sellerName ?? "—"}</TD>
                <TD>{dateTime(device.purchasedAt)}</TD>
                <TD right>{euros(device.buyPriceCents)}</TD>
                <TD right>
                  {device.refurbCostCents > 0 ? euros(device.refurbCostCents) : "—"}
                </TD>
                <TD right>
                  {device.salePriceCents === null ? "—" : euros(device.salePriceCents)}
                </TD>
                <TD>
                  {device.needsReview ? (
                    <Chip tone="warn">{t("us.review")}</Chip>
                  ) : device.unitStatus ? (
                    <Chip tone={TONE[device.unitStatus] ?? "neutral"}>
                      {t(`uss.${device.unitStatus}` as "uss.in_stock")}
                    </Chip>
                  ) : (
                    "—"
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
