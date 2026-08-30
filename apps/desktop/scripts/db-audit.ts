/**
 * `pnpm db:audit` — reconcile the books against the audit trail.
 *
 *   pnpm db:audit                          last 30 entries
 *   pnpm db:audit --entity document        only documents
 *   pnpm db:audit --action print           only print attempts
 *   pnpm db:audit --id <entityId>          one row's whole history
 *   pnpm db:audit --since 2026-08-24       from that date (inclusive)
 *   pnpm db:audit --until 2026-08-25       to the end of that date
 *   pnpm db:audit --limit 100              how many
 *   pnpm db:audit --diff                   what actually changed, in words
 *   pnpm db:audit --verify                 check the invariants, exit non-zero on any failure
 *
 * `--verify` checks the
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
import { isValidImei, repairStatus } from "@arkom/core";
import { openDb } from "@arkom/db";

const dbPath = process.env.ARKOM_DB_PATH!;
const argv = process.argv.slice(2);
const verify = argv.includes("--verify");
const showDiff = argv.includes("--diff");

/** `--flag value`; returns undefined when absent. */
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};

/** A date the owner would type (yyyy-mm-dd), or a full ISO instant. */
const parseDate = (raw: string | undefined, endOfDay: boolean): number | undefined => {
  if (!raw) return undefined;
  const ms = Date.parse(
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}` : raw,
  );
  if (Number.isNaN(ms)) {
    console.error(`Fecha no válida: ${raw} (usa yyyy-mm-dd)`);
    process.exit(2);
  }
  return ms;
};

const { sqlite } = openDb(dbPath);

const q = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] =>
  sqlite.prepare(sql).all(...params) as T[];

/* ---------------- reading the trail back (filters + diffs) ---------------- */

/** Money-shaped keys become "12,90 €"; timestamps become dates; the rest is itself. */
function readable(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    if (key.endsWith("Cents") || key.endsWith("_cents")) {
      return `${(value / 100).toFixed(2).replace(".", ",")} €`;
    }
    // epoch-ms timestamps, not quantities
    if (/(^|_|[a-z])(at|At)$/.test(key) && value > 1e12) {
      return new Date(value).toISOString().replace("T", " ").slice(0, 19);
    }
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Keys that say nothing about what a human changed. */
const NOISE = new Set(["id", "tenantId", "locationId", "terminalId", "updatedAt", "createdAt", "userId"]);

/**
 * What actually changed, in words. A create lists the fields worth seeing; an
 * update lists only the keys whose value moved, as "old → new". This is the
 * difference between an audit log you can read and one you merely have.
 */
function describeChange(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !NOISE.has(k));

  if (before === null) {
    // empties are dropped as noise, but `false` is kept: "ok = false" on a print
    // attempt is precisely what someone reading this log came to find
    return keys
      .filter((k) => a[k] !== null && a[k] !== undefined && a[k] !== "")
      .map((k) => `${k} = ${readable(k, a[k])}`);
  }
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => `${k}: ${readable(k, b[k])} → ${readable(k, a[k])}`);
}

if (!verify) {
  const limit = Number(flag("limit") ?? process.env.ARKOM_AUDIT_LIMIT ?? 30);
  const entity = flag("entity");
  const action = flag("action");
  const entityId = flag("id");
  const since = parseDate(flag("since"), false);
  const until = parseDate(flag("until"), true);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    params.push(value);
  };
  if (entity) add("entity = ?", entity);
  if (action) add("action = ?", action);
  if (entityId) add("entity_id = ?", entityId);
  if (since !== undefined) add("created_at >= ?", since);
  if (until !== undefined) add("created_at <= ?", until);
  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const total = q<{ n: number }>(`SELECT COUNT(*) n FROM oplog ${clause}`, ...params)[0]!.n;
  const rows = q<{
    seq: number;
    entity: string;
    entity_id: string;
    action: string;
    created_at: number;
    user_id: string | null;
    before: string | null;
    after: string | null;
  }>(
    `SELECT seq, entity, entity_id, action, created_at, user_id, before, after
     FROM oplog ${clause} ORDER BY seq DESC LIMIT ?`,
    ...params,
    limit,
  );

  const filters = [
    entity ? `entidad=${entity}` : null,
    action ? `acción=${action}` : null,
    entityId ? `id=${entityId}` : null,
    flag("since") ? `desde=${flag("since")}` : null,
    flag("until") ? `hasta=${flag("until")}` : null,
  ].filter(Boolean);

  console.log(
    `Oplog: ${rows.length} de ${total} entrada(s)` +
      (filters.length > 0 ? ` · filtros: ${filters.join(" · ")}` : "") +
      (showDiff ? "" : " · añade --diff para ver los cambios") +
      "\n",
  );

  for (const r of rows.reverse()) {
    const when = new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19);
    console.log(`  #${String(r.seq).padStart(5)}  ${when}  ${r.entity}.${r.action}  ${r.entity_id}  ${r.user_id ?? "—"}`);
    if (!showDiff) continue;
    const changes = describeChange(
      r.before === null ? null : JSON.parse(r.before),
      r.after === null ? null : JSON.parse(r.after),
    );
    if (changes.length === 0) console.log("           (sin cambios de campo)");
    else for (const line of changes) console.log(`           ${line}`);
  }

  if (total > rows.length) {
    console.log(`\n  … ${total - rows.length} entrada(s) más. Usa --limit para ver más.`);
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

/* 8. repair status is derived, not asserted (ADR-0014 §1) ---------------- */
/*
   The status column is a CACHE of what the ticket's own facts say, exactly as
   product_stock caches the movement ledger. Nothing may write it except
   syncStatus(), so a row where the two disagree means some path found a way to
   assert a state the facts do not support — which is the failure that whole
   design exists to make impossible. Same reasoning as check 1.
*/
interface AuditTicket {
  id: string;
  doc_number: string | null;
  status: string;
  authorized_cap_cents: number | null;
  ready_at: number | null;
  collection_document_id: string | null;
  not_repaired_at: number | null;
  not_repaired_reason: string | null;
}
const asDate = (v: number | null): Date | null => (v === null ? null : new Date(v));

check(
  "repair status equals what its facts derive",
  q<AuditTicket>(
    `SELECT t.id, d.doc_number, t.status, t.authorized_cap_cents, t.ready_at,
            t.collection_document_id, t.not_repaired_at, t.not_repaired_reason
       FROM repair_tickets t LEFT JOIN documents d ON d.id = t.document_id`,
  ).flatMap((t) => {
    const lines = q<{ kind: string; charge_cents: number; qty: number; received_at: number | null }>(
      "SELECT kind, charge_cents, qty, received_at FROM repair_lines WHERE ticket_id = ?",
      t.id,
    ).map((l) => ({
      kind: l.kind as "inventory_part" | "labor" | "part_on_order",
      chargeCents: l.charge_cents,
      qty: l.qty,
      receivedAt: asDate(l.received_at),
    }));
    const approvals = q<{ approved_total_cents: number; created_at: number }>(
      "SELECT approved_total_cents, created_at FROM repair_approvals WHERE ticket_id = ?",
      t.id,
    ).map((a) => ({ approvedTotalCents: a.approved_total_cents, createdAt: new Date(a.created_at) }));

    const derived = repairStatus({
      lines,
      approvals,
      authorizedCapCents: t.authorized_cap_cents,
      readyAt: asDate(t.ready_at),
      collectionDocumentId: t.collection_document_id,
      notRepairedAt: asDate(t.not_repaired_at),
      notRepairedReason: t.not_repaired_reason as never,
    });
    return derived === t.status ? [] : [`${t.doc_number ?? t.id}: guardado ${t.status}, derivado ${derived}`];
  }),
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
