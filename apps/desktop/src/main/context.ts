/**
 * Till context (meta:context, §4): tenant/location/terminal resolved once from
 * the local DB and reused by every handler as the MutationCtx for mutate().
 */
import { appError, type MetaContextResponse, type MutationCtx } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";

export interface TillContext {
  meta: MetaContextResponse;
  ctx: MutationCtx;
}

let cached: TillContext | null = null;

export function tillContext(db: ArkomDb): TillContext {
  if (cached) return cached;
  const tenant = db.select().from(schema.tenants).limit(1).all()[0];
  const location = db.select().from(schema.locations).limit(1).all()[0];
  const terminal = db.select().from(schema.terminals).limit(1).all()[0];
  if (!tenant || !location || !terminal) {
    throw appError("VALIDATION", "Base de datos vacía — ejecuta `pnpm db:seed`.");
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
