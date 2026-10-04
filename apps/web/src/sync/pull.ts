/**
 * `GET /api/sync/pull` — the second door, as rules rather than as a route.
 * ADR-0022 §2–4.
 *
 * What this is, precisely, because the distinction is the whole architecture:
 * a till asks for the entries its SIBLING tills wrote, so that one shop's tills
 * agree on one catalogue and one stock ledger. The cloud hands back rows it was
 * given, unchanged. It does not merge them, resolve them, or compute anything
 * from them — the dashboard's fold is a read model for a browser and plays no
 * part here. Every row served was authored by one of that shop's own tills.
 *
 * So ADR-0020 §5's "the cloud never writes back" narrows rather than falls: the
 * cloud is a COURIER between a shop's tills and never an author. Nothing a till
 * receives originated here, and if this service disappeared tomorrow every till
 * would keep selling with the data it already has.
 *
 * Three rules do the work, and all three are about not lying to a till:
 *
 *   · **the caller's own rows are excluded**, so a till never re-applies what
 *     it wrote and no echo can form;
 *   · **only `SHARED_ENTITIES` are served**, so no till is handed another
 *     till's printer setting, shift or invoice number;
 *   · **only SETTLED rows are served**, so the cursor cannot step over a row
 *     whose transaction committed late.
 */
import {
  SHARED_ENTITIES,
  SyncPullRequestSchema,
  SYNC_SETTLE_MS,
  redactForSync,
} from "@arkom/core";
import { bearerToken } from "../lib/secrets";
import type { CloudStore } from "./store";
import type { HttpResult } from "./ingest";

/** Where and what, never the value — same reasoning as `ingest()`. */
function issues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; code: string }> }) {
  return error.issues.slice(0, 8).map((i) => ({ path: i.path.join("."), code: i.code }));
}

export async function pull(
  store: CloudStore,
  request: { authorization: string | null; query: unknown },
  now: Date = new Date(),
): Promise<HttpResult> {
  const token = bearerToken(request.authorization);
  /* 401 before 400, exactly as the push does: an unauthenticated caller gets no
     work done on its behalf and learns nothing about the shape of a good call. */
  if (!token) return { status: 401, body: { error: "UNAUTHENTICATED" } };

  const device = await store.deviceByToken(token);
  if (!device) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  /**
   * A revoked till may not READ either, and this is the half that matters.
   *
   * Revocation exists for a till that was lost or stolen (ADR-0020 §1). Cutting
   * off its pushes while still serving it the shop's catalogue, prices, customer
   * names and phone numbers would be a strange idea of cut off.
   */
  if (device.revokedAt) return { status: 403, body: { error: "DEVICE_REVOKED" } };

  const parsed = SyncPullRequestSchema.safeParse(request.query);
  if (!parsed.success) {
    return { status: 400, body: { error: "BAD_REQUEST", issues: issues(parsed.error) } };
  }
  const ask = parsed.data;

  /* The envelope has to agree with the credential — a till asking for a tenant
     that is not the one its token was issued for is not a confused till. */
  if (ask.tenantId !== device.tenantId || ask.terminalId !== device.terminalId) {
    return { status: 403, body: { error: "DEVICE_MISMATCH" } };
  }

  const result = await store.pullBatch({
    device,
    afterIngestSeq: ask.afterIngestSeq,
    limit: ask.limit,
    entities: SHARED_ENTITIES,
    /* ADR-0022 §4 — the settle window, applied here rather than in the store so
       that the rule is visible in the file about rules */
    settleBefore: new Date(now.getTime() - SYNC_SETTLE_MS),
  });

  /**
   * Redacted on the way out as well as on the way in.
   *
   * It should be impossible for a redacted key to be in the table: the till
   * strips them before queueing and `ingest()` strips them again before storing
   * (ADR-0020 §3). This is the third pass, and it is not superstition — it is
   * the one that protects a shop from rows a PREVIOUS version of this product
   * may have stored before the rule existed. A device passcode that predates
   * the redaction must not be handed to a till that will write it to a ficha.
   */
  const entries = result.entries.map((entry) => ({
    ...entry,
    before: redactForSync(entry.before) ?? null,
    after: redactForSync(entry.after) ?? null,
  }));

  return {
    status: 200,
    body: {
      entries,
      cursor: result.cursor,
      more: result.more,
      serverTimeMs: now.getTime(),
    },
  };
}
