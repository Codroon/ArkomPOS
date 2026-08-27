/**
 * Drizzle/better-sqlite3 implementation of core's MutateRunner port (§3):
 * one synchronous SQLite transaction; oplog rows persisted inside it.
 * No business rules here — core's mutate() owns the envelope discipline.
 */
import { schema, type ArkomDb } from "@arkom/db";
import type { MutateRunner, OplogEntry } from "@arkom/core";

/** The transaction handle drizzle passes to better-sqlite3 transaction callbacks. */
export type DbTx = Parameters<Parameters<ArkomDb["transaction"]>[0]>[0];

export function makeMutateRunner(db: ArkomDb): MutateRunner<DbTx> {
  return {
    transaction: (fn) => db.transaction((tx) => fn(tx)),
    writeOplog: (tx, entries: OplogEntry[]) => {
      for (const e of entries) {
        tx.insert(schema.oplog)
          .values({
            opId: e.opId,
            tenantId: e.tenantId,
            locationId: e.locationId,
            terminalId: e.terminalId,
            entity: e.entity,
            entityId: e.entityId,
            action: e.action,
            before: e.before ?? null,
            after: e.after ?? null,
            userId: e.userId,
            authorizedByUserId: e.authorizedByUserId ?? null,
            createdAt: e.createdAt,
          })
          .run();
      }
    },
  };
}
