/**
 * The shop's catalogue and its shelves, from wherever the owner happens to be.
 *
 * On-hand is computed from the movement history every time this page is asked
 * for, not read from a stored figure. The till keeps a cache and audits it
 * against the same sum; here there is no cache to drift.
 */
import { requireAccount } from "../../../src/auth/session";
import { productsForAccount, recentMovements } from "../../../src/db/catalogue-queries";
import { dateTime, euros } from "../../../src/lib/format";

export const dynamic = "force-dynamic";

const MOVEMENTS: Record<string, string> = {
  purchase_in: "Entrada",
  sale_out: "Venta",
  return_in: "Devolución",
  adjust_in: "Ajuste +",
  adjust_out: "Ajuste −",
  repair_out: "Reparación",
  used_in: "Compra usado",
};

const REGIMES: Record<string, string> = {
  IVA21: "IVA 21%",
  IVA10: "IVA 10%",
  IVA4: "IVA 4%",
  REBU: "REBU",
};

export default async function CataloguePage() {
  const account = await requireAccount();
  const [products, movements] = await Promise.all([
    productsForAccount(account.id),
    recentMovements(account.id, 25),
  ]);

  const onShelf = products.reduce((sum, p) => sum + p.onHand, 0);
  const atCost = products.reduce((sum, p) => sum + p.onHand * p.costCents, 0);

  if (products.length === 0) {
    return (
      <div className="card">
        <h1>Catálogo</h1>
        <p className="lede">
          Todavía no hay artículos. Los que des de alta en la caja aparecerán aquí solos.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 18 }}>
        <h1>Catálogo</h1>
        <p className="lede">
          {products.length} artículo{products.length === 1 ? "" : "s"} · {onShelf} unidad
          {onShelf === 1 ? "" : "es"} en estantería · {euros(atCost)} a precio de coste
        </p>
        <table>
          <thead>
            <tr>
              <th>Artículo</th>
              <th>Grupo</th>
              <th>Código</th>
              <th>Impuesto</th>
              <th style={{ textAlign: "right" }}>Coste</th>
              <th style={{ textAlign: "right" }}>PVP</th>
              <th style={{ textAlign: "right" }}>Stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const low = product.onHand <= product.lowStockThreshold;
              return (
                <tr key={product.id} style={{ opacity: product.active ? 1 : 0.5 }}>
                  <td>
                    {product.name}
                    {product.active ? null : (
                      <span style={{ color: "var(--muted)" }}> · archivado</span>
                    )}
                  </td>
                  <td>{product.group ?? "—"}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>
                    {product.barcode ?? "—"}
                  </td>
                  <td>{REGIMES[product.taxRegime] ?? product.taxRegime}</td>
                  <td className="num">{euros(product.costCents)}</td>
                  <td className="num">{euros(product.priceCents)}</td>
                  <td
                    className="num"
                    style={{ color: low ? "var(--warning-ink, #6a4a05)" : undefined, fontWeight: low ? 600 : 400 }}
                  >
                    {product.onHand}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h1>Movimientos de stock</h1>
        <p className="lede">
          Lo que entró y salió. El stock de arriba es la suma de esta lista, no una cifra guardada.
        </p>
        <table>
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Artículo</th>
              <th>Motivo</th>
              <th style={{ textAlign: "right" }}>Cantidad</th>
              <th style={{ textAlign: "right" }}>Coste unidad</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement, index) => (
              <tr key={`${movement.createdAt.getTime()}-${index}`}>
                <td>{dateTime(movement.createdAt)}</td>
                <td>{movement.productName}</td>
                <td>{MOVEMENTS[movement.movementType] ?? movement.movementType}</td>
                <td className="num" style={{ color: movement.qty < 0 ? "var(--danger-ink)" : undefined }}>
                  {movement.qty > 0 ? `+${movement.qty}` : movement.qty}
                </td>
                <td className="num">{euros(movement.unitCostCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
