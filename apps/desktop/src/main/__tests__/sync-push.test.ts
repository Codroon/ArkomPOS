/**
 * The till's outbox — ADR-0005 mechanism, ADR-0020 rules.
 *
 * The cases that matter are the unhappy ones. A shop's line is down more often
 * than anybody admits, and the promise this product is built on is that none of
 * that reaches the counter: the cursor does not move on a failure, the queue
 * does not lose its place, a replay costs nothing, and a revoked till stops
 * hammering the server without stopping the shop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import { uuidv7 } from "@arkom/core";
import { app } from "./electron-stub";
import { readLink, resetLinkCache, writeLink } from "../sync/link";
import { pendingCount, pushOnce, resetSyncState, syncStatus } from "../sync/push";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "arkom-sync-"));
  const { db } = openDb(join(dir, "test.db"));
  runMigrations(db, MIGRATIONS);
  return db;
}

let db: ReturnType<typeof freshDb>;
const IDS = { tenantId: "t1", locationId: "l1", terminalId: "term1" };

/** An oplog row, written straight in: what mutate() would have left behind. */
function op(over: Partial<typeof s.oplog.$inferInsert> = {}) {
  db.insert(s.oplog)
    .values({
      opId: uuidv7(),
      ...IDS,
      entity: "document",
      entityId: uuidv7(),
      action: "complete",
      before: null,
      after: { docNumber: "T1-000001" },
      userId: "u1",
      authorizedByUserId: null,
      createdAt: new Date(),
      ...over,
    })
    .run();
}

function link(over: Partial<ReturnType<typeof readLink> & object> = {}) {
  writeLink({
    url: "https://pos.codroon.com",
    deviceToken: "tok_abcdefghijklmnopqrstuvwxyz",
    tenantId: IDS.tenantId,
    terminalId: IDS.terminalId,
    accountName: "Codroon",
    shopName: "Telefonía García",
    enrolledAtMs: Date.now(),
    lastAckedSeq: 0,
    lastPushAtMs: null,
    lastError: null,
    ...over,
  });
}

/** A cloud that answers however the case needs it to. */
interface FakeReply {
  ok?: boolean;
  status?: number;
  json?: unknown;
}

function cloud(handler: (body: Record<string, unknown>) => FakeReply) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const res = handler(body);
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: async () => res.json ?? { ackedSeq: 0, duplicates: 0, serverTimeMs: Date.now() },
    } as Response;
  });
}

beforeEach(() => {
  db = freshDb();
  resetLinkCache();
  resetSyncState();
  // each case gets its own userData, so the link file never leaks between them
  (app as unknown as { getPath: () => string }).getPath = () => mkdtempSync(join(tmpdir(), "arkom-ud-"));
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLinkCache();
});

describe("a till nobody has linked", () => {
  it("pushes nothing and says so, without inventing an error", async () => {
    op();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const status = await pushOnce(db);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(status).toMatchObject({ linked: false, pending: 0, lastError: null });
  });
});

describe("a linked till with something to send", () => {
  it("sends the batch and advances the cursor to what was acked", async () => {
    link();
    op();
    op();
    const fetchSpy = cloud(() => ({ json: { ackedSeq: 2, duplicates: 0, serverTimeMs: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);

    const status = await pushOnce(db, { force: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("https://pos.codroon.com/api/sync");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer tok_abcdefghijklmnopqrstuvwxyz" });
    expect(status).toMatchObject({ linked: true, pending: 0, lastAckedSeq: 2, lastError: null });
  });

  it("never sends a device passcode, whatever the repair screen wrote", async () => {
    /* the redaction is core's (ADR-0020 §3); this pins that the outbox actually
       uses it, because a secret on the wire has already left the shop */
    link();
    op({ entity: "repair_ticket", action: "create", after: { ticketId: "r1", devicePasscode: "1234" } });
    const fetchSpy = cloud(() => ({ json: { ackedSeq: 1, duplicates: 0, serverTimeMs: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);

    await pushOnce(db, { force: true });

    const sent = String((fetchSpy.mock.calls[0]![1] as RequestInit).body);
    expect(sent).toContain("r1");
    expect(sent).not.toContain("devicePasscode");
    expect(sent).not.toContain("1234");
  });

  it("sends oldest first, so a half-delivered day is still in order", async () => {
    link();
    for (let i = 0; i < 3; i += 1) op({ after: { n: i } });
    const fetchSpy = cloud(() => ({ json: { ackedSeq: 3, duplicates: 0, serverTimeMs: 1 } }));
    vi.stubGlobal("fetch", fetchSpy);

    await pushOnce(db, { force: true });

    const body = JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body)) as {
      ops: Array<{ seq: number }>;
    };
    expect(body.ops.map((o) => o.seq)).toEqual([1, 2, 3]);
  });
});

describe("when the shop's line is down", () => {
  it("keeps the cursor where it was and records why, without throwing", async () => {
    link();
    op();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND pos.codroon.com");
    }));

    const status = await pushOnce(db, { force: true });

    expect(status.lastAckedSeq).toBe(0);
    expect(status.pending).toBe(1);
    expect(status.lastError).toContain("ENOTFOUND");
    expect(readLink()?.lastAckedSeq).toBe(0);
  });

  it("sends the same rows again when the line comes back, and the cloud sorts out the duplicates", async () => {
    link();
    op();
    op();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    await pushOnce(db, { force: true });
    expect(pendingCount(db)).toBe(2);

    const seen: number[][] = [];
    vi.stubGlobal("fetch", cloud((body) => {
      seen.push((body.ops as Array<{ seq: number }>).map((o) => o.seq));
      return { json: { ackedSeq: 2, duplicates: 1, serverTimeMs: 1 } };
    }));
    const status = await pushOnce(db, { force: true });

    expect(seen).toEqual([[1, 2]]); // the same two, from the same cursor
    expect(status.pending).toBe(0);
  });

  it("does not let a server error move the cursor forward", async () => {
    link();
    op();
    vi.stubGlobal("fetch", cloud(() => ({ ok: false, status: 500 })));

    const status = await pushOnce(db, { force: true });

    expect(status.lastAckedSeq).toBe(0);
    expect(status.lastError).toContain("500");
  });
});

describe("a till the account revoked", () => {
  it("stops retrying on the timer, and still sells", async () => {
    link();
    op();
    const fetchSpy = cloud(() => ({ ok: false, status: 401 }));
    vi.stubGlobal("fetch", fetchSpy);

    await pushOnce(db, { force: true });
    // the ordinary timer round is now backed off; only an explicit retry goes out
    await pushOnce(db);
    await pushOnce(db);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(syncStatus(db).lastError).toContain("401");
    // and the shop's own data is untouched: the till is a complete till
    expect(db.select().from(s.oplog).all()).toHaveLength(1);
  });
});

describe("unlinking", () => {
  it("removes the credential from the machine and leaves the books alone", async () => {
    link();
    op();
    const { unlink } = await import("../sync/enrol");

    const status = unlink(db);

    expect(status.linked).toBe(false);
    expect(readLink()).toBeNull();
    expect(db.select().from(s.oplog).all()).toHaveLength(1);
  });

  it("never writes the token into the shop's database", () => {
    /* ADR-0020 §1: the credential is machine state, not shop data — if it were
       a row it would be pushed to the service it authenticates */
    link();
    const rows = db.select().from(s.oplog).all();
    expect(rows.some((r) => JSON.stringify(r).includes("tok_"))).toBe(false);
    expect(db.select().from(s.settings).all().some((r) => r.value.includes("tok_"))).toBe(false);
  });
});
