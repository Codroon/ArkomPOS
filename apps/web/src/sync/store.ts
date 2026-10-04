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
import type { SyncOp, SyncPulledOp } from "@arkom/core";

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
  | {
      ok: true;
      deviceToken: string;
      accountName: string;
      shopName: string;
      /**
       * The keys the till must use from here on — ADR-0022 §9.
       *
       * Not necessarily the ones it sent. This is the field that fixes the
       * two-shops bug: before, the till named its own tenant and the cloud
       * wrote it down, so a second install founded a second shop. Now an
       * account's second till is handed the FIRST till's tenant and location.
       */
      tenantId: string;
      locationId: string;
      /** true when this till joined a shop that already existed */
      adopted: boolean;
      /** how many tills the shop has now, so Ajustes can say "caja 2 de 3" */
      tillCount: number;
    }
  /** unknown, spent or expired — one answer for all three, deliberately */
  | { ok: false; reason: "code" }
  /** this shop already belongs to a different account; nobody may adopt it */
  | { ok: false; reason: "tenant" }
  /**
   * The account has more than one shop, so "join the shop" has no answer.
   *
   * This is Arkom's present state, created by the very bug ADR-0022 fixes, and
   * the right response is to refuse rather than to guess: picking the tenant
   * with the most rows would silently strand the other one's history. Resolving
   * it is a deliberate operator path (ADR-0022 §9), done once, by someone who
   * can see both shops.
   */
  | { ok: false; reason: "ambiguous"; tenantIds: readonly string[] };

/* ----------------------------------------------------------------- pulling */

export interface PullInput {
  device: DeviceRow;
  /** serve entries ingested strictly after this */
  afterIngestSeq: number;
  limit: number;
  /** the shop's entities, from `SHARED_ENTITIES` — the store does not decide */
  entities: readonly string[];
  /**
   * Only rows received before this instant may be served — ADR-0022 §4.
   *
   * `ingest_seq` is taken when a row is written and becomes visible when its
   * transaction commits, so two concurrent ingests can commit out of order and
   * a naive cursor would step over the lower one forever.
   */
  settleBefore: Date;
}

export interface PullResult {
  entries: SyncPulledOp[];
  /**
   * The cursor the till should store.
   *
   * The STORE states it rather than letting the till take `max(ingestSeq)` of
   * the batch, because only the store knows whether the batch was truncated by
   * `limit`. When it was not, the cursor jumps to the settled frontier — every
   * row up to there has been examined and the ones not returned were somebody
   * else's business — so a shop with one till does not rescan its own stream
   * on every tick.
   *
   * The consequence, stated because it is the only sharp edge: a cursor is only
   * valid for the entity list that was in force when it moved. Widening
   * `SHARED_ENTITIES` later means resetting a till's cursor to 0 to backfill,
   * which is safe because applying is idempotent by `op_id`.
   */
  cursor: number;
  /** more settled rows are waiting; the till drains rather than sleeping */
  more: boolean;
}

export interface CloudStore {
  /** Hashes the token itself; the raw value never reaches a column. */
  deviceByToken(token: string): Promise<DeviceRow | null>;
  recordBatch(input: RecordBatchInput): Promise<RecordBatchResult>;
  enrol(input: EnrolInput): Promise<EnrolOutcome>;
  /**
   * The entries this till's SIBLINGS wrote — ADR-0022 §2.
   *
   * Reads and returns; it does not compute, merge or decide. Every row it
   * serves was written by one of this shop's own tills, which is what keeps
   * "the cloud never authors" true while the data moves both ways.
   */
  pullBatch(input: PullInput): Promise<PullResult>;
  /** ADR-0020 §4: a feature, not a support ticket answered with SQL. */
  deleteTenant(tenantId: string): Promise<{ entries: number; devices: number }>;
}
