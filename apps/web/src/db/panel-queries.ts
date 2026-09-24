/**
 * What the owner's panel reads.
 *
 * Every query in this file takes an `accountId` and scopes on it. That is the
 * isolation, today — one account can only ever see its own shops (ADR-0009;
 * Postgres RLS is the second lock, added when tenant #2 arrives). Any query
 * added here without that WHERE clause is a data leak, so there is no helper
 * that makes it optional.
 *
 * Aggregation is SQL, never a loop in a page. Summing rows in a component would
 * be a second implementation of the money — the same rule ADR-0016 §3 sets for
 * the till's own reports.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db as defaultDb, type CloudDb } from "./client";
import { devices, syncEntries, tenants } from "./schema";

export interface ShopSummary {
  id: string;
  name: string;
  lastSeenAt: Date | null;
  tills: number;
  rows: number;
}

export async function shopsForAccount(accountId: string, handle?: CloudDb): Promise<ShopSummary[]> {
  const db = handle ?? defaultDb();
  return db
    .select({
      id: tenants.id,
      name: tenants.name,
      lastSeenAt: tenants.lastSeenAt,
      tills: sql<number>`(
        select count(*)::int from ${devices} where ${devices.tenantId} = ${tenants.id}
      )`,
      rows: sql<number>`(
        select count(*)::int from ${syncEntries} where ${syncEntries.tenantId} = ${tenants.id}
      )`,
    })
    .from(tenants)
    .where(eq(tenants.accountId, accountId))
    .orderBy(desc(tenants.lastSeenAt));
}

export interface TillSummary {
  id: string;
  shop: string;
  terminalName: string;
  appVersion: string;
  lastPushAt: Date | null;
  lastAckedSeq: number;
  revoked: boolean;
}

export async function tillsForAccount(accountId: string, handle?: CloudDb): Promise<TillSummary[]> {
  const db = handle ?? defaultDb();
  const rows = await db
    .select({
      id: devices.id,
      shop: tenants.name,
      terminalName: devices.terminalName,
      appVersion: devices.appVersion,
      lastPushAt: devices.lastPushAt,
      lastAckedSeq: devices.lastAckedSeq,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .innerJoin(tenants, eq(tenants.id, devices.tenantId))
    .where(and(eq(devices.accountId, accountId)))
    .orderBy(desc(devices.lastPushAt));

  return rows.map(({ revokedAt, ...rest }) => ({ ...rest, revoked: revokedAt !== null }));
}
