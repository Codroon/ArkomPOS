/**
 * `POST /api/sync` — the one door into the cloud, as rules rather than as a
 * route. ADR-0020 §1–2, mechanism from ADR-0005.
 *
 * Everything here is a decision about trust or about the cursor, and both are
 * things a shop's data depends on, so neither is allowed to live inside a
 * framework handler where it cannot be tested without a server.
 *
 * The contract in one paragraph: a bearer token identifies exactly one till;
 * that till may write exactly one tenant's stream; rows are applied
 * idempotently by `op_id`; the response acks the highest `seq` we durably
 * stored, and the till moves its cursor to that and no further. Anything we
 * cannot store, we do not ack — a failure costs a repeat, never a gap.
 */
import { redactForSync, SyncPushRequestSchema, type SyncOp } from "@arkom/core";
import { bearerToken } from "../lib/secrets";
import type { CloudStore, DeviceRow } from "./store";

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Zod's complaint, reduced to where and what.
 *
 * Never the value: a rejected batch is still a shop's data, and an error body
 * is the one part of a request that tends to end up in somebody's log
 * aggregator.
 */
function issues(error: { issues: ReadonlyArray<{ path: PropertyKey[]; code: string }> }) {
  return error.issues.slice(0, 8).map((i) => ({ path: i.path.join("."), code: i.code }));
}

/** The batch may only carry rows belonging to the tenant the token was issued for. */
function foreignOp(ops: readonly SyncOp[], device: DeviceRow): SyncOp | undefined {
  return ops.find((op) => op.tenantId !== device.tenantId);
}

export async function ingest(
  store: CloudStore,
  request: { authorization: string | null; body: unknown },
  now: Date = new Date(),
): Promise<HttpResult> {
  const token = bearerToken(request.authorization);
  /* 401 before 400: an unauthenticated caller gets no work done on its behalf,
     and learns nothing about what a well-formed batch looks like. */
  if (!token) return { status: 401, body: { error: "UNAUTHENTICATED" } };

  const device = await store.deviceByToken(token);
  /* Unknown token and revoked token answer differently on purpose. Both stop
     the till's timer (it treats 401 and 403 as fatal), but an owner reading
     Ajustes should be able to tell "this till was cut off" from "this token is
     not a token", and only the account can cause the first. */
  if (!device) return { status: 401, body: { error: "UNAUTHENTICATED" } };
  if (device.revokedAt) return { status: 403, body: { error: "DEVICE_REVOKED" } };

  const parsed = SyncPushRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "BAD_REQUEST", issues: issues(parsed.error) } };
  }
  const push = parsed.data;

  /* The envelope has to agree with the credential. A till that says it is
     somebody else is not a confused till, and there is no reading of this that
     ends with us storing the batch. */
  if (push.tenantId !== device.tenantId || push.terminalId !== device.terminalId) {
    return { status: 403, body: { error: "DEVICE_MISMATCH" } };
  }

  /* ADR-0020 §1: an op for another tenant is REJECTED, not skipped. Dropping
     the row quietly and acking the rest would leave the till believing it had
     delivered something we deliberately threw away. */
  const foreign = foreignOp(push.ops, device);
  if (foreign) {
    return { status: 403, body: { error: "TENANT_MISMATCH", opId: foreign.opId } };
  }

  /* `op.terminalId` is NOT checked against the device. It is the till's own
     record of where the row was written, and after a backup restore onto a
     replacement PC it legitimately names a terminal that no longer exists.
     Refusing it there would strand that shop's history forever; the security
     boundary is the tenant, and the credential that delivered each row is
     stored beside it. */

  /* The same redaction the till ran before it queued the row, run again here.
     ADR-0020 §3 puts the guarantee at the source — a secret on the wire has
     already left the shop, and this cannot undo that. What it can do is make
     sure the far end is never the place where one becomes DURABLE: an old till,
     a bug in a future writer, or somebody posting a hand-made batch does not
     get a device passcode into our Postgres. */
  const ops = push.ops.map((op) => ({
    ...op,
    before: redactForSync(op.before) ?? null,
    after: redactForSync(op.after) ?? null,
  }));

  const result = await store.recordBatch({
    device,
    ops,
    appVersion: push.appVersion,
    now,
  });

  return {
    status: 200,
    body: {
      ackedSeq: result.ackedSeq,
      duplicates: result.duplicates,
      serverTimeMs: now.getTime(),
    },
  };
}
