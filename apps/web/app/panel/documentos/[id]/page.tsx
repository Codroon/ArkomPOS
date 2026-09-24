/**
 * One document, the way the paper read.
 *
 * The figures are the ones snapshotted onto the lines when they were written
 * (ADR-0007 A1), not a recomputation from a rate — this is a copy of a fiscal
 * record, and a second opinion about a number already handed to a customer is
 * not something a dashboard should offer.
 *
 * `notFound()` covers both "no such document" and "not this account's
 * document", deliberately: the query is scoped by account, so a valid id
 * belonging to another shop returns nothing, and the answer a stranger gets is
 * the same either way.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccount } from "../../../../src/auth/session";
import { documentDetail } from "../../../../src/db/document-queries";
import { DOC_TYPES, TENDER_METHODS, dateTime, euros } from "../../../../src/lib/format";

export const dynamic = "force-dynamic";

const REGIMES: Record<string, string> = {
  IVA21: "IVA 21%",
  IVA10: "IVA 10%",
  IVA4: "IVA 4%",
  REBU: "REBU",
};

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const account = await requireAccount();
  const { id } = await params;
  const detail = await documentDetail(account.id, id);
  if (!detail) notFound();

  const { head, lines, tenders } = detail;
  const tendered = tenders.reduce((sum, t) => sum + t.amountCents, 0);

  return (
    <>
      <p style={{ marginTop: 0 }}>
        <Link href="/panel/documentos">← Documentos</Link>
      </p>

      <div className="card" style={{ marginBottom: 18 }}>
        <h1 style={{ fontVariantNumeric: "tabular-nums" }}>{head.docNumber ?? "Sin número"}</h1>
        <p className="lede">
          {DOC_TYPES[head.docType] ?? head.docType} · {head.shopName} · {dateTime(head.completedAt)}
        </p>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Concepto</th>
              <th style={{ textAlign: "right" }}>Cant.</th>
              <th style={{ textAlign: "right" }}>Precio</th>
              <th>Impuesto</th>
              <th style={{ textAlign: "right" }}>Base</th>
              <th style={{ textAlign: "right" }}>IVA</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.lineNo}>
                <td style={{ color: "var(--muted)" }}>{line.lineNo}</td>
                <td>
                  {line.description}
                  {line.priceOverridden ? (
                    <span style={{ color: "var(--muted)" }}> · precio cambiado</span>
                  ) : null}
                </td>
                <td className="num">{line.qty}</td>
                <td className="num">{euros(line.unitPriceCents)}</td>
                <td>{REGIMES[line.taxRegime] ?? line.taxRegime}</td>
                <td className="num">{euros(line.baseCents)}</td>
                <td className="num">{euros(line.taxCents)}</td>
                <td className="num">{euros(line.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <table style={{ width: "auto", minWidth: 260 }}>
            <tbody>
              <tr>
                <td style={{ color: "var(--muted)" }}>Base imponible</td>
                <td className="num">{euros(head.subtotalCents)}</td>
              </tr>
              <tr>
                <td style={{ color: "var(--muted)" }}>IVA</td>
                <td className="num">{euros(head.taxCents)}</td>
              </tr>
              <tr>
                <td style={{ fontWeight: 600 }}>Total</td>
                <td className="num" style={{ fontWeight: 600, fontSize: 16 }}>
                  {euros(head.totalCents)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h1>Cobro</h1>
        <p className="lede">
          Cómo se pagó. Un vale o una señal es una forma de pago, nunca una línea del documento.
        </p>
        {tenders.length === 0 ? (
          <p className="hint">Sin cobros registrados en este documento.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Forma</th>
                <th style={{ textAlign: "right" }}>Importe</th>
              </tr>
            </thead>
            <tbody>
              {tenders.map((tender, index) => (
                <tr key={`${tender.method}-${index}`}>
                  <td>{TENDER_METHODS[tender.method] ?? tender.method}</td>
                  <td className="num">{euros(tender.amountCents)}</td>
                </tr>
              ))}
              {tendered !== head.totalCents ? (
                <tr>
                  <td style={{ color: "var(--muted)" }}>Cambio</td>
                  <td className="num" style={{ color: "var(--muted)" }}>
                    {euros(tendered - head.totalCents)}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
