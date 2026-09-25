/**
 * Catálogo — what the shop sells and what is on the shelf.
 *
 * The question is "have we got it, what does it cost and what do we charge". On
 * a desktop that is a table; on a phone it is a card per article with PVP and
 * stock in the figure strip, because those two columns were the ones hidden off
 * the right edge of the old table — the two anybody opens this screen for.
 *
 * On-hand is computed from the movement history every time this page is asked
 * for, not read from a stored figure. The till keeps a cache and `db:audit`
 * asserts the cache equals the sum; here there is nothing to drift.
 *
 * Search and the low-stock filter are applied in the page rather than in SQL:
 * a shop's catalogue is hundreds of rows, not millions, and one query the
 * integration tests already cover beats four that each need their own.
 */
import { requireAccount } from "../../../src/auth/session";
import { getT } from "../../../src/i18n/server";
import { labelFor, plural } from "../../../src/i18n";
import { productsForAccount } from "../../../src/db/catalogue-queries";
import { euros } from "../../../src/lib/format";
import {
  Card,
  CardHead,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Figure,
  ghostClass,
  inputClass,
  selectClass,
  type Column,
} from "../../../src/ui";
import { Filters } from "../../../src/ui/filters";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const account = await requireAccount();
  const { t } = await getT();
  const params = await searchParams;

  const search = (typeof params.q === "string" ? params.q : "").trim().toLowerCase();
  const lowOnly = params.low === "1";
  const group = typeof params.group === "string" ? params.group : "";

  const all = await productsForAccount(account.id);

  /* the groups the shop actually uses, in the order they read on screen */
  const groups = [...new Set(all.map((product) => product.group).filter((g): g is string => Boolean(g)))]
    .sort((a, b) => a.localeCompare(b, "es"));

  const products = all.filter((product) => {
    if (group && product.group !== group) return false;
    if (lowOnly && product.onHand > product.lowStockThreshold) return false;
    if (!search) return true;
    return (
      product.name.toLowerCase().includes(search) ||
      (product.barcode ?? "").toLowerCase().includes(search)
    );
  });

  const units = products.reduce((sum, product) => sum + product.onHand, 0);
  const atCost = products.reduce((sum, product) => sum + product.onHand * product.costCents, 0);

  const columns: Column<(typeof products)[number]>[] = [
    {
      key: "item",
      header: t("cat.item"),
      card: "title",
      render: (p) => (
        <span className={p.active ? undefined : "text-muted"}>
          {p.name}
          {p.active ? null : (
            <span className="ml-2 align-middle">
              <Chip>{t("cat.archived")}</Chip>
            </span>
          )}
        </span>
      ),
    },
    { key: "group", header: t("cat.group"), card: "sub", render: (p) => p.group ?? "—" },
    {
      key: "code",
      header: t("cat.code"),
      card: "meta",
      className: "tabular text-muted",
      render: (p) => p.barcode ?? "—",
    },
    {
      key: "regime",
      header: t("doc.regime"),
      card: "meta",
      render: (p) => labelFor(t, "regime", p.taxRegime),
    },
    {
      key: "cost",
      header: t("cat.cost"),
      align: "right",
      card: "figure",
      render: (p) => euros(p.costCents),
    },
    {
      key: "price",
      header: t("cat.price"),
      align: "right",
      card: "figure",
      className: "font-semibold",
      render: (p) => euros(p.priceCents),
    },
    {
      key: "stock",
      header: t("cat.stock"),
      align: "right",
      card: "figure",
      render: (p) =>
        p.onHand <= p.lowStockThreshold ? <Chip tone="warn">{p.onHand}</Chip> : p.onHand,
    },
  ];

  return (
    <Card>
      <CardHead title={t("cat.title")} hint={t("cat.hint")} />

      <Filters
        label={t("filter.label")}
        apply={t("filter.apply")}
        close={t("app.close")}
        active={(search ? 1 : 0) + (group ? 1 : 0) + (lowOnly ? 1 : 0)}
        summary={plural(t, "cat.count", products.length)}
      >
        <Field label={t("cat.search")} className="md:w-[260px]">
          <input
            className={inputClass}
            type="search"
            name="q"
            defaultValue={typeof params.q === "string" ? params.q : ""}
            placeholder={t("cat.search")}
          />
        </Field>
        {groups.length > 0 ? (
          <Field label={t("cat.group")} className="md:w-[220px]">
            <select className={selectClass} name="group" defaultValue={group}>
              <option value="">{t("cat.allGroups")}</option>
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {/* 44px of target, not a 13px box with a label beside it */}
        <label className="flex h-11 items-center gap-2.5 rounded-card px-1 text-[13.5px] text-ink-2 md:h-10">
          <input type="checkbox" name="low" value="1" defaultChecked={lowOnly} className="h-4 w-4" />
          {t("cat.lowOnly")}
        </label>
        <button className={`${ghostClass} hidden md:inline-flex`} type="submit">
          {t("filter.apply")}
        </button>
      </Filters>

      <DataTable
        rows={products}
        columns={columns}
        rowKey={(p) => p.id}
        empty={<EmptyState title={t("cat.empty")} />}
        footer={
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-[12px] text-muted">
              {products.length === 1
                ? t("cat.countUnits.one", { units })
                : t("cat.countUnits", { n: products.length, units })}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-[11px] tracking-[0.06em] text-subtle uppercase">
                {t("inf.atCost")}
              </span>
              <Figure size="md">{euros(atCost)}</Figure>
            </span>
          </div>
        }
      />
    </Card>
  );
}
