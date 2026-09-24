/**
 * The owner's panel — what exists of it after the auth slice.
 *
 * It answers the two questions an owner asks before any figure: is my till
 * connected, and is it up to date. The takings, the Z history and the rest
 * arrive in the dashboard slice; this is the part that proves a session
 * reaches real rows scoped to one account.
 *
 * A Server Component: the queries run in the request, never in the browser, and
 * the browser is never handed an account id to ask with.
 */
import { redirect } from "next/navigation";
import { currentUser } from "../../src/auth/supabase";
import { signOutAction } from "../../src/auth/actions";
import { accountForUser } from "../../src/db/pg-accounts";
import { shopsForAccount, tillsForAccount } from "../../src/db/panel-queries";

export const dynamic = "force-dynamic";

const when = (value: Date | null): string => {
  if (!value) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(value.getDate())}/${p(value.getMonth() + 1)}/${value.getFullYear()} ${p(value.getHours())}:${p(value.getMinutes())}`;
};

const LICENCE: Record<string, string> = {
  trial: "De prueba",
  active: "Activa",
  suspended: "Suspendida",
};

export default async function PanelPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const account = await accountForUser(user.id);
  /* Signed in, but attached to no account — a signup that fell over between
     the identity and the account. Sending them back to sign in runs the
     attachment again, which is idempotent and usually fixes it. */
  if (!account) redirect("/login?error=link");

  const [shops, tills] = await Promise.all([
    shopsForAccount(account.id),
    tillsForAccount(account.id),
  ]);

  return (
    <div className="wrap wide">
      <div className="topbar">
        <div>
          <div className="brand" style={{ marginBottom: 6 }}>CODROON POS</div>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {account.name} · {account.email} · {LICENCE[account.licenceState] ?? account.licenceState}
          </div>
        </div>
        <form action={signOutAction}>
          <button className="ghost" type="submit">Salir</button>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h1>Tiendas</h1>
        <p className="lede">Lo que tus cajas han enviado.</p>
        {shops.length === 0 ? (
          <p className="hint">
            Todavía no hay ninguna caja enlazada. En la caja: Ajustes → Nube, y pega el código de
            enlace.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Tienda</th>
                <th>Cajas</th>
                <th>Movimientos</th>
                <th>Última vez</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => (
                <tr key={shop.id}>
                  <td>{shop.name}</td>
                  <td className="num">{shop.tills}</td>
                  <td className="num">{shop.rows}</td>
                  <td>{when(shop.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tills.length > 0 ? (
        <div className="card">
          <h1>Cajas</h1>
          <p className="lede">Una fila por caja, con la versión que tiene instalada.</p>
          <table>
            <thead>
              <tr>
                <th>Caja</th>
                <th>Tienda</th>
                <th>Versión</th>
                <th>Último envío</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {tills.map((till) => (
                <tr key={till.id}>
                  <td>{till.terminalName}</td>
                  <td>{till.shop}</td>
                  <td>{till.appVersion}</td>
                  <td>{when(till.lastPushAt)}</td>
                  <td>
                    <span className={till.revoked ? "chip cold" : "chip"}>
                      {till.revoked ? "REVOCADA" : "ENLAZADA"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
