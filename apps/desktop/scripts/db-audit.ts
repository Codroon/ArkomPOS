/**
 * `pnpm db:audit` — dump the audit trail. `pnpm db:audit --verify` — check the
 * invariants the whole design rests on and exit non-zero if any fails:
 *
 *   1. stock cache ≡ Σ movements, and never negative (ADR-0004)
 *   2. every business row was audited when created (ADR-0005)
 *   3. oplog op_ids unique (the cloud dedupes on them, ADR-0005)
 *   4. document numbers gap-free per series, only on completed sales (ADR-0008)
 *   5. completed sales balance: Σ line totals ≡ document total, tenders ≥ total
 *   6. unit lifecycle: sold units carry their document, IMEIs valid and unique
 *   7. product codes: no code twice on one product
 */
import { isValidImei } from "@arkom/core";
import { openDb } from "@arkom/db";

const dbPath = process.env.ARKOM_DB_PATH!;
const verify = process.argv.includes("--verify");
const { sqlite } = openDb(dbPath);

const q = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] =>
  sqlite.prepare(sql).all(...params) as T[];

if (!verify) {
  const limit = Number(process.env.ARKOM_AUDIT_LIMIT ?? 30);
  const rows = q<{ seq: number; entity: string; entity_id: string; action: string; created_at: number; user_id: string | null }>(
    "SELECT seq, entity, entity_id, action, created_at, user_id FROM oplog ORDER BY seq DESC LIMIT ?",
    limit,
  );
  console.log(`Últimas ${rows.length} entradas del oplog (de ${q<{ n: number }>("SELECT COUNT(*) n FROM oplog")[0]!.n}):\n`);
  for (const r of rows.reverse()) {
    const when = new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  #${String(r.seq).padStart(5)}  ${when}  ${r.entity}.${r.action}  ${r.entity_id}  ${r.user_id ?? "—"}`);
  }
  sqlite.close();
  process.exit(0);
}

const failures: string[] = [];
const checks: string[] = [];
const check = (label: string, problems: string[]) => {
  if (problems.length === 0) checks.push(`  OK    ${label}`);
  else {
    checks.push(`  FAIL  ${label}`);
    failures.push(...problems.map((p) => `${label}: ${p}`));
  }
};

/* 1. stock cache ≡ Σ movements ---------------------------------------- */
check(
  "stock cache equals the sum of its movements",
  q<{ product_id: string; on_hand: number; ledger: number }>(`
    SELECT ps.product_id, ps.on_hand, COALESCE((
      SELECT SUM(m.qty) FROM stock_movements m
      WHERE m.product_id = ps.product_id AND m.location_id = ps.location_id), 0) AS ledger
    FROM product_stock ps WHERE ps.on_hand <> COALESCE((
      SELECT SUM(m.qty) FROM stock_movements m
      WHERE m.product_id = ps.product_id AND m.location_id = ps.location_id), 0)
  `).map((r) => `product ${r.product_id}: cache ${r.on_hand} vs ledger ${r.ledger}`),
);
check(
  "no negative stock",
  q<{ product_id: string; on_hand: number }>("SELECT product_id, on_hand FROM product_stock WHERE on_hand < 0").map(
    (r) => `product ${r.product_id} at ${r.on_hand}`,
  ),
);

/* 2. every business row was audited on creation ------------------------ */
const auditCoverage: [string, string][] = [
  ["products", "product"],
  ["units", "unit"],
  ["stock_movements", "stock_movement"],
  ["documents", "document"],
  ["document_lines", "document_line"],
  ["document_tenders", "document_tender"],
  ["product_codes", "product_code"],
];
check(
  "every business row has an oplog entry",
  auditCoverage.flatMap(([table, entity]) => {
    const missing = q<{ n: number }>(
      `SELECT COUNT(*) n FROM ${table} t WHERE NOT EXISTS (SELECT 1 FROM oplog o WHERE o.entity = ? AND o.entity_id = t.id)`,
      entity,
    )[0]!.n;
    return missing > 0 ? [`${missing} ${table} row(s) never audited`] : [];
  }),
);

/* 3. oplog idempotency keys ------------------------------------------- */
check(
  "oplog op_ids are unique",
  q<{ n: number }>("SELECT COUNT(*) n FROM (SELECT op_id FROM oplog GROUP BY op_id HAVING COUNT(*) > 1)")[0]!.n > 0
    ? ["duplicate op_id found"]
    : [],
);

/* 4. document numbering (ADR-0008) ------------------------------------ */
const numberProblems: string[] = [];
for (const series of q<{ id: string; prefix: string; next_number: number }>("SELECT id, prefix, next_number FROM number_series")) {
  const numbers = q<{ number: number; doc_number: string }>(
    "SELECT number, doc_number FROM documents WHERE series_id = ? ORDER BY number",
    series.id,
  );
  numbers.forEach((row, i) => {
    if (row.number !== i + 1) numberProblems.push(`${series.prefix}: expected ${i + 1}, found ${row.number}`);
    const expected = `${series.prefix}${String(row.number).padStart(6, "0")}`;
    if (row.doc_number !== expected) numberProblems.push(`${row.doc_number} should be ${expected}`);
  });
  if (series.next_number !== numbers.length + 1) {
    numberProblems.push(`${series.prefix}: next_number ${series.next_number}, issued ${numbers.length}`);
  }
}
numberProblems.push(
  ...q<{ id: string; status: string }>(
    "SELECT id, status FROM documents WHERE (doc_number IS NULL) <> (status <> 'completed')",
  ).map((r) => `document ${r.id} is ${r.status} but its number says otherwise`),
);
check("document numbers are gap-free and only on completed sales", numberProblems);

/* 5. completed sales balance ------------------------------------------ */
check(
  "completed sales balance (lines = total, tenders cover it)",
  q<{ id: string; doc_number: string; total_cents: number; lines: number; tenders: number }>(`
    SELECT d.id, d.doc_number, d.total_cents,
      COALESCE((SELECT SUM(l.total_cents) FROM document_lines l WHERE l.document_id = d.id), 0) AS lines,
      COALESCE((SELECT SUM(t.amount_cents) FROM document_tenders t WHERE t.document_id = d.id), 0) AS tenders
    FROM documents d WHERE d.status = 'completed'
  `).flatMap((r) => {
    const out: string[] = [];
    if (r.lines !== r.total_cents) out.push(`${r.doc_number}: lines ${r.lines} vs total ${r.total_cents}`);
    if (r.tenders < r.total_cents) out.push(`${r.doc_number}: tenders ${r.tenders} < total ${r.total_cents}`);
    return out;
  }),
);

/* 6. unit lifecycle ---------------------------------------------------- */
const unitProblems = q<{ id: string; imei: string; status: string; sold_document_id: string | null }>(
  "SELECT id, imei, status, sold_document_id FROM units",
).flatMap((u) => {
  const out: string[] = [];
  if (!isValidImei(u.imei)) out.push(`unit ${u.id}: invalid IMEI ${u.imei}`);
  if (u.status === "sold" && !u.sold_document_id) out.push(`unit ${u.id}: sold without a document`);
  if (u.status !== "sold" && u.sold_document_id) out.push(`unit ${u.id}: ${u.status} but carries a document`);
  return out;
});
if (q<{ n: number }>("SELECT COUNT(*) n FROM (SELECT imei FROM units GROUP BY tenant_id, imei HAVING COUNT(*) > 1)")[0]!.n > 0) {
  unitProblems.push("duplicate IMEI across units");
}
check("units: valid unique IMEIs, sold ones linked to their sale", unitProblems);

/* 7. product codes ----------------------------------------------------- */
check(
  "no product holds the same code twice",
  q<{ n: number }>(
    "SELECT COUNT(*) n FROM (SELECT product_id, code FROM product_codes GROUP BY tenant_id, product_id, code HAVING COUNT(*) > 1)",
  )[0]!.n > 0
    ? ["a product holds one code more than once"]
    : [],
);

console.log(`Auditoría de ${dbPath}\n`);
console.log(checks.join("\n"));
const counts = q<{ n: number }>("SELECT COUNT(*) n FROM oplog")[0]!.n;
console.log(`\n  ${counts} entradas de oplog · ${q<{ n: number }>("SELECT COUNT(*) n FROM stock_movements")[0]!.n} movimientos`);

sqlite.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} PROBLEMA(S):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nTodo correcto: la base de datos es coherente.\n");
