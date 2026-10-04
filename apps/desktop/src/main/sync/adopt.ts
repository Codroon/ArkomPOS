/**
 * Joining a shop that already exists — ADR-0022 §9.
 *
 * The missing path, and the whole reason Arkom's dashboard showed two shops.
 * First run asks a till who it is and mints `tenantId`/`locationId`, so a
 * second install founded a second business and the up-only sync carried both
 * upward, faithfully and forever apart.
 *
 * What this does, when the cloud answers an enrolment with keys that are not
 * the ones the till offered:
 *
 *  1. **Refuses if the till has sold anything.** Merging two fiscal histories
 *     is not something a wizard should attempt while somebody waits at a
 *     counter. A till with documents, shifts, purchases or repairs is a
 *     `TILL_HAS_HISTORY` refusal and a deliberate operator job.
 *  2. **Discards the shop it invented.** Not its settings and not its staff —
 *     its PRINTER is a setting and its PINs are its own authority (§1) — but
 *     the product groups, catalogue and ledger of a business that never traded.
 *     Keeping them would leave the till with twelve product groups: its own six
 *     and the shop's six.
 *  3. **Rewrites the identity keys** onto every row that carries them, derived
 *     from the schema rather than from a list in this file.
 *  4. **Parks the pre-join oplog instead of deleting it.** The oplog is
 *     append-only (ADR-0005) and those entries are true: this machine really was
 *     set up as its own shop before it joined one. They must simply never be
 *     PUSHED, or the cloud would receive six phantom product groups and a shop
 *     that does not exist. Advancing the push cursor past them does exactly
 *     that, and keeps the local audit trail whole.
 */
import { getTableColumns, getTableName, sql } from "drizzle-orm";
import { appError } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";

/**
 * Tables whose contents belong to the SHOP and will be pulled fresh.
 *
 * Deleted in reverse dependency order, which is child-first: a `product_code`
 * references a product, so the product cannot go until the code has.
 * `product_stock` is included because it is a cache of movements that are about
 * to be deleted, and `db:audit` would otherwise be right to complain.
 */
const DISCARD_IN_ORDER = [
  schema.productStock,
  schema.stockMovements,
  schema.productCodes,
  schema.units,
  schema.products,
  schema.productGroups,
  schema.suppliers,
  schema.customers,
] as const;

/**
 * What makes a till's history too real to discard.
 *
 * Deliberately broader than "has it sold something": a parked repair means a
 * customer's phone is in the drawer, and a float means somebody counted the
 * money. Any of these and the answer is a person, not a wizard.
 */
const HISTORY_TABLES = [
  { name: "documents", table: schema.documents },
  { name: "shifts", table: schema.shifts },
  { name: "cash_movements", table: schema.cashMovements },
  { name: "used_purchases", table: schema.usedPurchases },
  { name: "repair_tickets", table: schema.repairTickets },
] as const;

/**
 * Tables the identity rewrite leaves alone, and why each one matters.
 *
 * **`tenants` / `locations`** — their own `id` is the thing being moved TO, and
 * the old rows are removed in step 4.
 *
 * **`oplog`** — this is the subtle one, and getting it wrong produced a very
 * confusing bug. Those entries are TRUE: this machine really was set up as its
 * own shop on Tuesday. Rewriting the `tenant_id` column leaves the `after`
 * payload still naming the old tenant, so the row becomes a self-contradicting
 * record — and worse, it becomes a row the cloud's ingest would ACCEPT (the
 * column matches the device's tenant) and hand to this shop's other tills,
 * which would then try to insert a product group belonging to a tenant that
 * does not exist. Left alone, the entries stay honest, and the parked push
 * cursor is what keeps them off the wire.
 *
 * **`sync_inbox`** — other tills' decisions, keyed by `op_id` and already
 * carrying the shop's ids. Nothing here is this till's to renumber.
 */
const SKIP_REWRITE = new Set(["tenants", "locations", "oplog", "sync_inbox"]);

export interface AdoptionTarget {
  tenantId: string;
  locationId: string;
  shopName: string;
}

/** What the till had before it joined, for the log line and the Ajustes card. */
export interface AdoptionResult {
  fromTenantId: string;
  toTenantId: string;
  discarded: number;
  /** the oplog seq the push cursor was parked at */
  parkedAtSeq: number;
}

/** Every table in the schema that carries the column, found rather than listed. */
function tablesWith(column: "tenantId" | "locationId"): { name: string; table: object }[] {
  const out: { name: string; table: object }[] = [];
  for (const [name, table] of Object.entries(schema)) {
    if (!table || typeof table !== "object") continue;
    try {
      const columns = getTableColumns(table as never) as Record<string, unknown>;
      if (column in columns) out.push({ name, table: table as object });
    } catch {
      /* not a drizzle table — the schema module also exports helpers */
    }
  }
  return out;
}

/**
 * Would this till survive joining a shop?
 *
 * Checked BEFORE the code is spent, so a refusal costs the owner nothing.
 */
export function describeHistory(db: ArkomDb): { has: boolean; where: string[] } {
  const where: string[] = [];
  for (const { name, table } of HISTORY_TABLES) {
    const row = db
      .select({ n: sql<number>`count(*)` })
      .from(table as never)
      .all()[0] as { n: number } | undefined;
    if (Number(row?.n ?? 0) > 0) where.push(name);
  }
  return { has: where.length > 0, where };
}

/**
 * Adopt the shop's keys. One transaction: either this till is in the shop or it
 * is exactly as it was.
 */
export function adopt(db: ArkomDb, current: { tenantId: string; locationId: string }, target: AdoptionTarget): AdoptionResult {
  const history = describeHistory(db);
  if (history.has) {
    throw appError(
      "VALIDATION",
      `Esta caja ya tiene historial (${history.where.join(", ")}). ` +
        "Para unirla a una tienda existente hace falta ayuda: nada se va a borrar automáticamente.",
    );
  }

  if (current.tenantId === target.tenantId && current.locationId === target.locationId) {
    return { fromTenantId: current.tenantId, toTenantId: target.tenantId, discarded: 0, parkedAtSeq: 0 };
  }

  const parkedAtSeq = Number(
    db.select({ seq: sql<number>`coalesce(max(seq), 0)` }).from(schema.oplog).all()[0]?.seq ?? 0,
  );

  let discarded = 0;

  db.transaction((tx) => {
    /* 1. the shop this till invented, child-first */
    for (const table of DISCARD_IN_ORDER) {
      const result = tx.delete(table as never).run();
      discarded += Number(result.changes ?? 0);
    }

    /* 2. the adopted parents have to exist before anything can point at them */
    tx.insert(schema.tenants)
      .values({ id: target.tenantId, name: target.shopName, createdAt: new Date() })
      .onConflictDoNothing()
      .run();

    const location = tx.select().from(schema.locations).all()[0];
    tx.insert(schema.locations)
      .values({
        ...location,
        id: target.locationId,
        tenantId: target.tenantId,
      } as never)
      .onConflictDoNothing()
      .run();

    /*
     * 3. the rewrite. Raw SQL on purpose: this touches every table that carries
     * the column, including ones added after this file was written, and a
     * drizzle update per table would be a list to forget something from.
     *
     * `SKIP_REWRITE` says what is left alone and why.
     *
     * The table NAME is an identifier from our own schema; the ids are BOUND
     * parameters, because they arrived in an HTTP response and a key that
     * reaches a statement unparameterised is a key that can carry a statement.
     */
    for (const { table } of tablesWith("tenantId")) {
      const name = getTableName(table as never);
      if (SKIP_REWRITE.has(name)) continue;
      tx.run(
        sql`update ${sql.identifier(name)} set tenant_id = ${target.tenantId} where tenant_id = ${current.tenantId}`,
      );
    }
    for (const { table } of tablesWith("locationId")) {
      const name = getTableName(table as never);
      if (SKIP_REWRITE.has(name)) continue;
      tx.run(
        sql`update ${sql.identifier(name)} set location_id = ${target.locationId} where location_id = ${current.locationId}`,
      );
    }

    /* 4. the shop that never traded, now that nothing points at it */
    if (current.locationId !== target.locationId) {
      tx.run(sql`delete from ${sql.identifier("locations")} where id = ${current.locationId}`);
    }
    if (current.tenantId !== target.tenantId) {
      tx.run(sql`delete from ${sql.identifier("tenants")} where id = ${current.tenantId}`);
    }
  });

  return {
    fromTenantId: current.tenantId,
    toTenantId: target.tenantId,
    discarded,
    parkedAtSeq,
  };
}
