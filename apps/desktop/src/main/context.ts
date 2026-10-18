/**
 * Till context (meta:context, §4): tenant/location/terminal resolved once from
 * the local DB and reused by every handler as the MutationCtx for mutate().
 */
import { appError, type MetaContextResponse, type MutationCtx } from "@arkom/core";
import { asc, eq, sql } from "drizzle-orm";
import { schema, type ArkomDb } from "@arkom/db";

export interface TillContext {
  /** the rate is read live by the channel, so it is not part of the cache */
  meta: Omit<MetaContextResponse, "vatRateBp" | "printerConfigured">;
  ctx: MutationCtx;
}

let cached: TillContext | null = null;

/** First run creates the tenant, so the cached "no shop yet" answer must go. */
export function resetTillContext(): void {
  cached = null;
}

export function tillContext(db: ArkomDb): TillContext {
  if (cached) return cached;
  /*
   * Which terminal is THIS till — chosen, not "the first row".
   *
   * Until ADR-0022 a till's database held exactly one terminal, so `limit(1)`
   * was an answer. It no longer is: a till that receives a sibling's stock
   * movements stores a placeholder row for that sibling (`ensureTerminal` in
   * sync/apply.ts), and an unordered `limit(1)` returns whichever row SQLite
   * scans first. Today that is insertion order, which happens to be right —
   * proved on the pilot's machine before restarting it — but a till that took
   * another till's identity would number its receipts from nobody's series and
   * push under somebody else's name.
   *
   * The rule: this till's terminal is the one that owns number series, because
   * first-run setup creates the five series for its own terminal and nothing
   * ever creates a series for a placeholder. Earliest-created is the fallback,
   * for a database old enough to predate series. The tenant and location come
   * from that terminal's own row rather than from separate `limit(1)`s, so the
   * three can never disagree.
   */
  const terminal =
    db
      .select()
      .from(schema.terminals)
      .where(
        sql`exists (select 1 from ${schema.numberSeries} s where s.terminal_id = ${schema.terminals.id})`,
      )
      .orderBy(asc(schema.terminals.createdAt))
      .limit(1)
      .all()[0] ??
    db.select().from(schema.terminals).orderBy(asc(schema.terminals.createdAt)).limit(1).all()[0];
  const tenant = terminal
    ? db.select().from(schema.tenants).where(eq(schema.tenants.id, terminal.tenantId)).all()[0]
    : undefined;
  const location = terminal
    ? db.select().from(schema.locations).where(eq(schema.locations.id, terminal.locationId)).all()[0]
    : undefined;
  if (!tenant || !location || !terminal) {
    // a packaged install reaches this only before first-run setup completes
    throw appError("VALIDATION", "Esta caja aún no está configurada.");
  }
  cached = {
    meta: {
      tenant: { id: tenant.id, name: tenant.name },
      location: { id: location.id, name: location.name },
      terminal: { id: terminal.id, name: terminal.name },
    },
    ctx: {
      tenantId: tenant.id,
      locationId: location.id,
      terminalId: terminal.id,
      userId: null, // ADR-0010
    },
  };
  return cached;
}
