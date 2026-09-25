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
import { LinkTill, type LinkLabels } from "./link-till";
import {
  Card,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  type Column,
} from "../../../src/ui";

export const dynamic = "force-dynamic";

export default async function TillsPage() {
  const account = await requireAccount();
  const { t, locale } = await getT();

  const link: LinkLabels = {
    open: t("link.open"),
    title: t("link.title"),
    lede: t("link.lede"),
    labelField: t("link.labelField"),
    labelHint: t("link.labelHint"),
    issue: t("link.issue"),
    issuing: t("link.issuing"),
    codeIs: t("link.codeIs"),
    onceOnly: t("link.onceOnly"),
    validUntil: t("link.validUntil"),
    address: t("link.address"),
    steps: [t("link.step1"), t("link.step2"), t("link.step3"), t("link.step4")],
    copy: t("link.copy"),
    copied: t("link.copied"),
    close: t("app.close"),
    failed: t("link.failed"),
  };

  const [tills, shops] = await Promise.all([
    tillsForAccount(account.id, locale),
    shopsForAccount(account.id),
  ]);

  if (tills.length === 0) {
    return (
      <Card>
        {/* the button belongs HERE above all: a shop with no till linked is
            the one person on this screen who needs it */}
        <EmptyState
          title={t("till.none")}
          hint={t("till.noneHint")}
          action={<LinkTill labels={link} />}
        />
      </Card>
    );
  }

  const rowsByShop = new Map(shops.map((shop) => [shop.name, shop.rows]));

  const columns: Column<(typeof tills)[number]>[] = [
    {
      key: "name",
      header: t("till.name"),
      card: "title",
      className: "font-medium",
      render: (x) => x.terminalName,
    },
    { key: "shop", header: t("till.shop"), card: "sub", render: (x) => x.shop },
    {
      key: "state",
      header: t("till.state"),
      card: "badge",
      render: (x) => (
        <Chip tone={x.revoked ? "neutral" : "ok"}>
          {x.revoked ? t("till.revoked") : t("till.linked")}
        </Chip>
      ),
    },
    {
      key: "version",
      header: t("till.version"),
      card: "meta",
      className: "tabular text-muted",
      render: (x) => x.appVersion,
    },
    {
      key: "push",
      header: t("till.lastPush"),
      card: "figure",
      render: (x) => dateTime(x.lastPushAt),
    },
    {
      key: "rows",
      header: t("till.movements"),
      align: "right",
      card: "figure",
      render: (x) => rowsByShop.get(x.shop) ?? 0,
    },
  ];

  return (
    <Card>
      <CardHead title={t("till.title")} hint={t("till.hint")} action={<LinkTill labels={link} />} />
      <DataTable rows={tills} columns={columns} rowKey={(x) => x.id} />
    </Card>
  );
}
