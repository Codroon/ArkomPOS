/**
 * The upgrade rehearsal for v0.16.0 — ADR-0019.
 *
 * Every column this release adds is additive and nullable or defaulted, which
 * is the shape of change that looks safe and is worth proving anyway: the thing
 * it lands on is the only artefact in this project that cannot be recreated.
 *
 * What matters most here is `refunded_qty`. It is `NOT NULL DEFAULT 0` on a
 * table that already has rows, so every historical sale line must come out of
 * the migration saying "nothing has been given back" — and then behave.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { uuidv7 } from "@arkom/core";
import { handlers } from "./electron-stub";
import { registerIpcHandlers } from "../ipc";
import { endSession, startSession } from "../auth/session";
import { resetTillContext } from "../context";
import { createUser } from "../auth/users";
import { openShiftTx } from "../repos/shift";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
/** the last migration a v0.15.0 install had applied */
const LAST_0150 = "0013_furry_johnny_blaze";

function migrationsAt(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "arkom-mig-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((e) => e.tag === lastTag);
  if (cut === -1) throw new Error(`no such migration: ${lastTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  for (const entry of journal.entries) copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal));
  return dir;
}

/** A till as v0.15.0 left it: a sold ticket, its lines, and a WU transfer. */
function v0150() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-up16-"));
  const { db, sqlite } = openDb(join(dir, "test.db"));
  runMigrations(db, migrationsAt(LAST_0150));

  const now = new Date();
  const ids = { tenantId: uuidv7(), locationId: uuidv7(), terminalId: uuidv7() };
  db.insert(s.tenants).values({ id: ids.tenantId, name: "Arkom", createdAt: now }).run();
  db.insert(s.locations).values({ id: ids.locationId, tenantId: ids.tenantId, name: "Tienda", createdAt: now }).run();
  db.insert(s.terminals)
    .values({ id: ids.terminalId, tenantId: ids.tenantId, locationId: ids.locationId, name: "Caja 1", createdAt: now })
    .run();

  const productId = uuidv7();
  sqlite
    .prepare(
      `insert into products (id, tenant_id, name, item_type, cost_cents, price_cents, tax_regime, tax_rate_bp,
         reorder_point, low_stock_threshold, active, is_demo, created_at, updated_at)
       values (?,?,?,?,?,?,?,?,0,0,1,0,?,?)`,
    )
    .run(productId, ids.tenantId, "Cable USB-C", "stocked", 300, 990, "IVA21", 2100, now.getTime(), now.getTime());

  const docId = uuidv7();
  const lineId = uuidv7();
  sqlite
    .prepare(
      `insert into documents (id, tenant_id, location_id, terminal_id, doc_type, status, doc_number,
         subtotal_cents, tax_cents, total_cents, created_at, completed_at)
       values (?,?,?,?,'ticket','completed','T1-000001',818,172,990,?,?)`,
    )
    .run(docId, ids.tenantId, ids.locationId, ids.terminalId, now.getTime(), now.getTime());
  sqlite
    .prepare(
      `insert into document_lines (id, tenant_id, document_id, line_no, line_type, product_id, description,
         qty, unit_price_cents, price_overridden, tax_regime, tax_rate_bp, base_cents, tax_cents, total_cents, created_at)
       values (?,?,?,1,'product',?,'Cable USB-C',1,990,0,'IVA21',2100,818,172,990,?)`,
    )
    .run(lineId, ids.tenantId, docId, productId, now.getTime());

  const transferId = uuidv7();
  sqlite
    .prepare(
      `insert into transfers (id, tenant_id, location_id, terminal_id, kind, status, mtcn, sender_name,
         receiver_name, country_code, principal_cents, fee_cents, method, shift_id, created_at, updated_at)
       values (?,?,?,?,'send','sent','1234509876','Imran','Fatima','PK',30000,500,'cash','old-shift',?,?)`,
    )
    .run(transferId, ids.tenantId, ids.locationId, ids.terminalId, now.getTime(), now.getTime());

  return { db, sqlite, ids, docId, lineId, productId, transferId };
}

let env: ReturnType<typeof v0150>;

beforeEach(() => {
  handlers.clear();
  endSession();
  resetTillContext();
  env = v0150();
});

describe("migrating a populated v0.15.0 database", () => {
  it("adds every column without disturbing a row", () => {
    const before = {
      docs: env.sqlite.prepare("select * from documents").all(),
      products: env.sqlite.prepare("select * from products").all(),
    };
    runMigrations(env.db, MIGRATIONS);

    /* the documents table gained two nullable columns, so the rows gain two
       nulls and nothing else moves */
    const after = env.sqlite.prepare("select * from documents").all() as Record<string, unknown>[];
    expect(after).toHaveLength(1);
    expect(after[0]!.refunds_document_id).toBeNull();
    expect(after[0]!.refund_reason).toBeNull();
    expect(after[0]!.total_cents).toBe((before.docs[0] as Record<string, unknown>).total_cents);
    expect(env.sqlite.prepare("select * from products").all()).toEqual(before.products);
    expect(env.sqlite.prepare("pragma foreign_key_check").all()).toEqual([]);
  });

  it("says nothing has been refunded on every historical line", () => {
    runMigrations(env.db, MIGRATIONS);
    const line = env.db.select().from(s.documentLines).where(eq(s.documentLines.id, env.lineId)).all()[0]!;
    /* NOT NULL DEFAULT 0 on a populated table: every line sold before today
       must read "nothing given back", not null and not one */
    expect(line.refundedQty).toBe(0);
    expect(line.refundsLineId).toBeNull();
  });

  it("marks every existing transfer unverified rather than verified", () => {
    runMigrations(env.db, MIGRATIONS);
    const row = env.db.select().from(s.transfers).where(eq(s.transfers.id, env.transferId)).all()[0]!;
    /* the honest default: nobody has checked these against WU's terminal, and
       a migration must not claim somebody did (ADR-0019) */
    expect(row.verification).toBe("unverified");
    expect(row.verifiedByUserId).toBeNull();
    expect(row.verifiedAt).toBeNull();
  });

  it("refunds a ticket that was sold before the feature existed", async () => {
    runMigrations(env.db, MIGRATIONS);
    const ctx = { ...env.ids, userId: null as string | null };
    const owner = createUser(env.db, ctx, { name: "Ahmer", role: "owner", pin: "8317" }).user;
    openShiftTx(env.db, { ...ctx, userId: owner.id }, { floatCents: 20000, breakdown: null });
    registerIpcHandlers(env.db);
    startSession({ id: owner.id, name: "Ahmer", role: "owner", overrides: {} });

    const res = (await handlers.get("refund:create")!({}, {
      documentId: env.docId,
      reason: "Devolución de un ticket antiguo",
      method: "cash",
      lines: [{ lineId: env.lineId, qty: 1, restock: true }],
    })) as { docNumber: string; totalCents: number };

    expect(res.docNumber).toBe("D1-000001");
    expect(res.totalCents).toBe(-990);
    expect(env.db.select().from(s.documentLines).where(eq(s.documentLines.id, env.lineId)).all()[0]!.refundedQty).toBe(1);
  });
});
