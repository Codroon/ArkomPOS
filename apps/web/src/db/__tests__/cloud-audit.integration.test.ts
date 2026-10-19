/**
 * `pnpm cloud:audit -- <account name or id>` — every dashboard screen, checked
 * against an INDEPENDENT rebuild of what the shop's tills hold.
 *
 * Written the day a receipt for one phone was shown with nine items on it. The
 * checks we had compared totals, and the receipt's own total was right, so they
 * passed. This one compares LINES, PARTS, PRODUCTS and STOCK, record by record.
 *
 * The rebuild is deliberately not the dashboard's code. It replays the shop's
 * whole history in plain TypeScript, in time order, with the till's own rules:
 * an op with fields merges them, an op with no `after` deletes the row. If the
 * two implementations disagree, one of them is wrong and the audit names the
 * record. That is the same idea as `db:truth` + `cloud:reconcile`, without
 * needing the shop's PC: every change a linked till has made is already here.
 *
 * Read-only. Skips unless AUDIT_ACCOUNT is set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { documentDetail } from "../document-queries";
import { documentsInPeriod, periodTotals, topProducts, recentShifts } from "../dashboard-queries";
import { productsForAccount } from "../catalogue-queries";
import { repairsForAccount, repairDetail, usedForAccount, transfersForAccount } from "../workshop-queries";
import { salesSummary, outstandingCredit } from "../report-queries";
import { lastDays } from "../../lib/range";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* CI */
}

const target = process.env.AUDIT_ACCOUNT?.trim();
const ready = Boolean(process.env.DIRECT_URL && target);

type Row = Record<string, unknown>;
type State = Map<string, Map<string, Row>>;

let sql: ReturnType<typeof postgres>;
let accountId = "";
let state: State = new Map();
const findings: string[] = [];

const rows = (entity: string): [string, Row][] => [...(state.get(entity) ?? new Map()).entries()];
const n = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
const isoToMs = (key: string, v: unknown): unknown =>
  typeof v === "string" && /At$/.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : v;

/** Record a disagreement; the case fails at the end with every one listed. */
const differ = (area: string, what: string) => findings.push(`${area}: ${what}`);

beforeAll(async () => {
  if (!ready) return;
  sql = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 });
  const matches = await sql<{ id: string }[]>`
    select id from accounts where id::text = ${target!} or name = ${target!}`;
  /* an audit of the wrong account, or of none, must never read as a pass */
  if (matches.length === 0) throw new Error(`No account "${target}".`);
  if (matches.length > 1) throw new Error(`"${target}" names ${matches.length} accounts; pass the id.`);
  const account = matches[0]!;

  /* every op the shop's tills have sent, in the order they happened */
  const ops = await sql<{ entity: string; entity_id: string; after: Row | null }[]>`
    select e.entity, e.entity_id, e.after
    from sync_entries e
    join tenants t on t.id = e.tenant_id
    where t.account_id = ${account.id}
    order by e.created_at asc, e.seq asc`;
  if (ops.length === 0) throw new Error(`Account "${target}" has sent nothing; there is nothing to audit.`);
  accountId = account.id;

  state = new Map();
  for (const op of ops) {
    const table = state.get(op.entity) ?? new Map<string, Row>();
    state.set(op.entity, table);
    if (op.after === null || op.after === undefined) {
      table.delete(op.entity_id); /* the till deleted it */
      continue;
    }
    const merged: Row = { ...(table.get(op.entity_id) ?? {}) };
    for (const [key, value] of Object.entries(op.after)) merged[key] = isoToMs(key, value);
    table.set(op.entity_id, merged);
  }
}, 120_000);

afterAll(async () => {
  if (!ready) return;
  await sql.end();
  if (!accountId) return; /* beforeAll refused; its error is the verdict */
  const count = (entity: string) => state.get(entity)?.size ?? 0;
  /* the size of what was checked, so a pass is never a pass over nothing */
  console.log(
    `\nAUDIT ${target}: checked ${completed().length} completed receipts, ${count("document_line")} receipt lines, ` +
      `${count("document_tender")} payments, ${count("product")} products, ${count("stock_movement")} stock movements, ` +
      `${count("repair_ticket")} repairs, ${count("repair_line")} repair parts, ${count("used_purchase")} used purchases, ` +
      `${count("transfer")} transfers, ${count("shift")} shifts, ${count("store_credit_voucher")} vouchers`,
  );
  console.log(`AUDIT ${target}: ${findings.length === 0 ? "every screen agrees with the rebuild" : `${findings.length} disagreement(s)`}`);
  for (const f of findings.slice(0, 60)) console.log(`  - ${f}`);
});

const completed = () =>
  rows("document").filter(([, d]) => d.status === "completed" && d.completedAt !== undefined && d.completedAt !== null);

/* a window wide enough to hold any shop's whole history */
const EVERYTHING = lastDays(3650);

describe.runIf(ready)("cloud audit", () => {
  it("lists exactly the completed receipts the tills hold, with their totals", async () => {
    const listed = await documentsInPeriod(accountId, EVERYTHING, { limit: 100_000 });
    const byId = new Map(listed.map((d) => [d.id, d]));
    for (const [id, d] of completed()) {
      const shown = byId.get(id);
      if (!shown) differ("transactions", `${String(d.docNumber)} missing from the list`);
      else if (shown.totalCents !== n(d.totalCents)) {
        differ("transactions", `${String(d.docNumber)} total ${shown.totalCents} vs ${n(d.totalCents)}`);
      }
      byId.delete(id);
    }
    for (const [, extra] of byId) differ("transactions", `${extra.docNumber} listed but not completed on any till`);
  });

  it("shows every receipt's lines exactly as the till holds them", async () => {
    const lines = rows("document_line");
    for (const [id, d] of completed()) {
      const expected = lines.filter(([, l]) => l.documentId === id).map(([, l]) => l);
      const detail = await documentDetail(accountId, id);
      const shown = detail?.lines ?? [];
      const key = (qty: unknown, total: unknown, desc: unknown) => `${n(qty)}x${String(desc)}=${n(total)}`;
      const want = expected.map((l) => key(l.qty, l.totalCents, l.description)).sort().join(" | ");
      const got = shown.map((l) => key(l.qty, l.totalCents, l.description)).sort().join(" | ");
      if (want !== got) differ("receipt lines", `${String(d.docNumber)}: shown [${got}] vs till [${want}]`);

      /* the invariant that would have caught the original bug on its own */
      const sum = shown.reduce((total, l) => total + l.totalCents, 0);
      if (shown.length > 0 && sum !== n(d.totalCents)) {
        differ("receipt lines", `${String(d.docNumber)}: lines add up to ${sum}, receipt says ${n(d.totalCents)}`);
      }

      const tenders = rows("document_tender").filter(([, t]) => t.documentId === id);
      const paid = tenders.reduce((total, [, t]) => total + n(t.amountCents), 0);
      const shownPaid = (detail?.tenders ?? []).reduce((total, t) => total + n((t as unknown as Row).amountCents), 0);
      if (paid !== shownPaid) differ("payments", `${String(d.docNumber)}: shown ${shownPaid} vs till ${paid}`);
    }
  }, 300_000);

  it("totals the period the way the receipts add up", async () => {
    const totals = await periodTotals(accountId, EVERYTHING);
    const sum = completed().reduce((total, [, d]) => total + n(d.totalCents), 0);
    if (totals.current.netCents !== sum) differ("overview", `period total ${totals.current.netCents} vs receipts ${sum}`);
    if (totals.current.documents !== completed().length) {
      differ("overview", `receipt count ${totals.current.documents} vs ${completed().length}`);
    }
    const summary = await salesSummary(accountId, EVERYTHING);
    if (summary.grossCents + summary.refundsCents !== sum && summary.grossCents !== sum) {
      differ("reports", `sales summary gross ${summary.grossCents} (refunds ${summary.refundsCents}) vs receipts ${sum}`);
    }
  });

  it("counts only items actually sold in top products", async () => {
    const top = await topProducts(accountId, EVERYTHING, "es", 100_000);
    /* sales net of refunds: a refund is a second document with negative lines
       (ADR-0019), and "top products" means what the shop actually kept sold */
    const completedIds = new Set(
      completed()
        .filter(([, d]) => d.docType === "ticket" || d.docType === "refund")
        .map(([id]) => id),
    );
    const want = new Map<string, number>();
    for (const [, l] of rows("document_line")) {
      if (!completedIds.has(String(l.documentId))) continue;
      want.set(String(l.description), (want.get(String(l.description)) ?? 0) + n(l.qty));
    }
    for (const p of top) {
      const expected = want.get(p.description);
      if (expected === 0 && p.qty === 0) continue;
      if (expected === undefined) differ("top products", `"${p.description}" shown as sold, never sold`);
      else if (expected !== p.qty) differ("top products", `"${p.description}" ${p.qty} sold vs ${expected}`);
    }
  });

  it("lists the catalogue and the stock the tills hold", async () => {
    const shown = await productsForAccount(accountId);
    const byId = new Map(shown.map((p) => [p.id, p]));
    const onHand = new Map<string, number>();
    for (const [, m] of rows("stock_movement")) {
      onHand.set(String(m.productId), (onHand.get(String(m.productId)) ?? 0) + n(m.qty));
    }
    for (const [id, p] of rows("product")) {
      if (p.isDemo === true) continue;
      const row = byId.get(id);
      if (!row) {
        differ("catalogue", `"${String(p.name)}" missing`);
        continue;
      }
      if (row.priceCents !== n(p.priceCents)) differ("catalogue", `"${String(p.name)}" price ${row.priceCents} vs ${n(p.priceCents)}`);
      if (row.onHand !== (onHand.get(id) ?? 0)) differ("stock", `"${String(p.name)}" on hand ${row.onHand} vs ${onHand.get(id) ?? 0}`);
      byId.delete(id);
    }
    for (const [, extra] of byId) differ("catalogue", `"${extra.name}" listed but deleted or demo on the tills`);
  });

  it("shows every repair with its status and the parts still on it", async () => {
    const shown = await repairsForAccount(accountId);
    const byId = new Map(shown.map((r) => [r.id, r]));
    for (const [id, t] of rows("repair_ticket")) {
      const row = byId.get(id);
      if (!row) {
        differ("repairs", `ticket ${id.slice(0, 8)} missing`);
        continue;
      }
      if (t.status !== undefined && row.status !== t.status) differ("repairs", `ticket ${id.slice(0, 8)} status ${row.status} vs ${String(t.status)}`);
      const parts = rows("repair_line").filter(([, l]) => l.ticketId === id).length;
      const detail = await repairDetail(accountId, id);
      if ((detail?.lines.length ?? 0) !== parts) differ("repairs", `ticket ${id.slice(0, 8)} shows ${detail?.lines.length} part(s) vs ${parts}`);
      byId.delete(id);
    }
    for (const [id] of byId) differ("repairs", `ticket ${id.slice(0, 8)} listed but not on any till`);
  }, 300_000);

  it("lists the used purchases, the transfers and the shift closes", async () => {
    const used = await usedForAccount(accountId);
    if (used.length !== rows("used_purchase").length) differ("used", `${used.length} shown vs ${rows("used_purchase").length}`);

    const transfers = await transfersForAccount(accountId);
    const tById = new Map(transfers.map((t) => [t.id, t]));
    for (const [id, t] of rows("transfer")) {
      const row = tById.get(id);
      if (!row) differ("transfers", `${id.slice(0, 8)} missing`);
      else if (t.status !== undefined && row.status !== t.status) differ("transfers", `${id.slice(0, 8)} status ${row.status} vs ${String(t.status)}`);
    }
    if (transfers.length !== rows("transfer").length) differ("transfers", `${transfers.length} shown vs ${rows("transfer").length}`);

    const shifts = await recentShifts(accountId, EVERYTHING, 100_000);
    const closed = rows("shift").filter(([, s]) => s.closedAt !== undefined && s.closedAt !== null).length;
    if (shifts.length !== closed) differ("shifts", `${shifts.length} closes shown vs ${closed}`);
  });

  it("shows store credit as the redemption ledger says", async () => {
    const shown = await outstandingCredit(accountId);
    const spent = new Map<string, number>();
    for (const [, r] of rows("voucher_redemption")) {
      spent.set(String(r.voucherId), (spent.get(String(r.voucherId)) ?? 0) + n(r.amountCents));
    }
    for (const v of shown) {
      const voucher = state.get("store_credit_voucher")?.get(v.id);
      if (!voucher) continue;
      const remaining = spent.has(v.id) ? Math.max(0, n(voucher.amountCents) - (spent.get(v.id) ?? 0)) : n(voucher.remainingCents);
      if (v.remainingCents !== remaining) differ("store credit", `${v.id.slice(0, 8)} remaining ${v.remainingCents} vs ledger ${remaining}`);
    }
  });

  /* ----- the tills' own rules, checked from what they sent -------------- */

  it("numbers every series without a gap or a repeat", () => {
    /* ADR-0008: gap-free per series, per till. A repeat inside one shop is the
       duplicate-invoice problem two tills on one prefix would create. */
    const bySeries = new Map<string, number[]>();
    for (const [, d] of completed()) {
      const match = /^(.*?)(\d+)$/.exec(String(d.docNumber ?? ""));
      if (!match) continue;
      const list = bySeries.get(match[1]!) ?? [];
      list.push(Number(match[2]));
      bySeries.set(match[1]!, list);
    }
    for (const [prefix, numbers] of bySeries) {
      const sorted = [...numbers].sort((a, b) => a - b);
      const repeats = sorted.filter((value, i) => i > 0 && value === sorted[i - 1]);
      if (repeats.length) differ("numbering", `${prefix} repeats ${repeats.join(", ")}`);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i]! - sorted[i - 1]! > 1) differ("numbering", `${prefix} gap after ${sorted[i - 1]}`);
      }
      if (sorted[0] !== undefined && sorted[0] !== 1) differ("numbering", `${prefix} starts at ${sorted[0]}`);
    }
  });

  it("never leaves a product below zero on the shelf", () => {
    const onHand = new Map<string, number>();
    for (const [, m] of rows("stock_movement")) {
      onHand.set(String(m.productId), (onHand.get(String(m.productId)) ?? 0) + n(m.qty));
    }
    for (const [productId, qty] of onHand) {
      if (qty < 0) {
        const name = state.get("product")?.get(productId)?.name ?? productId.slice(0, 8);
        differ("stock", `"${String(name)}" is at ${qty} (two tills sold the last unit, or a movement is missing)`);
      }
    }
  });

  it("has every completed sale fully paid", () => {
    for (const [id, d] of completed()) {
      if (d.docType !== "ticket") continue;
      const paid = rows("document_tender")
        .filter(([, t]) => t.documentId === id)
        .reduce((total, [, t]) => total + n(t.amountCents), 0);
      if (paid < n(d.totalCents)) differ("payments", `${String(d.docNumber)} paid ${paid} of ${n(d.totalCents)}`);
    }
  });

  it("finds nothing to disagree about", () => {
    expect(findings).toEqual([]);
  });
});
