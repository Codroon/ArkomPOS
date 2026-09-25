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
import {
  Card,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  type Column,
} from "../../../src/ui";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const account = await requireAccount();
  const { t } = await getT();
  const movements = await recentMovements(account.id, 200);

  const columns: Column<(typeof movements)[number]>[] = [
    { key: "item", header: t("cat.item"), card: "title", render: (m) => m.productName },
    { key: "when", header: t("doc.when"), card: "sub", render: (m) => dateTime(m.createdAt) },
    {
      key: "reason",
      header: t("inv.reason"),
      card: "badge",
      render: (m) => (
        <Chip tone={m.qty < 0 ? "bad" : "ok"}>{labelFor(t, "mv", m.movementType)}</Chip>
      ),
    },
    {
      key: "qty",
      header: t("inv.qty"),
      align: "right",
      card: "figure",
      render: (m) => (
        <span className={m.qty < 0 ? "text-danger-ink" : "text-ink"}>
          {m.qty > 0 ? `+${m.qty}` : m.qty}
        </span>
      ),
    },
    {
      key: "cost",
      header: t("inv.unitCost"),
      align: "right",
      card: "figure",
      render: (m) => euros(m.unitCostCents),
    },
  ];

  return (
    <Card>
      <CardHead title={t("inv.title")} hint={t("inv.hint")} />
      <DataTable
        rows={movements}
        columns={columns}
        rowKey={(m, i) => `${m.createdAt.getTime()}-${i}`}
        empty={<EmptyState title={t("empty.noData")} />}
      />
    </Card>
  );
}
