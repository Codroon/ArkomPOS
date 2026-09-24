/**
 * The till's outbox — ADR-0005 mechanism, ADR-0020 rules.
 *
 * It reads the oplog past its cursor, redacts, pushes a batch, and advances the
 * cursor only on an ack. Everything else here exists to honour one sentence
 * from ADR-0001: **the till never waits on the network.** Nothing in this file
 * is awaited by a screen, a sale or a shutdown; every failure is recorded and
 * retried later, and the shop is told in Ajustes rather than in a dialog.
 *
 * Replay is free: rows carry the `opId` the cloud deduplicates on, so a lost
 * cursor, a killed process or a half-delivered batch all cost one repeated
 * push and nothing else.
 */
import { app } from "electron";
import { and, asc, gt } from "drizzle-orm";
import {
  prepareBatch,
  SyncPushResponseSchema,
  SYNC_BATCH_SIZE,
  type SyncableOplogRow,
} from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { patchLink, readLink, type CloudLink } from "./link";

const { oplog } = schema;

/** How often a linked till looks for something to send. */
const INTERVAL_MS = 60_000;
/** After a failure, wait longer each time — up to this. */
const MAX_BACKOFF_MS = 15 * 60_000;
/** A push that has not answered by now is a push on a line that is not there. */
const TIMEOUT_MS = 20_000;
/**
 * How many batches one drain may send before handing back to the timer.
 *
 * A shop that was offline for a week has thousands of rows waiting, and one
 * batch per minute would take most of the morning to clear. A drain keeps going
 * while there is more; the cap is politeness, not correctness — whatever is
 * left goes on the next round a minute later.
 */
const MAX_DRAIN_ROUNDS = 50;

export interface SyncStatus {
  linked: boolean;
  url: string | null;
  accountName: string;
  shopName: string;
  /** rows this till has written that the cloud has not acked */
  pending: number;
  lastAckedSeq: number;
  lastPushAtMs: number | null;
  lastError: string | null;
  pushing: boolean;
}

let timer: ReturnType<typeof setInterval> | null = null;
let backoffUntil = 0;
let pushing = false;

/** Rows waiting to go, oldest first. */
function unsentRows(db: ArkomDb, link: CloudLink): SyncableOplogRow[] {
  return db
    .select()
    .from(oplog)
    .where(and(gt(oplog.seq, link.lastAckedSeq)))
    .orderBy(asc(oplog.seq))
    .limit(SYNC_BATCH_SIZE)
    .all()
    .map((r) => ({
      seq: r.seq,
      opId: r.opId,
      tenantId: r.tenantId,
      locationId: r.locationId,
      terminalId: r.terminalId,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      before: r.before,
      after: r.after,
      userId: r.userId,
      authorizedByUserId: r.authorizedByUserId,
      createdAt: r.createdAt,
    }));
}

export function pendingCount(db: ArkomDb): number {
  const link = readLink();
  if (!link) return 0;
  return db
    .select()
    .from(oplog)
    .where(gt(oplog.seq, link.lastAckedSeq))
    .all().length;
}

export function syncStatus(db: ArkomDb): SyncStatus {
  const link = readLink();
  return {
    linked: link !== null,
    url: link?.url ?? null,
    accountName: link?.accountName ?? "",
    shopName: link?.shopName ?? "",
    pending: link ? pendingCount(db) : 0,
    lastAckedSeq: link?.lastAckedSeq ?? 0,
    lastPushAtMs: link?.lastPushAtMs ?? null,
    lastError: link?.lastError ?? null,
    pushing,
  };
}

/**
 * One round. Returns what happened, and NEVER throws — a caller that awaited it
 * is a bug waiting for a shop with no internet, so there is nothing to catch.
 */
export async function pushOnce(db: ArkomDb, { force = false } = {}): Promise<SyncStatus> {
  const link = readLink();
  if (!link || pushing) return syncStatus(db);
  if (!force && Date.now() < backoffUntil) return syncStatus(db);

  const rows = unsentRows(db, link);
  if (rows.length === 0) {
    patchLink({ lastPushAtMs: Date.now(), lastError: null });
    return syncStatus(db);
  }

  pushing = true;
  try {
    const ops = prepareBatch(rows);
    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(new URL("/api/sync", link.url).toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${link.deviceToken}`,
        },
        body: JSON.stringify({
          tenantId: link.tenantId,
          terminalId: link.terminalId,
          appVersion: app.getVersion(),
          ops,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(cancel);
    }

    if (!response.ok) {
      /* 401/403 means the account revoked this till: stop trying on a timer and
         say so, because retrying a revoked token forever helps nobody. */
      const fatal = response.status === 401 || response.status === 403;
      fail(`HTTP ${response.status}`, fatal);
      return syncStatus(db);
    }

    const ack = SyncPushResponseSchema.parse(await response.json());
    patchLink({
      lastAckedSeq: Math.max(link.lastAckedSeq, ack.ackedSeq),
      lastPushAtMs: Date.now(),
      lastError: null,
    });
    backoffUntil = 0;
    return syncStatus(db);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), false);
    return syncStatus(db);
  } finally {
    pushing = false;
  }
}

/** Record the failure, back off, and carry on selling. */
function fail(message: string, fatal: boolean): void {
  const link = readLink();
  const waited = Math.max(INTERVAL_MS, backoffUntil - Date.now());
  backoffUntil = Date.now() + (fatal ? MAX_BACKOFF_MS : Math.min(waited * 2, MAX_BACKOFF_MS));
  if (link) patchLink({ lastError: message, lastPushAtMs: Date.now() });
}

/**
 * Send everything that is waiting, not just the first batch.
 *
 * `pushOnce` deliberately sends ONE batch, because a batch that fails should be
 * cheap to retry. That makes it the wrong thing to hang a timer off on its own:
 * a till back from a day offline would drain at one batch a minute. So the
 * timer calls this, which keeps going while the queue is shrinking and stops
 * the moment it is not — on an error, on an empty queue, or on a round that
 * made no progress, which would otherwise be a loop.
 *
 * Never throws, for the same reason `pushOnce` does not.
 */
export async function pushAll(db: ArkomDb, { force = false } = {}): Promise<SyncStatus> {
  let status = await pushOnce(db, { force });
  for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
    if (!status.linked || status.pending === 0 || status.lastError) break;
    const before = status.pending;
    status = await pushOnce(db);
    if (status.pending >= before) break; // no progress: leave it to the timer
  }
  return status;
}

/** Start the background loop. Safe to call on a till that is not linked. */
export function startSync(db: ArkomDb): void {
  if (timer) return;
  timer = setInterval(() => {
    void pushAll(db).catch(() => undefined);
  }, INTERVAL_MS);
  // the first round soon after boot, not instantly: the till has a window to draw
  setTimeout(() => void pushAll(db).catch(() => undefined), 10_000);
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test seam: forget the backoff between cases. */
export function resetSyncState(): void {
  backoffUntil = 0;
  pushing = false;
}
