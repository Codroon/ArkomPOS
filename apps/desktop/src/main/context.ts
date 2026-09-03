/**
 * Till context (meta:context, §4): tenant/location/terminal resolved once from
 * the local DB and reused by every handler as the MutationCtx for mutate().
 */
import { appError, type MetaContextResponse, type MutationCtx } from "@arkom/core";
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
  const tenant = db.select().from(schema.tenants).limit(1).all()[0];
  const location = db.select().from(schema.locations).limit(1).all()[0];
  const terminal = db.select().from(schema.terminals).limit(1).all()[0];
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
