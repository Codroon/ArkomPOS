/**
 * The owner's dashboard.
 *
 * It answers, in the order somebody standing outside their own shop asks them:
 * what has it taken today, how was it paid, what went through the till, how did
 * the day close, and is the till still talking to us.
 *
 * Every figure is computed in SQL (`dashboard-queries.ts`) and arrives here
 * already shaped. Nothing on this page adds up money — that would be a second
 * implementation of it, and the one in `packages/core` is the one with tests.
 *
 * A Server Component: the queries run in the request, scoped to the signed-in
 * account, and the browser is never handed an id to ask with.
 */
import Link from "next/link";
import { requireAccount } from "../../src/auth/session";
import { shopsForAccount, tillsForAccount } from "../../src/db/panel-queries";
import {
  dailyTakings,
  recentDocuments,
  recentShifts,
  tenderSplit,
  todayTotals,
} from "../../src/db/dashboard-queries";
import { DOC_TYPES, TENDER_METHODS, dateTime, dayLabel, euros, time } from "../../src/lib/format";

export const dynamic = "force-dynamic";

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ flex: "1 1 150px" }}>
      <div className="label">{label}</div>
      <div style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{sub}</div> : null}
    </div>
  );
}

export default async function PanelPage() {
  const account = await requireAccount();

  const [today, days, documents, tenders, shifts, shops, tills] = await Promise.all([
    todayTotals(account.id),
    dailyTakings(account.id, 10),
    recentDocuments(account.id, 12),
    tenderSplit(account.id, 30),
    recentShifts(account.id, 6),
    shopsForAccount(account.id),
    tillsForAccount(account.id),
  ]);

  const linked = tills.length > 0;

  return (
    <>
      {!linked ? (
        <div className="card">
          <h1>Todavía no hay ninguna caja enlazada</h1>
          <p className="lede">
            En la caja: <strong>Ajustes → Nube</strong>, pega el código de enlace y pulsa{" "}
            <em>Enlazar la caja</em>. Lo que ya haya vendido subirá solo.
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h1>Hoy</h1>
            <p className="lede">Documentos completados, con la hora de la tienda.</p>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <Figure
                label="Ventas netas"
                value={euros(today.netCents)}
                sub={`${today.documents} documento${today.documents === 1 ? "" : "s"}`}
              />
              <Figure
                label="Devoluciones"
                value={euros(today.refundCents)}
                sub={`${today.refunds} documento${today.refunds === 1 ? "" : "s"}`}
              />
              {tenders.length > 0 ? (
                <Figure
                  label="Cobros (30 días)"
                  value={euros(tenders.reduce((sum, t) => sum + t.amountCents, 0))}
                  sub={tenders
                    .map((t) => `${TENDER_METHODS[t.method] ?? t.method} ${euros(t.amountCents)}`)
                    .join(" · ")}
                />
              ) : null}
            </div>
          </div>

          {days.length > 0 ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <h1>Por día</h1>
              <p className="lede">Los últimos días con movimiento.</p>
              <table>
                <thead>
                  <tr>
                    <th>Día</th>
                    <th style={{ textAlign: "right" }}>Documentos</th>
                    <th style={{ textAlign: "right" }}>Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.day}>
                      <td>{dayLabel(d.day)}</td>
                      <td className="num">{d.documents}</td>
                      <td className="num">{euros(d.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {documents.length > 0 ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <h1>Últimos documentos</h1>
              <p className="lede">Solo completados. Un borrador no es dinero.</p>
              <table>
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Tipo</th>
                    <th>Hora</th>
                    <th style={{ textAlign: "right" }}>IVA</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>
                        <Link href={`/panel/documentos/${doc.id}`}>{doc.docNumber}</Link>
                      </td>
                      <td>{DOC_TYPES[doc.docType] ?? doc.docType}</td>
                      <td>{time(doc.completedAt)}</td>
                      <td className="num">{euros(doc.taxCents)}</td>
                      <td className="num">{euros(doc.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {shifts.length > 0 ? (
            <div className="card" style={{ marginBottom: 18 }}>
              <h1>Cierres de caja</h1>
              <p className="lede">Un turno cerrado no se puede tocar. Esto es lo que se contó.</p>
              <table>
                <thead>
                  <tr>
                    <th>Z</th>
                    <th>Cerrado</th>
                    <th style={{ textAlign: "right" }}>Esperado</th>
                    <th style={{ textAlign: "right" }}>Contado</th>
                    <th style={{ textAlign: "right" }}>Descuadre</th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <tr key={`${shift.zDocNumber}-${shift.closedAt.getTime()}`}>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{shift.zDocNumber ?? "—"}</td>
                      <td>{dateTime(shift.closedAt)}</td>
                      <td className="num">{euros(shift.expectedCashCents)}</td>
                      <td className="num">{euros(shift.countedCashCents)}</td>
                      <td
                        className="num"
                        style={{ color: shift.varianceCents === 0 ? "var(--muted)" : "var(--danger-ink)" }}
                      >
                        {euros(shift.varianceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}

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
              <th style={{ textAlign: "right" }}>Movimientos</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {tills.map((till) => (
              <tr key={till.id}>
                <td>{till.terminalName}</td>
                <td>{till.shop}</td>
                <td>{till.appVersion}</td>
                <td>{dateTime(till.lastPushAt)}</td>
                <td className="num">
                  {shops.find((s) => s.name === till.shop)?.rows ?? 0}
                </td>
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
    </>
  );
}