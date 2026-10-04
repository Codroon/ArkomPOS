/**
 * A `CloudStore` in a Map, so the ingest rules can be tested without a Postgres.
 *
 * It is written to have the SAME invariants as the Neon implementation rather
 * than to make tests pass: a code spends once, a row stores once, a cursor only
 * moves forward, deleting a shop takes its rows with it. Where the two could
 * drift, the comment in `pg-store.ts` says which statement enforces it there.
 */
import { digest, newDeviceToken, newEnrolCode, ENROL_CODE_TTL_MS } from "../../lib/secrets";
import type {
  CloudStore,
  DeviceRow,
  EnrolInput,
  EnrolOutcome,
  PullInput,
  PullResult,
  RecordBatchInput,
  RecordBatchResult,
} from "../store";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;


export interface StoredEntry {
  tenantId: string;
  opId: string;
  /** mirrors `sync_entries.ingest_seq` — assigned here, never sent by a till */
  ingestSeq: number;
  deviceId: string;
  seq: number;
  terminalId: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  /* carried because a pull has to hand them back, not because ingest reads them */
  locationId: string;
  userId: string | null;
  authorizedByUserId: string | null;
  createdAt: Date;
  receivedAt: Date;
}

interface DeviceRecord extends DeviceRow {
  tokenHash: string;
  terminalName: string;
  appVersion: string;
  lastPushAt: Date | null;
}

interface CodeRecord {
  id: string;
  accountId: string;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  usedByDeviceId: string | null;
}

export interface MemoryStore extends CloudStore {
  accounts: Map<string, { id: string; name: string }>;
  tenants: Map<string, { id: string; accountId: string; name: string; lastSeenAt: Date | null }>;
  devices: Map<string, DeviceRecord>;
  codes: Map<string, CodeRecord>;
  entries: Map<string, StoredEntry>;
  /** returns the account id */
  addAccount(name: string): string;
  /** returns the code IN PLAIN TEXT — the only place it ever exists */
  addCode(accountId: string, opts?: { expiresAt?: Date }): string;
  /** a till that is already enrolled; returns its token */
  addDevice(input: {
    accountId: string;
    tenantId: string;
    terminalId?: string;
    locationId?: string;
    revokedAt?: Date | null;
    lastAckedSeq?: number;
  }): { token: string; device: DeviceRecord };
  entriesFor(tenantId: string): StoredEntry[];
}

const key = (tenantId: string, opId: string) => `${tenantId}\u0000${opId}`;

export function memoryStore(): MemoryStore {
  /* Arrival order, per store instance — a `bigserial` belongs to a table, and
     each of these IS a fresh table. Module-level would leak between tests and
     make a cursor assertion depend on what ran before it. */
  let ingestCounter = 0;

  const store: MemoryStore = {
    accounts: new Map(),
    tenants: new Map(),
    devices: new Map(),
    codes: new Map(),
    entries: new Map(),

    addAccount(name) {
      const id = nextId("acc");
      store.accounts.set(id, { id, name });
      return id;
    },

    addCode(accountId, opts = {}) {
      const code = newEnrolCode();
      const id = nextId("code");
      store.codes.set(id, {
        id,
        accountId,
        codeHash: digest(code),
        expiresAt: opts.expiresAt ?? new Date(Date.now() + ENROL_CODE_TTL_MS),
        usedAt: null,
        usedByDeviceId: null,
      });
      return code;
    },

    addDevice(input) {
      const token = newDeviceToken();
      const id = nextId("dev");
      const device: DeviceRecord = {
        id,
        accountId: input.accountId,
        tenantId: input.tenantId,
        locationId: input.locationId ?? "loc-1",
        terminalId: input.terminalId ?? "term-1",
        terminalName: "Caja",
        tokenHash: digest(token),
        appVersion: "1.1.0",
        revokedAt: input.revokedAt ?? null,
        lastAckedSeq: input.lastAckedSeq ?? 0,
        lastPushAt: null,
      };
      store.devices.set(id, device);
      if (!store.tenants.has(input.tenantId)) {
        store.tenants.set(input.tenantId, {
          id: input.tenantId,
          accountId: input.accountId,
          name: "Tienda",
          lastSeenAt: null,
        });
      }
      return { token, device };
    },

    entriesFor(tenantId) {
      return [...store.entries.values()]
        .filter((e) => e.tenantId === tenantId)
        .sort((a, b) => a.seq - b.seq);
    },

    async deviceByToken(token) {
      const hash = digest(token);
      const found = [...store.devices.values()].find((d) => d.tokenHash === hash);
      /* a copy: the caller must not be able to see the cursor move under it,
         any more than it could through a Postgres row it already selected */
      return found ? { ...found } : null;
    },

    async recordBatch({ device, ops, appVersion, now }: RecordBatchInput): Promise<RecordBatchResult> {
      const live = store.devices.get(device.id);
      if (!live) throw new Error("no such device");
      if (ops.length === 0) return { stored: 0, duplicates: 0, ackedSeq: live.lastAckedSeq };

      const unique = [...new Map(ops.map((op) => [op.opId, op])).values()];
      let stored = 0;
      let duplicates = 0;
      let ackedSeq = 0;

      for (const op of unique) {
        if (op.seq > ackedSeq) ackedSeq = op.seq;
        const k = key(op.tenantId, op.opId);
        if (store.entries.has(k)) {
          duplicates += 1;
          continue;
        }
        store.entries.set(k, {
          tenantId: op.tenantId,
          opId: op.opId,
          ingestSeq: (ingestCounter += 1),
          deviceId: device.id,
          seq: op.seq,
          terminalId: op.terminalId,
          entity: op.entity,
          entityId: op.entityId,
          action: op.action,
          before: op.before ?? null,
          after: op.after ?? null,
          locationId: op.locationId,
          userId: op.userId,
          authorizedByUserId: op.authorizedByUserId,
          createdAt: new Date(op.createdAtMs),
          receivedAt: now,
        });
        stored += 1;
      }

      live.lastAckedSeq = Math.max(live.lastAckedSeq, ackedSeq);
      live.lastPushAt = now;
      live.appVersion = appVersion;
      const tenant = store.tenants.get(device.tenantId);
      if (tenant) tenant.lastSeenAt = now;

      return { stored, duplicates, ackedSeq };
    },

    async enrol(input: EnrolInput): Promise<EnrolOutcome> {
      const hash = digest(input.code);
      const code = [...store.codes.values()].find(
        (c) => c.codeHash === hash && c.usedAt === null && c.expiresAt > input.now,
      );
      if (!code) return { ok: false, reason: "code" };

      /* ownership BEFORE the code is spent, mirroring pg-store: a refusal here
         writes nothing, rather than writing and taking it back */
      const existing = store.tenants.get(input.tenantId);
      if (existing && existing.accountId !== code.accountId) {
        return { ok: false, reason: "tenant" };
      }

      /* ADR-0022 §9 — which shop does this till join? Same three cases as
         pg-store, and the same refusal when there is no single answer. */
      const shops = [...store.tenants.values()].filter((t) => t.accountId === code.accountId);
      const alreadyIn = shops.some((t) => t.id === input.tenantId);
      if (!alreadyIn && shops.length > 1) {
        return { ok: false, reason: "ambiguous", tenantIds: shops.map((t) => t.id) };
      }
      const adopted = !alreadyIn && shops.length === 1;
      const tenantId = adopted ? shops[0]!.id : input.tenantId;

      let locationId = input.locationId;
      if (adopted) {
        const sibling = [...store.devices.values()].find((d) => d.tenantId === tenantId);
        if (sibling) locationId = sibling.locationId;
      }

      code.usedAt = input.now;

      /* a joining till does not rename somebody else's shop */
      const proposed = input.shopName.trim() || input.terminalName.trim();
      const shop = store.tenants.get(tenantId);
      if (shop) {
        if (!adopted) shop.name = proposed;
        shop.lastSeenAt = input.now;
      } else {
        store.tenants.set(tenantId, {
          id: tenantId,
          accountId: code.accountId,
          name: proposed,
          lastSeenAt: input.now,
        });
      }
      const shopName = store.tenants.get(tenantId)!.name;

      const deviceToken = newDeviceToken();
      const already = [...store.devices.values()].find(
        (d) => d.tenantId === tenantId && d.terminalId === input.terminalId,
      );
      const device: DeviceRecord = already ?? {
        id: nextId("dev"),
        accountId: code.accountId,
        tenantId,
        locationId,
        terminalId: input.terminalId,
        terminalName: input.terminalName,
        tokenHash: "",
        appVersion: input.appVersion,
        revokedAt: null,
        lastAckedSeq: 0,
        lastPushAt: null,
      };
      device.tokenHash = digest(deviceToken);
      device.terminalName = input.terminalName;
      device.locationId = locationId;
      device.appVersion = input.appVersion;
      device.revokedAt = null;
      store.devices.set(device.id, device);

      code.usedByDeviceId = device.id;

      return {
        ok: true,
        deviceToken,
        accountName: store.accounts.get(code.accountId)?.name ?? "",
        shopName,
        tenantId,
        locationId,
        adopted,
        tillCount: [...store.devices.values()].filter(
          (d) => d.tenantId === tenantId && !d.revokedAt,
        ).length,
      };
    },

    /**
     * The same three rules as `pg-store.pullBatch`, in a Map.
     *
     * Written to match its INVARIANTS rather than to make a test pass: the
     * caller's own rows are excluded, only shared entities are served, only
     * settled rows are served, and the cursor jumps to the frontier exactly
     * when the batch was not truncated.
     */
    async pullBatch({ device, afterIngestSeq, limit, entities, settleBefore }: PullInput): Promise<PullResult> {
      const settled = [...store.entries.values()].filter(
        (e) => e.tenantId === device.tenantId && e.receivedAt < settleBefore,
      );
      const frontier = settled.reduce((max, e) => (e.ingestSeq > max ? e.ingestSeq : max), 0);

      const matching = settled
        .filter(
          (e) =>
            e.ingestSeq > afterIngestSeq &&
            e.deviceId !== device.id &&
            entities.includes(e.entity),
        )
        .sort((a, b) => a.ingestSeq - b.ingestSeq);

      const truncated = matching.length > limit;
      const page = truncated ? matching.slice(0, limit) : matching;

      return {
        entries: page.map((e) => ({
          ingestSeq: e.ingestSeq,
          seq: e.seq,
          opId: e.opId,
          tenantId: e.tenantId,
          locationId: e.locationId,
          terminalId: e.terminalId,
          entity: e.entity,
          entityId: e.entityId,
          action: e.action,
          before: e.before ?? null,
          after: e.after ?? null,
          userId: e.userId,
          authorizedByUserId: e.authorizedByUserId,
          createdAtMs: e.createdAt.getTime(),
        })),
        cursor: truncated ? page[page.length - 1]!.ingestSeq : Math.max(frontier, afterIngestSeq),
        more: truncated,
      };
    },

    async deleteTenant(tenantId) {
      let entries = 0;
      for (const [k, entry] of [...store.entries.entries()]) {
        if (entry.tenantId === tenantId) {
          store.entries.delete(k);
          entries += 1;
        }
      }
      let devices = 0;
      for (const [id, device] of [...store.devices.entries()]) {
        if (device.tenantId === tenantId) {
          store.devices.delete(id);
          devices += 1;
        }
      }
      store.tenants.delete(tenantId);
      return { entries, devices };
    },
  };

  return store;
}
