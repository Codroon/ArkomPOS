/**
 * The contract between a till and the cloud — ADR-0020, mechanism from ADR-0005.
 *
 * One file, imported by both sides, so the envelope cannot drift: the till
 * builds a batch with these schemas and the ingest route parses the same ones.
 * Nothing here talks to a database, a network or Electron — it is shapes and
 * one rule about what may leave a shop.
 *
 * Direction is up only (ADR-0001). The till pushes rows of its own oplog from
 * a cursor; the cloud applies them idempotently by `opId` and acks the highest
 * `seq` it stored. Retries are therefore free, which is the whole reason the
 * shop's Wi-Fi being terrible is not this product's problem.
 */
import { z } from "zod";

/** Payload keys that must never leave the shop, at any depth — ADR-0020 §3. */
export const REDACTED_KEYS = ["devicePasscode", "passcode", "pinHash", "pinSalt", "recoveryCodeHash"] as const;

/** A single oplog row, as it travels. The till's own `seq` orders the stream. */
export const SyncOpSchema = z.object({
  seq: z.number().int().positive(),
  opId: z.string().min(1),
  tenantId: z.string().min(1),
  locationId: z.string().min(1),
  terminalId: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  userId: z.string().nullable(),
  authorizedByUserId: z.string().nullable(),
  createdAtMs: z.number().int().nonnegative(),
});
export type SyncOp = z.infer<typeof SyncOpSchema>;

/**
 * One push. Small on purpose: a batch that fails should be cheap to retry on a
 * shop line that drops halfway, and the cursor only moves on an ack.
 */
export const SYNC_BATCH_SIZE = 200;

export const SyncPushRequestSchema = z.object({
  /** the till's own ids, checked against what the token was enrolled for */
  tenantId: z.string().min(1),
  terminalId: z.string().min(1),
  /** the version that built the batch, so the cloud can refuse one it predates */
  appVersion: z.string().min(1),
  ops: z.array(SyncOpSchema).max(SYNC_BATCH_SIZE),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncPushResponseSchema = z.object({
  /** the highest seq now durably stored; the till advances its cursor to this */
  ackedSeq: z.number().int().nonnegative(),
  /** rows the cloud already had — reported, never an error (ADR-0005) */
  duplicates: z.number().int().nonnegative().default(0),
  /** the server's clock, so a till with a wrong one can say so on screen */
  serverTimeMs: z.number().int().nonnegative(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

/* ------------------------------------------------------------- enrolment */

/**
 * The code the owner pastes in Ajustes → Nube. Short enough to read off a
 * screen and type on a counter PC; it buys a device token and is then spent.
 */
export const EnrolCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, "Código de enlace no válido.");

export const SyncEnrolRequestSchema = z.object({
  code: EnrolCodeSchema,
  /** the ids the till generated at FIRST RUN and keeps forever (ADR-0020 §1) */
  tenantId: z.string().min(1),
  locationId: z.string().min(1),
  terminalId: z.string().min(1),
  terminalName: z.string().trim().min(1).max(60),
  shopName: z.string().trim().max(200),
  appVersion: z.string().min(1),
});
export type SyncEnrolRequest = z.infer<typeof SyncEnrolRequestSchema>;

export const SyncEnrolResponseSchema = z.object({
  /** stored on the till and sent with every push; never in the oplog */
  deviceToken: z.string().min(20),
  /** what the cloud calls this shop, for the Ajustes panel to show back */
  accountName: z.string(),
  shopName: z.string(),
});
export type SyncEnrolResponse = z.infer<typeof SyncEnrolResponseSchema>;

/* ------------------------------------------------- what may leave the shop */

/**
 * Strip the secrets out of an oplog payload, at any depth.
 *
 * Done HERE, on the till, before the row is queued — not filtered at the far
 * end, because a secret that reaches the wire has already left the shop. A
 * device passcode is the customer's, not ours (ADR-0014 §10); PIN material has
 * never been in the oplog and this keeps it that way if a future writer slips.
 *
 * Photographs need no rule: they are files on disk and the push carries rows.
 * The path stays — it is meaningless without the file, and the repair screen in
 * the cloud should be able to say "four photographs were taken".
 */
export function redactForSync(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForSync);
  if (value === null || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if ((REDACTED_KEYS as readonly string[]).includes(key)) continue;
    out[key] = redactForSync(inner);
  }
  return out;
}

/** An oplog row as the till stores it, before it becomes a {@link SyncOp}. */
export interface SyncableOplogRow {
  seq: number;
  opId: string;
  tenantId: string;
  locationId: string;
  terminalId: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  userId: string | null;
  authorizedByUserId: string | null;
  createdAt: Date | number;
}

/**
 * Rows → a batch that is safe to send: redacted, ordered, and no longer than
 * one push. Pure, so the rule about what leaves a shop is testable without a
 * database or a server.
 */
export function prepareBatch(rows: readonly SyncableOplogRow[], limit = SYNC_BATCH_SIZE): SyncOp[] {
  return [...rows]
    .sort((a, b) => a.seq - b.seq)
    .slice(0, limit)
    .map((row) => ({
      seq: row.seq,
      opId: row.opId,
      tenantId: row.tenantId,
      locationId: row.locationId,
      terminalId: row.terminalId,
      entity: row.entity,
      entityId: row.entityId,
      action: row.action,
      before: redactForSync(row.before) ?? null,
      after: redactForSync(row.after) ?? null,
      userId: row.userId,
      authorizedByUserId: row.authorizedByUserId,
      createdAtMs: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
    }));
}
