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
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "@arkom/core";
import type {
  CloudStore,
  DeviceRow,
  EnrolInput,
  EnrolOutcome,
  RecordBatchInput,
  RecordBatchResult,
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

        /* NOW spend it, and conditionally: two callers who both read the same
           unspent code race here, and the WHERE clause is what makes exactly one
           of them the winner. The loser is told the code is gone, which it is. */
        const spent = await tx
          .update(enrolCodes)
          .set({ usedAt: input.now })
          .where(and(eq(enrolCodes.id, code.id), isNull(enrolCodes.usedAt)))
          .returning({ id: enrolCodes.id });
        if (!spent[0]) return { ok: false, reason: "code" } as const;

        const shopName = input.shopName.trim() || input.terminalName.trim();

        await tx
          .insert(tenants)
          .values({ id: input.tenantId, accountId: code.accountId, name: shopName })
          /* A shop that renames itself renames here; `account_id` is never in the
             update, so no enrolment can move a shop between accounts. */
          .onConflictDoUpdate({
            target: tenants.id,
            set: { name: shopName, lastSeenAt: input.now },
          });

        const deviceToken = newDeviceToken();
        const enrolled = await tx
          .insert(devices)
          .values({
            id: uuidv7(),
            accountId: code.accountId,
            tenantId: input.tenantId,
            locationId: input.locationId,
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
              locationId: input.locationId,
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

        return {
          ok: true,
          deviceToken,
          accountName: account[0]?.name ?? "",
          shopName,
        } as const;
      });
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
