/**
 * Every completed document the shop has issued, newest first.
 *
 * Completed only — a draft is a ticket somebody is still building and a parked
 * sale is one nobody has paid for (ADR-0016 §1). What is listed here is what
 * was handed to a customer.
 */
import Link from "next/link";
import { requireAccount } from "../../../src/auth/session";
import { recentDocuments } from "../../../src/db/dashboard-queries";
import { DOC_TYPES, dateTime, euros } from "../../../src/lib/format";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const account = await requireAccount();
  const documents = await recentDocuments(account.id, 200);

  if (documents.length === 0) {
    return (
      <div className="card">
        <h1>Documentos</h1>
        <p className="lede">Todavía no hay ningún documento completado.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h1>Documentos</h1>
      <p className="lede">
        {documents.length} documento{documents.length === 1 ? "" : "s"} completado
        {documents.length === 1 ? "" : "s"}. Pulsa un número para ver sus líneas.
      </p>
      <table>
        <thead>
          <tr>
            <th>Número</th>
            <th>Tipo</th>
            <th>Cuándo</th>
            <th style={{ textAlign: "right" }}>Base</th>
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
              <td>{dateTime(doc.completedAt)}</td>
              <td className="num">{euros(doc.totalCents - doc.taxCents)}</td>
              <td className="num">{euros(doc.taxCents)}</td>
              <td className="num">{euros(doc.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
