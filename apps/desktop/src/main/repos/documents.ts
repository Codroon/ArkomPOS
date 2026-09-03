/**
 * Every document the till has issued, in one flat list — v0.17.0.
 *
 * Read-only, and deliberately so. Each screen already shows the documents it
 * owns — a repair's receipts, a shift's Z, an inventory movement's ticket — and
 * every one of those opens the same peek. What was missing is the question
 * nobody's screen answers: "what did we issue on Tuesday?"
 *
 * It lists nothing a peek cannot open, so every row leads somewhere.
 */
import { and, desc, eq, gte, inArray, like, lt, or, type SQL } from "drizzle-orm";
import { allocateNumber, TAX_RATE_BP, type MutationCtx } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";

const { documents, numberSeries, users } = schema;

export interface DocsListInput {
  docType?: "ticket" | "purchase" | "repair" | "refund" | null;
  fromMs?: number | null;
  toMs?: number | null;
  search?: string | null;
  limit: number;
}

export function listDocuments(db: ArkomDb, ctx: MutationCtx, input: DocsListInput) {
  const conds: SQL[] = [
    eq(documents.tenantId, ctx.tenantId),
    eq(documents.status, "completed"),
    /* a `shift` document is the Z, which belongs to Caja's own history and has
       no lines a document peek could render */
    inArray(documents.docType, ["ticket", "purchase", "repair", "refund"]),
  ];
  if (input.docType) conds.push(eq(documents.docType, input.docType));
  if (input.fromMs) conds.push(gte(documents.completedAt, new Date(input.fromMs)));
  if (input.toMs) conds.push(lt(documents.completedAt, new Date(input.toMs)));

  const search = input.search?.trim().replace(/[%_]/g, "").toUpperCase();
  if (search) {
    /* the number as printed, or the digits off the top of it — the same three
       shapes Find ticket accepts, for the same reason (ADR-0019 A1) */
    const digits = search.replace(/\D/g, "");
    const byNumber = digits ? or(like(documents.docNumber, `%${search}%`), eq(documents.number, Number(digits))) : like(documents.docNumber, `%${search}%`);
    conds.push(byNumber!);
  }

  const rows = db
    .select({
      id: documents.id,
      docNumber: documents.docNumber,
      docType: documents.docType,
      completedAt: documents.completedAt,
      totalCents: documents.totalCents,
      userName: users.name,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.userId))
    .where(and(...conds))
    /* newest first: the question is almost always about today */
    .orderBy(desc(documents.completedAt))
    .limit(input.limit + 1)
    .all();

  const truncated = rows.length > input.limit;
  return {
    rows: rows.slice(0, input.limit).map((r) => ({
      id: r.id,
      docNumber: r.docNumber ?? "",
      docType: r.docType,
      completedAtMs: r.completedAt?.getTime() ?? null,
      totalCents: r.totalCents,
      userName: r.userName,
    })),
    truncated,
  };
}

/**
 * The numbering and the regimes, for looking at.
 *
 * `nextDocNumber` is built with the SAME function that allocates a real one, so
 * what Ajustes promises is what the next document will actually be called
 * rather than a second opinion about padding (ADR-0008).
 */
export function seriesOverview(db: ArkomDb, ctx: MutationCtx) {
  const rows = db
    .select()
    .from(numberSeries)
    .where(eq(numberSeries.terminalId, ctx.terminalId))
    .all();

  return {
    series: rows.map((r) => ({
      docType: r.docType,
      prefix: r.prefix,
      nextNumber: r.nextNumber,
      nextDocNumber: allocateNumber({ prefix: r.prefix, nextNumber: r.nextNumber }).docNumber,
    })),
    /* Phase 1 applies IVA21 and the margin scheme; exempt exists in the schema
       and no screen writes it. Shown because "what tax does this till charge"
       is a question, and not editable because the answer is the law's. */
    taxRegimes: [
      { code: "IVA21", rateBp: TAX_RATE_BP.IVA21 },
      { code: "REBU", rateBp: 0 },
      { code: "EXEMPT", rateBp: 0 },
    ],
  };
}
