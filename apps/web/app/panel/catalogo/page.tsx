/**
 * Catálogo — what the shop sells and what is on the shelf.
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
import { labelFor } from "../../../src/i18n";
import { productsForAccount } from "../../../src/db/catalogue-queries";
import { euros } from "../../../src/lib/format";
import {
  Card,
  CardBody,
  CardHead,
  Chip,
  EmptyState,
  TD,
  TH,
  TR,
  Table,
  ghostClass,
  inputClass,
} from "../../../src/ui";

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

  return (
    <Card>
      <CardHead
        title={t("cat.title")}
        hint={t("cat.hint")}
        action={
          <span className="text-[12px] text-muted">
            {t("cat.summary", { n: products.length, units, value: euros(atCost) })}
          </span>
        }
      />

      <CardBody className="border-b border-line">
        <form className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <input
              className={inputClass}
              type="search"
              name="q"
              defaultValue={typeof params.q === "string" ? params.q : ""}
              placeholder={t("cat.search")}
              aria-label={t("cat.search")}
            />
          </div>
          {groups.length > 0 ? (
            <select
              className={`${inputClass} w-auto`}
              name="group"
              defaultValue={group}
              aria-label={t("cat.group")}
            >
              <option value="">{t("cat.allGroups")}</option>
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <label className="flex items-center gap-2 px-1 text-[13px] text-ink-2">
            <input type="checkbox" name="low" value="1" defaultChecked={lowOnly} />
            {t("cat.lowOnly")}
          </label>
          <button className={ghostClass} type="submit">
            {t("cat.search")}
          </button>
        </form>
      </CardBody>

      {products.length === 0 ? (
        <EmptyState title={t("cat.empty")} />
      ) : (
        <CardBody className="pt-2">
          <Table>
            <thead>
              <tr>
                <TH>{t("cat.item")}</TH>
                <TH>{t("cat.group")}</TH>
                <TH>{t("cat.code")}</TH>
                <TH>{t("doc.regime")}</TH>
                <TH right>{t("cat.cost")}</TH>
                <TH right>{t("cat.price")}</TH>
                <TH right>{t("cat.stock")}</TH>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const low = product.onHand <= product.lowStockThreshold;
                return (
                  <TR key={product.id}>
                    <TD className={product.active ? undefined : "text-muted"}>
                      {product.name}
                      {product.active ? null : (
                        <span className="ml-2 align-middle">
                          <Chip>{t("cat.archived")}</Chip>
                        </span>
                      )}
                    </TD>
                    <TD>{product.group ?? "—"}</TD>
                    <TD className="tabular text-muted">{product.barcode ?? "—"}</TD>
                    <TD>{labelFor(t, "regime", product.taxRegime)}</TD>
                    <TD right>{euros(product.costCents)}</TD>
                    <TD right>{euros(product.priceCents)}</TD>
                    <TD right>
                      {low ? <Chip tone="warn">{product.onHand}</Chip> : product.onHand}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      )}
    </Card>
  );
}
