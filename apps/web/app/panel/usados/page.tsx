/**
 * Dispositivos usados — what the shop bought second-hand and where each one is.
 *
 * The question is "how much is sitting on that shelf, and how long has it been
 * sitting". So the money tied up leads, and the list puts the device first with
 * the two figures that must not be confused in their own columns: what was PAID
 * to the seller, and what the unit is now priced at. Margin on a sold used
 * device is deliberately not computed here — CLAUDE.md lists it as not built,
 * and a plausible-looking number would be worse than an absent one.
 *
 * The seller's name is here and their ID number is not. Both arrive in the
 * stream (ADR-0020 §3 syncs the rows), but a list on a screen is not where an
 * identity document belongs; the police register is a separate, later job.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { usedForAccount } from "../../../src/db/workshop-queries";
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
  const needsReview = devices.filter((device) => device.needsReview).length;

  const columns: Column<(typeof devices)[number]>[] = [
    { key: "device", header: t("us.device"), card: "title", render: (d) => d.device },
    {
      key: "seller",
      header: t("us.seller"),
      card: "sub",
      render: (d) => d.sellerName ?? "—",
    },
    {
      key: "state",
      header: t("us.state"),
      card: "badge",
      render: (d) =>
        d.needsReview ? (
          <Chip tone="warn">{t("us.review")}</Chip>
        ) : d.unitStatus ? (
          <Chip tone={TONE[d.unitStatus] ?? "neutral"}>
            {t(`uss.${d.unitStatus}` as "uss.in_stock")}
          </Chip>
        ) : (
          <>—</>
        ),
    },
    {
      key: "imei",
      header: "IMEI",
      card: "meta",
      className: "tabular text-muted",
      render: (d) => d.imei ?? "—",
    },
    { key: "grade", header: t("us.grade"), card: "meta", render: (d) => d.grade ?? "—" },
    {
      key: "battery",
      header: t("us.battery"),
      align: "right",
      card: "meta",
      render: (d) => (d.batteryPct === null ? "—" : `${d.batteryPct}%`),
    },
    { key: "bought", header: t("us.bought"), card: "meta", render: (d) => dateTime(d.purchasedAt) },
    {
      key: "paid",
      header: t("us.paid"),
      align: "right",
      card: "figure",
      render: (d) => euros(d.buyPriceCents),
    },
    {
      key: "refurb",
      header: t("us.refurb"),
      align: "right",
      card: "figure",
      render: (d) => (d.refurbCostCents > 0 ? euros(d.refurbCostCents) : "—"),
    },
    {
      key: "price",
      header: t("us.price"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (d) => (d.salePriceCents === null ? "—" : euros(d.salePriceCents)),
    },
  ];

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("us.holdingCount")} value={String(holding.length)} />
        <Stat label={t("us.tiedUp")} value={euros(tiedUp)} sub={t("us.tiedUpHint")} />
        <Stat label={t("us.review")} value={String(needsReview)} />
        <Stat label={t("us.all")} value={String(devices.length)} />
      </StatGrid>

      <Card>
        <CardHead title={t("us.title")} hint={t("us.hint")} />
        <DataTable rows={devices} columns={columns} rowKey={(d) => d.id} />
      </Card>
    </div>
  );
}
