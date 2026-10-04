/**
 * The Postgres side of `CloudStore` — Supabase (ADR-0021 §3).
 *
 * Everything in this file exists because one of three things has to be true
 * even when two requests arrive at once, a statement fails halfway, or a till
 * sends the same batch twice:
 *
 *  1. **A code is spent exactly once.** The claim is a conditional UPDATE inside
 *     a transaction, so the database decides the winner: a second caller blocks
 *     on the row lock, then finds `used_at` is no longer null.
 *  2. **A row is stored at most once.** `ON CONFLICT DO NOTHING` on
 *     (tenant, op_id), and we ack only what a successful statement returned.
 *  3. **Deleting a shop deletes all of it.** Foreign keys cascade, so there is
 *     no list of tables here that a future table could be left out of.
 *
 * Nothing acks optimistically. If any part of the write throws, the transaction
 * rolls back, the route answers 500, the till keeps its cursor, and the next
 * round sends the same rows — which cost one conflict each and nothing else.
 */
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { uuidv7 } from "@arkom/core";
import type {
  CloudStore,
  DeviceRow,
  EnrolInput,
  EnrolOutcome,
  RecordBatchInput,
  RecordBatchResult,
  PullInput,
  PullResult,
} from "../sync/store";
import { digest, newDeviceToken } from "../lib/secrets";
import { db as defaultDb, type CloudDb } from "./client";
import { accounts, devices, enrolCodes, syncEntries, tenants } from "./schema";

export function pgStore(handle?: CloudDb): CloudStore {
  const db = () => handle ?? defaultDb();

  return {
    async deviceByToken(token) {
      const rows = await db()
        .select({
          id: devices.id,
          accountId: devices.accountId,
          tenantId: devices.tenantId,
          locationId: devices.locationId,
          terminalId: devices.terminalId,
          revokedAt: devices.revokedAt,
          lastAckedSeq: devices.lastAckedSeq,
        })
        .from(devices)
        .where(eq(devices.tokenHash, digest(token)))
        .limit(1);
      return (rows[0] as DeviceRow | undefined) ?? null;
    },

    async recordBatch({ device, ops, appVersion, now }: RecordBatchInput): Promise<RecordBatchResult> {
      if (ops.length === 0) {
        return { stored: 0, duplicates: 0, ackedSeq: device.lastAckedSeq };
      }

      /* A healthy till cannot send the same op_id twice — its oplog has a unique
         index on it — but a VALUES list with a repeat would make the conflict
         count lie, so the dedupe is here rather than assumed. */
      const unique = [...new Map(ops.map((op) => [op.opId, op])).values()];
      const ackedSeq = unique.reduce((top, op) => (op.seq > top ? op.seq : top), 0);

      const values = unique.map((op) => ({
        tenantId: op.tenantId,
        opId: op.opId,
        deviceId: device.id,
        seq: op.seq,
        locationId: op.locationId,
        terminalId: op.terminalId,
        entity: op.entity,
        entityId: op.entityId,
        action: op.action,
        before: op.before ?? null,
        after: op.after ?? null,
        userId: op.userId,
        authorizedByUserId: op.authorizedByUserId,
        createdAt: new Date(op.createdAtMs),
        receivedAt: now,
      }));

      return db().transaction(async (tx) => {
        const inserted = await tx
          .insert(syncEntries)
          .values(values)
          .onConflictDoNothing({ target: [syncEntries.tenantId, syncEntries.opId] })
          .returning({ opId: syncEntries.opId });

        /* The stored cursor is monotonic for the dashboard's sake — a replaying
           till pushes low seqs again and "how far along is this till" should not
           go backwards — while the ACK is what this batch actually contained. */
        await tx
          .update(devices)
          .set({
            lastAckedSeq: Math.max(device.lastAckedSeq, ackedSeq),
            lastPushAt: now,
            appVersion,
          })
          .where(eq(devices.id, device.id));

        await tx.update(tenants).set({ lastSeenAt: now }).where(eq(tenants.id, device.tenantId));

        return {
          stored: inserted.length,
          duplicates: unique.length - inserted.length,
          ackedSeq,
        };
      });
    },

    async enrol(input: EnrolInput): Promise<EnrolOutcome> {
      return db().transaction(async (tx) => {
        /* Look the code up before spending it. A good code pasted at a shop that
           belongs to somebody else must come back unspent — what was wrong was
           where it was pasted, and the owner should not lose a code over that.
           Reading first means the refusal writes nothing at all, rather than
           writing and then relying on a rollback to take it back. */
        const found = await tx
          .select({ id: enrolCodes.id, accountId: enrolCodes.accountId })
          .from(enrolCodes)
          .where(
            and(
              eq(enrolCodes.codeHash, digest(input.code)),
              isNull(enrolCodes.usedAt),
              gt(enrolCodes.expiresAt, input.now),
            ),
          )
          .limit(1);

        const code = found[0];
        if (!code) return { ok: false, reason: "code" } as const;

        const existing = await tx
          .select({ accountId: tenants.accountId })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);

        if (existing[0] && existing[0].accountId !== code.accountId) {
          return { ok: false, reason: "tenant" } as const;
        }

        /* ------------------------------------------------- ADR-0022 §9: join
         * Which shop is this till joining? Until now the answer was always "the
         * one it just invented", which is how Arkom ended up with two.
         *
         * The account's existing shops decide:
         *   none  → the till's proposal becomes the shop
         *   one   → the till ADOPTS it, keys and all
         *   many  → refused, because "the shop" has no referent and picking the
         *           busiest would silently strand the other one's history
         */
        const shops = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.accountId, code.accountId))
          .orderBy(tenants.createdAt);

        /* A till that is ALREADY in one of this account's shops stays in it.
           Re-enrolment rotates a token (see below) and must never be the thing
           that moves a working till or refuses to let it back in — including in
           an account that has the two shops this ADR exists to stop happening. */
        const alreadyIn = shops.some((t) => t.id === input.tenantId);

        if (!alreadyIn && shops.length > 1) {
          return { ok: false, reason: "ambiguous", tenantIds: shops.map((t) => t.id) } as const;
        }

        const adopted = !alreadyIn && shops.length === 1;
        const tenantId = adopted ? shops[0]!.id : input.tenantId;

        /* The location comes from a till that is already in the shop. One shop
           is one location in Phase 1 (ADR-0009), so any sibling's answer is the
           shop's answer; without a sibling the till's own proposal stands. */
        let locationId = input.locationId;
        if (adopted) {
          const sibling = await tx
            .select({ locationId: devices.locationId })
            .from(devices)
            .where(eq(devices.tenantId, tenantId))
            .orderBy(devices.enrolledAt)
            .limit(1);
          if (sibling[0]) locationId = sibling[0].locationId;
        }

        /* NOW spend it, and conditionally: two callers who both read the same
           unspent code race here, and the WHERE clause is what makes exactly one
           of them the winner. The loser is told the code is gone, which it is. */
        const spent = await tx
          .update(enrolCodes)
          .set({ usedAt: input.now })
          .where(and(eq(enrolCodes.id, code.id), isNull(enrolCodes.usedAt)))
          .returning({ id: enrolCodes.id });
        if (!spent[0]) return { ok: false, reason: "code" } as const;

        /* A JOINING till does not get to rename the shop. It is a second
           counter in somebody's existing business, and its own first-run
           answer to "who are you" is, by definition, not the shop's. Only a
           till that FOUNDS the shop names it. */
        const proposed = input.shopName.trim() || input.terminalName.trim();

        await tx
          .insert(tenants)
          .values({ id: tenantId, accountId: code.accountId, name: proposed })
          /* A shop that renames itself renames here; `account_id` is never in the
             update, so no enrolment can move a shop between accounts. */
          .onConflictDoUpdate({
            target: tenants.id,
            set: adopted ? { lastSeenAt: input.now } : { name: proposed, lastSeenAt: input.now },
          });

        const shopRow = await tx
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);
        const shopName = shopRow[0]?.name ?? proposed;

        const deviceToken = newDeviceToken();
        const enrolled = await tx
          .insert(devices)
          .values({
            id: uuidv7(),
            accountId: code.accountId,
            tenantId,
            locationId,
            terminalId: input.terminalId,
            terminalName: input.terminalName,
            tokenHash: digest(deviceToken),
            appVersion: input.appVersion,
            enrolledAt: input.now,
          })
          /* Re-enrolling the same till ROTATES its token rather than leaving the
             old one alive beside it, and lifts a revocation — the account issued
             the code, so the account is readmitting the till. `last_acked_seq` is
             left alone: it is a display, and the till's own cursor is the one
             that decides what gets sent. */
          .onConflictDoUpdate({
            target: [devices.tenantId, devices.terminalId],
            set: {
              tokenHash: digest(deviceToken),
              terminalName: input.terminalName,
              locationId,
              appVersion: input.appVersion,
              enrolledAt: input.now,
              revokedAt: null,
            },
          })
          .returning({ id: devices.id });

        const deviceId = enrolled[0]?.id;
        if (deviceId) {
          await tx.update(enrolCodes).set({ usedByDeviceId: deviceId }).where(eq(enrolCodes.id, code.id));
        }

        const account = await tx
          .select({ name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, code.accountId))
          .limit(1);

        const tills = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(devices)
          .where(and(eq(devices.tenantId, tenantId), isNull(devices.revokedAt)));

        return {
          ok: true,
          deviceToken,
          accountName: account[0]?.name ?? "",
          shopName,
          tenantId,
          locationId,
          adopted,
          tillCount: tills[0]?.n ?? 1,
        } as const;
      });
    },

    /**
     * The entries this till's siblings wrote — ADR-0022 §2–4.
     *
     * Two queries, both served by `ix_entries_ingest`:
     *
     *  1. **the frontier** — the highest SETTLED `ingest_seq` for this shop.
     *     It is what lets the cursor advance past rows that were examined and
     *     not wanted (this till's own writes, a shift, a printer setting), so a
     *     shop with one till does not rescan its whole stream every tick.
     *  2. **the batch** — settled, after the cursor, somebody else's, and only
     *     the entities ADR-0022 §1 calls the shop's.
     *
     * `limit + 1` is fetched to learn whether more is waiting without a second
     * count. When the batch is truncated the cursor moves only as far as the
     * last row actually RETURNED — never to the frontier — because the rows in
     * between have not been handed over yet.
     */
    async pullBatch({ device, afterIngestSeq, limit, entities, settleBefore }: PullInput): Promise<PullResult> {
      const handle = db();

      const frontierRow = await handle
        .select({ seq: sql<number>`coalesce(max(${syncEntries.ingestSeq}), 0)::bigint` })
        .from(syncEntries)
        .where(and(eq(syncEntries.tenantId, device.tenantId), lt(syncEntries.receivedAt, settleBefore)));
      const frontier = Number(frontierRow[0]?.seq ?? 0);

      const rows = await handle
        .select({
          ingestSeq: syncEntries.ingestSeq,
          seq: syncEntries.seq,
          opId: syncEntries.opId,
          tenantId: syncEntries.tenantId,
          locationId: syncEntries.locationId,
          terminalId: syncEntries.terminalId,
          entity: syncEntries.entity,
          entityId: syncEntries.entityId,
          action: syncEntries.action,
          before: syncEntries.before,
          after: syncEntries.after,
          userId: syncEntries.userId,
          authorizedByUserId: syncEntries.authorizedByUserId,
          createdAt: syncEntries.createdAt,
        })
        .from(syncEntries)
        .where(
          and(
            eq(syncEntries.tenantId, device.tenantId),
            gt(syncEntries.ingestSeq, afterIngestSeq),
            lt(syncEntries.receivedAt, settleBefore),
            /* never the caller's own rows: a till that re-applied what it wrote
               would push it again, and the echo would never stop (ADR-0022 §6) */
            ne(syncEntries.deviceId, device.id),
            inArray(syncEntries.entity, [...entities]),
          ),
        )
        .orderBy(syncEntries.ingestSeq)
        .limit(limit + 1);

      const truncated = rows.length > limit;
      const page = truncated ? rows.slice(0, limit) : rows;

      return {
        entries: page.map((row) => ({
          ingestSeq: Number(row.ingestSeq),
          seq: Number(row.seq),
          opId: row.opId,
          tenantId: row.tenantId,
          locationId: row.locationId,
          terminalId: row.terminalId,
          entity: row.entity,
          entityId: row.entityId,
          action: row.action,
          before: row.before ?? null,
          after: row.after ?? null,
          userId: row.userId,
          authorizedByUserId: row.authorizedByUserId,
          createdAtMs: row.createdAt.getTime(),
        })),
        cursor: truncated ? Number(page[page.length - 1]!.ingestSeq) : Math.max(frontier, afterIngestSeq),
        more: truncated,
      };
    },

    async deleteTenant(tenantId) {
      return db().transaction(async (tx) => {
        const counts = await tx
          .select({
            entries: sql<number>`(select count(*)::int from ${syncEntries} where ${syncEntries.tenantId} = ${tenantId})`,
            devices: sql<number>`(select count(*)::int from ${devices} where ${devices.tenantId} = ${tenantId})`,
          })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);

        /* One statement. Entries and devices go with it through the foreign keys,
           so a table added later cannot be forgotten here — which is the whole
           reason the cascade is in the schema rather than a list in this file. */
        await tx.delete(tenants).where(eq(tenants.id, tenantId));

        return { entries: counts[0]?.entries ?? 0, devices: counts[0]?.devices ?? 0 };
      });
    },
  };
}
