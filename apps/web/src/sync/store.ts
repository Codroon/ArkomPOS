/**
 * The port between the ingest rules and Postgres.
 *
 * The rules — who may write, whose stream this is, what gets acked — are pure
 * and live in `ingest.ts` and `enrol.ts`. Everything that needs a database to
 * be *atomic* lives behind this interface: spending a code exactly once,
 * appending a batch without duplicating it, deleting a tenant completely.
 *
 * Two implementations: `pg-store.ts` (Neon) and the in-memory one the tests
 * use. The tests are therefore about the rules, not about having a Postgres,
 * and they run in CI beside the till's.
 */
import type { SyncOp } from "@arkom/core";

/** What a token buys: one till, one tenant's stream. */
export interface DeviceRow {
  id: string;
  accountId: string;
  tenantId: string;
  locationId: string;
  terminalId: string;
  /** set means the account cut this till off; ingestion stops, selling does not */
  revokedAt: Date | null;
  /** the cloud's own copy of the cursor — display and empty-push acks only */
  lastAckedSeq: number;
}

export interface RecordBatchInput {
  device: DeviceRow;
  ops: readonly SyncOp[];
  appVersion: string;
  now: Date;
}

export interface RecordBatchResult {
  /** rows that were new to us */
  stored: number;
  /** rows we already had — reported, never an error (ADR-0005) */
  duplicates: number;
  /**
   * The highest `seq` now durably stored FROM THIS BATCH.
   *
   * Not the device's stored cursor: a till that re-enrols replays from zero,
   * and answering it with a cursor from before the replay would make it skip
   * everything in between. What we stored is what we may ack.
   *
   * A batch with no rows in it acks the device's stored cursor, which is the
   * only safe value available and can never be ahead of what that till sent.
   */
  ackedSeq: number;
}

export interface EnrolInput {
  /** as the owner typed it, already normalised by {@link EnrolCodeSchema} */
  code: string;
  tenantId: string;
  locationId: string;
  terminalId: string;
  terminalName: string;
  shopName: string;
  appVersion: string;
  now: Date;
}

export type EnrolOutcome =
  | { ok: true; deviceToken: string; accountName: string; shopName: string }
  /** unknown, spent or expired — one answer for all three, deliberately */
  | { ok: false; reason: "code" }
  /** this shop already belongs to a different account; nobody may adopt it */
  | { ok: false; reason: "tenant" };

export interface CloudStore {
  /** Hashes the token itself; the raw value never reaches a column. */
  deviceByToken(token: string): Promise<DeviceRow | null>;
  recordBatch(input: RecordBatchInput): Promise<RecordBatchResult>;
  enrol(input: EnrolInput): Promise<EnrolOutcome>;
  /** ADR-0020 §4: a feature, not a support ticket answered with SQL. */
  deleteTenant(tenantId: string): Promise<{ entries: number; devices: number }>;
}
