/**
 * The till's inbox — ADR-0022 §2–6.
 *
 * The other direction, and the mirror of `push.ts` in every way that matters:
 * nothing here is awaited by a screen, a sale or a shutdown; `pullOnce()` does
 * not throw; a failure is recorded, backed off and retried; and the cursor
 * moves only on an answer the till could parse. **The counter never waits on
 * the cloud** (ADR-0001) is not weakened by data arriving as well as leaving.
 *
 * Two jobs, deliberately separate (§5):
 *
 *   **fetch** writes what arrived into `sync_inbox` and moves the cursor. It
 *   does not touch a business table, so it cannot fail on a foreign key.
 *
 *   **apply** drains the inbox in dependency order and retries what it could
 *   not land. An entry that arrives before its parent is early, not broken.
 *
 * Splitting them is what makes out-of-order arrival a non-event. The cloud
 * serves rows in the order it ingested them, which is the order five tills
 * happened to push — not the order SQLite's foreign keys will accept.
 */
import { app } from "electron";
import { SyncPullResponseSchema, SYNC_PULL_LIMIT } from "@arkom/core";
import { schema, type ArkomDb } from "@arkom/db";
import { isNull, sql } from "drizzle-orm";
import { patchLink, readLink } from "./link";
import { applyInbox, type ApplyResult } from "./apply";

const { syncInbox } = schema;

/**
 * How often a linked till asks what the others did.
 *
 * Much shorter than the push's minute. The asymmetry is the point: a push is
 * this till telling the cloud something nobody is waiting for, while a pull is
 * this till finding out that the phone on the shelf was sold at the other
 * counter. Fifteen seconds plus the five-second settle window (§4) means a
 * stock figure is right everywhere inside half a minute, which is faster than
 * two people can walk between two counters.
 */
const INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;
/** A till back from a week off has thousands waiting; politeness, not correctness. */
const MAX_DRAIN_ROUNDS = 40;

export interface ReceiveStatus {
  /** rows in the inbox this till has not yet believed */
  pending: number;
  /** rows that have been tried and keep failing — a diagnostic, not an alarm */
  stuck: number;
  lastPullAtMs: number | null;
  lastPulledIngestSeq: number;
  lastError: string | null;
  /** the cloud's clock minus ours, so a wrong clock is visible (§7) */
  clockSkewMs: number | null;
  pulling: boolean;
}

let timer: ReturnType<typeof setInterval> | null = null;
let backoffUntil = 0;
let pulling = false;
let clockSkewMs: number | null = null;

/** Rows tried this many times and still pending are reported separately. */
const STUCK_AFTER = 5;

export function receiveStatus(db: ArkomDb): ReceiveStatus {
  const link = readLink();
  const counts = db
    .select({
      pending: sql<number>`count(*)`,
      stuck: sql<number>`sum(case when attempts >= ${STUCK_AFTER} then 1 else 0 end)`,
    })
    .from(syncInbox)
    .where(isNull(syncInbox.appliedAt))
    .all()[0];

  return {
    pending: Number(counts?.pending ?? 0),
    stuck: Number(counts?.stuck ?? 0),
    lastPullAtMs: link?.lastPullAtMs ?? null,
    lastPulledIngestSeq: link?.lastPulledIngestSeq ?? 0,
    lastError: link?.lastPullError ?? null,
    clockSkewMs,
    pulling,
  };
}

/**
 * One round: ask, store, move the cursor, then apply.
 *
 * NEVER throws. A caller that awaited this hoping to catch something is a bug
 * waiting for a shop whose router is off, so there is nothing to catch.
 */
export async function pullOnce(
  db: ArkomDb,
  { force = false } = {},
): Promise<ReceiveStatus & { fetched: number; more: boolean; apply: ApplyResult | null }> {
  const link = readLink();
  const idle = { fetched: 0, more: false, apply: null };
  if (!link || pulling) return { ...receiveStatus(db), ...idle };
  if (!force && Date.now() < backoffUntil) return { ...receiveStatus(db), ...idle };

  pulling = true;
  try {
    const url = new URL("/api/sync/pull", link.url);
    url.searchParams.set("tenantId", link.tenantId);
    url.searchParams.set("terminalId", link.terminalId);
    url.searchParams.set("appVersion", app.getVersion());
    url.searchParams.set("afterIngestSeq", String(link.lastPulledIngestSeq ?? 0));
    url.searchParams.set("limit", String(SYNC_PULL_LIMIT));

    const controller = new AbortController();
    const cancel = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${link.deviceToken}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(cancel);
    }

    if (!response.ok) {
      /*
       * A 404 is not a failure worth backing off hard on: it means the cloud
       * this till is pointed at predates ADR-0022 and serves no pull route. The
       * till keeps pushing and keeps selling, which is exactly what it did
       * before this file existed.
       */
      if (response.status === 404) {
        patchLink({ lastPullAtMs: Date.now(), lastPullError: null });
        backoffUntil = Date.now() + MAX_BACKOFF_MS;
        return { ...receiveStatus(db), ...idle };
      }
      const fatal = response.status === 401 || response.status === 403;
      fail(`HTTP ${response.status}`, fatal);
      return { ...receiveStatus(db), ...idle };
    }

    const batch = SyncPullResponseSchema.parse(await response.json());
    clockSkewMs = batch.serverTimeMs - Date.now();

    /*
     * Stored and the cursor moved in ONE transaction. A crash between the two
     * would either lose rows (cursor moved, rows not written) or replay them
     * — and only one of those is safe, so neither is left to chance. The insert
     * ignores an opId we already hold, which is what makes a cursor reset a
     * valid way to backfill (§5).
     */
    const receivedAt = new Date();
    if (batch.entries.length > 0) {
      db.transaction((tx) => {
        for (const entry of batch.entries) {
          tx.insert(syncInbox)
            .values({
              opId: entry.opId,
              ingestSeq: entry.ingestSeq,
              tenantId: entry.tenantId,
              locationId: entry.locationId,
              terminalId: entry.terminalId,
              entity: entry.entity,
              entityId: entry.entityId,
              action: entry.action,
              before: entry.before ?? null,
              after: entry.after ?? null,
              userId: entry.userId,
              authorizedByUserId: entry.authorizedByUserId,
              createdAt: new Date(entry.createdAtMs),
              receivedAt,
            })
            .onConflictDoNothing()
            .run();
        }
      });
    }

    patchLink({
      lastPulledIngestSeq: Math.max(link.lastPulledIngestSeq ?? 0, batch.cursor),
      lastPullAtMs: Date.now(),
      lastPullError: null,
    });
    backoffUntil = 0;

    /* and now believe it — in its own pass, outside the transaction above */
    const applied = applyInbox(db);

    return {
      ...receiveStatus(db),
      fetched: batch.entries.length,
      more: batch.more,
      apply: applied,
    };
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), false);
    return { ...receiveStatus(db), ...idle };
  } finally {
    pulling = false;
  }
}

function fail(message: string, fatal: boolean): void {
  const waited = Math.max(INTERVAL_MS, backoffUntil - Date.now());
  backoffUntil = Date.now() + (fatal ? MAX_BACKOFF_MS : Math.min(waited * 2, MAX_BACKOFF_MS));
  if (readLink()) patchLink({ lastPullError: message, lastPullAtMs: Date.now() });
}

/**
 * Drain everything waiting, not just the first page.
 *
 * Same shape and same reasoning as `pushAll`: one page is the right unit to
 * retry and the wrong unit to hang a timer off. Stops on an error, on an empty
 * answer, or on a round that made no progress — which would otherwise be a loop.
 */
export async function pullAll(db: ArkomDb, { force = false } = {}): Promise<ReceiveStatus> {
  let result = await pullOnce(db, { force });
  for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
    if (result.lastError || !result.more) break;
    const before = result.lastPulledIngestSeq;
    result = await pullOnce(db);
    if (result.lastPulledIngestSeq <= before) break;
  }

  /*
   * One more apply pass even when nothing arrived.
   *
   * This is what makes a deferral self-healing: a row that was early last time
   * has its parent now, and nobody has to notice. Without it, an orphan would
   * wait for the next batch that happened to contain something — which, in a
   * shop that has stopped editing its catalogue, could be never.
   */
  if (!result.lastError && result.pending > 0) applyInbox(db);
  return receiveStatus(db);
}

/** Start the background loop. Safe on a till that is not linked. */
export function startReceive(db: ArkomDb): void {
  if (timer) return;
  timer = setInterval(() => {
    void pullAll(db).catch(() => undefined);
  }, INTERVAL_MS);
  /* soon after boot, not instantly: the till has a window to draw, and a second
     till that has just been adopted wants its catalogue before its first sale */
  setTimeout(() => void pullAll(db).catch(() => undefined), 5_000);
}

export function stopReceive(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test seam: forget the backoff and the skew between cases. */
export function resetReceiveState(): void {
  backoffUntil = 0;
  pulling = false;
  clockSkewMs = null;
}
