/**
 * The contract between a till and the cloud — ADR-0020, mechanism from ADR-0005.
 *
 * One file, imported by both sides, so the envelope cannot drift: the till
 * builds a batch with these schemas and the ingest route parses the same ones.
 * Nothing here talks to a database, a network or Electron — it is shapes and
 * one rule about what may leave a shop.
 *
 * The till pushes rows of its own oplog from a cursor; the cloud applies them
 * idempotently by `opId` and acks the highest `seq` it stored. Retries are
 * therefore free, which is the whole reason the shop's Wi-Fi being terrible is
 * not this product's problem.
 *
 * Since ADR-0022 there is a second direction, and it is narrower than it looks.
 * A till PULLS the entries its SIBLING tills wrote, so that one shop's tills
 * agree on one catalogue and one stock ledger. The cloud still never authors a
 * row: every entry it serves was written by one of that shop's own tills, and
 * it hands back exactly what it was given. It is a courier, not a writer.
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

/**
 * What the cloud hands back, and the one field that fixes the two-shops bug.
 *
 * Before ADR-0022 §9 the till told the cloud its `tenantId` and the cloud wrote
 * it down, so a second install founded a second shop and the dashboard showed
 * two. Now the RESPONSE carries the keys to use: the account's existing shop if
 * it has one, or the till's own proposal if it is the first. `adopted` says
 * which happened, so the till knows whether to rewrite its local rows and
 * download a catalogue, or carry on as the shop it just created.
 */
export const SyncEnrolResponseSchema = z.object({
  /** stored on the till and sent with every push; never in the oplog */
  deviceToken: z.string().min(20),
  /** what the cloud calls this shop, for the Ajustes panel to show back */
  accountName: z.string(),
  shopName: z.string(),
  /** the keys this till must use from now on — the shop's, not necessarily its own */
  tenantId: z.string().min(1),
  locationId: z.string().min(1),
  /** true when the till joined a shop that already existed (ADR-0022 §9) */
  adopted: z.boolean().default(false),
  /** how many tills this shop now has, so Ajustes can say "caja 2 de 3" */
  tillCount: z.number().int().positive().default(1),
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

/* ------------------------------------------------------- pulling (ADR-0022) */

/**
 * How long a row must have sat in the cloud before a till may pull it.
 *
 * The subtle bug this exists to prevent, in full, because it is the kind that
 * costs a weekend: `ingest_seq` is a `bigserial`, so the number is taken when
 * the row is WRITTEN and becomes visible when the transaction COMMITS. Two
 * concurrent ingests can take 500 and 501 and commit in the opposite order. A
 * reader that sees 501 and stores it as its cursor will never see 500 — one
 * sale, quietly missing from one till, unreproducible.
 *
 * Serving only rows that have settled closes it: any transaction in flight when
 * a settled row was written has since committed or rolled back, so there is no
 * hole behind the cursor. The price is a few seconds of lag that nobody
 * standing at a counter can perceive.
 */
export const SYNC_SETTLE_MS = 5_000;

/** How many entries one pull may carry. Same reasoning as {@link SYNC_BATCH_SIZE}. */
export const SYNC_PULL_LIMIT = 500;

export const SyncPullRequestSchema = z.object({
  /** checked against what the token was enrolled for, exactly as the push is */
  tenantId: z.string().min(1),
  terminalId: z.string().min(1),
  appVersion: z.string().min(1),
  /**
   * The cursor: serve entries ingested strictly after this. 0 = from the start.
   *
   * Coerced, because a pull is a GET and a query string has no numbers in it.
   * Doing it in the schema rather than in the route keeps the one place that
   * defines the contract also the one place that parses it.
   */
  afterIngestSeq: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().max(SYNC_PULL_LIMIT).default(SYNC_PULL_LIMIT),
});
export type SyncPullRequest = z.infer<typeof SyncPullRequestSchema>;

/**
 * An entry on its way DOWN. Same shape as one going up, plus the cloud's
 * arrival order — which is the only field the till may page against, and which
 * no till can influence.
 *
 * `seq` is still here and is still the SOURCE till's own ordering (ADR-0005).
 * It is useful for diagnostics and useless for merging, which is exactly what
 * ADR-0022 §3 says about it.
 */
export const SyncPulledOpSchema = SyncOpSchema.extend({
  ingestSeq: z.number().int().positive(),
});
export type SyncPulledOp = z.infer<typeof SyncPulledOpSchema>;

export const SyncPullResponseSchema = z.object({
  entries: z.array(SyncPulledOpSchema),
  /**
   * The cursor to store. Not `max(ingestSeq)` of the batch — the server states
   * it, because the server knows whether the batch was truncated by `limit` and
   * the till does not.
   */
  cursor: z.number().int().nonnegative(),
  /** true when more settled rows are waiting; the till drains rather than sleeps */
  more: z.boolean().default(false),
  /** the server's clock, so a till with a wrong one can say so on screen */
  serverTimeMs: z.number().int().nonnegative(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

/**
 * Field-level last-writer-wins — ADR-0022 §7.
 *
 * The till pushes CHANGES, not rows: a `repair_ticket/status` payload is
 * literally `{status}`. So merging is per FIELD, not per row, or an update that
 * touched one column would blank every other column it did not mention. This is
 * the same rule the dashboard's fold applies in SQL, in the one place the till
 * needs it in TypeScript.
 *
 * Order is `(createdAtMs, opId)`. The timestamp is the deciding fact and the
 * opId breaks ties — UUIDv7 is itself time-ordered, so ties resolve the same
 * way everywhere rather than by whichever row a query happened to return first.
 */
export function laterWins(a: Pick<SyncOp, "createdAtMs" | "opId">, b: Pick<SyncOp, "createdAtMs" | "opId">): boolean {
  return a.createdAtMs !== b.createdAtMs ? a.createdAtMs > b.createdAtMs : a.opId > b.opId;
}

/**
 * Fold a row's entries into the column values to write.
 *
 * Takes the entries for ONE `entityId`, in any order, and returns the winning
 * value per field. `null` is a value and wins like any other — a product whose
 * group was cleared has `groupId: null`, and dropping it would silently restore
 * the old group.
 */
export function foldEntries(entries: readonly SyncOp[]): Record<string, unknown> {
  const winner = new Map<string, SyncOp>();
  const out: Record<string, unknown> = {};

  for (const entry of entries) {
    const after = entry.after;
    if (after === null || typeof after !== "object" || Array.isArray(after)) continue;
    for (const [key, value] of Object.entries(after as Record<string, unknown>)) {
      const held = winner.get(key);
      if (held && !laterWins(entry, held)) continue;
      winner.set(key, entry);
      out[key] = value;
    }
  }
  return out;
}
