/**
 * The mutate() envelope — system-design §3, ADR-0005.
 * Every write in the app goes through here: ONE transaction wrapping the
 * business rows plus their oplog entries (before/after JSON). A build callback
 * that records no oplog entry is a bug and throws, so skipping the audit
 * trail is impossible by construction.
 *
 * core stays SQL-free (§2): the transaction and the physical oplog insert are
 * provided by the caller through a MutateRunner (drizzle-backed in the app).
 */
import { uuidv7 } from "./ids";

export interface MutationCtx {
  tenantId: string;
  locationId: string;
  terminalId: string;
  /**
   * Who did it. NULL means "pre-auth" — a row written before v0.10.0 (ADR-0010).
   * Stamped from the SESSION in main, never from anything the renderer sends
   * (ADR-0012 §5): a payload carrying a userId must not be able to change what
   * the audit trail records.
   */
  userId: string | null;
  /**
   * Who allowed it, when the actor lacked the permission and a second person
   * typed their PIN. "Ana discounted this phone" and "Ana discounted this phone
   * and Ahmer approved it" are different facts; the second settles arguments.
   */
  authorizedByUserId?: string | null;
}

/** What a mutation declares about itself. */
export interface OplogDraft {
  entity: string; // "product" | "document" | "stock_movement" | ...
  entityId: string;
  action: string; // "create" | "update" | "complete" | "park" | ...
  before: unknown; // JSON-ready snapshot or null
  after: unknown;
}

/** A finished entry, ready to be persisted in the same transaction. */
export interface OplogEntry extends OplogDraft, MutationCtx {
  opId: string; // UUIDv7 — idempotency key in the cloud (ADR-0005)
  createdAt: Date;
}

export type LogFn = (draft: OplogDraft) => void;

/** Implemented by the app over its database (drizzle/better-sqlite3 — synchronous). */
export interface MutateRunner<TTx> {
  transaction<T>(fn: (tx: TTx) => T): T;
  writeOplog(tx: TTx, entries: OplogEntry[]): void;
}

export function mutate<TTx, T>(
  runner: MutateRunner<TTx>,
  ctx: MutationCtx,
  build: (tx: TTx, log: LogFn) => T,
): T {
  return runner.transaction((tx) => {
    const createdAt = new Date();
    const entries: OplogEntry[] = [];
    const log: LogFn = (draft) => {
      entries.push({ ...draft, ...ctx, opId: uuidv7(), createdAt });
    };
    const result = build(tx, log);
    if (entries.length === 0) {
      // aborts the transaction — a write that skips the oplog is a bug, full stop
      throw new Error("mutate(): build() recorded no oplog entries (ADR-0005)");
    }
    runner.writeOplog(tx, entries);
    return result;
  });
}

/** Snapshot a row for before/after payloads: Date → epoch ms, keeps JSON-safe shape. */
export function toOplogJson(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.getTime() : v;
  return out;
}
