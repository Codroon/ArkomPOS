/**
 * `GET /api/sync/pull` — the rules, without a Postgres. ADR-0022 §2–4.
 *
 * This endpoint hands one shop's data to one of its tills, so the cases below
 * are not style points. In order of what they would cost if wrong:
 *
 *   · **a revoked till must not READ.** Cutting off a stolen till's pushes
 *     while still serving it the shop's customers and phone numbers is not a
 *     meaningful idea of "cut off";
 *   · **a till must never receive its own rows**, or it re-applies them,
 *     re-pushes them and the echo never stops;
 *   · **only shared entities travel**, or a till is handed another till's
 *     printer, shift or invoice number;
 *   · **only settled rows travel**, or the cursor steps over a row whose
 *     transaction committed late and a sale is silently missing from one till;
 *   · **the cursor is the server's answer**, because only the server knows
 *     whether the batch was cut short by `limit`.
 */
import { describe, expect, it } from "vitest";
import { SHARED_ENTITIES, SYNC_SETTLE_MS, type SyncOp } from "@arkom/core";
import { pull } from "../pull";
import { memoryStore, type MemoryStore } from "./memory-store";

const NOW = new Date("2026-10-04T10:00:00.000Z");
/** written long enough ago that the settle window has passed */
const SETTLED = new Date(NOW.getTime() - 60_000);

let opCounter = 0;

function op(over: Partial<SyncOp> = {}): SyncOp {
  opCounter += 1;
  return {
    seq: opCounter,
    opId: `op-${opCounter}`,
    tenantId: "shop-1",
    locationId: "loc-1",
    terminalId: "term-1",
    entity: "product",
    entityId: `prod-${opCounter}`,
    action: "create",
    before: null,
    after: { id: `prod-${opCounter}`, name: "Funda", priceCents: 1000 },
    userId: "user-1",
    authorizedByUserId: null,
    createdAtMs: SETTLED.getTime(),
    ...over,
  };
}

/** A shop with two tills, and `them` has already written `ops`. */
async function shopWithTwoTills(ops: SyncOp[] = [], receivedAt: Date = SETTLED) {
  const store = memoryStore();
  const accountId = store.addAccount("Arkom");
  const them = store.addDevice({ accountId, tenantId: "shop-1", terminalId: "term-1" });
  const me = store.addDevice({ accountId, tenantId: "shop-1", terminalId: "term-2" });

  if (ops.length) {
    await store.recordBatch({ device: them.device, ops, appVersion: "1.3.0", now: receivedAt });
  }
  return { store, them, me, accountId };
}

const ask = (over: Record<string, unknown> = {}) => ({
  tenantId: "shop-1",
  terminalId: "term-2",
  appVersion: "1.3.0",
  afterIngestSeq: 0,
  ...over,
});

const get = (store: MemoryStore, token: string, query: Record<string, unknown> = {}) =>
  pull(store, { authorization: `Bearer ${token}`, query: ask(query) }, NOW);

describe("who may ask", () => {
  it("refuses a caller with no token", async () => {
    const { store } = await shopWithTwoTills();
    const res = await pull(store, { authorization: null, query: ask() }, NOW);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("UNAUTHENTICATED");
  });

  it("refuses a token that is not a token", async () => {
    const { store } = await shopWithTwoTills();
    const res = await get(store, "not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("refuses a REVOKED till — reading is cut off too", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Arkom");
    store.addDevice({ accountId, tenantId: "shop-1", terminalId: "term-1" });
    const stolen = store.addDevice({
      accountId,
      tenantId: "shop-1",
      terminalId: "term-2",
      revokedAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    const res = await get(store, stolen.token);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEVICE_REVOKED");
    expect(res.body.entries).toBeUndefined();
  });

  it("refuses a till asking for a tenant its token was not issued for", async () => {
    const { store, me } = await shopWithTwoTills();
    const res = await get(store, me.token, { tenantId: "somebody-elses-shop" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEVICE_MISMATCH");
  });

  it("refuses a till claiming to be a different terminal", async () => {
    const { store, me } = await shopWithTwoTills();
    const res = await get(store, me.token, { terminalId: "term-9" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("DEVICE_MISMATCH");
  });

  it("refuses a cursor that is not a number", async () => {
    const { store, me } = await shopWithTwoTills();
    const res = await get(store, me.token, { afterIngestSeq: "yesterday" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
  });
});

describe("what comes back", () => {
  it("serves a sibling till's rows", async () => {
    const { store, me } = await shopWithTwoTills([op(), op()]);
    const res = await get(store, me.token);

    expect(res.status).toBe(200);
    const entries = res.body.entries as SyncOp[];
    expect(entries).toHaveLength(2);
    expect(entries[0]!.entity).toBe("product");
  });

  it("never serves the caller its OWN rows — no echo (§6)", async () => {
    const { store, me } = await shopWithTwoTills();
    /* this till wrote something of its own */
    await store.recordBatch({
      device: me.device,
      ops: [op({ terminalId: "term-2" })],
      appVersion: "1.3.0",
      now: SETTLED,
    });

    const res = await get(store, me.token);
    expect(res.body.entries).toHaveLength(0);
  });

  it("serves only the entities ADR-0022 §1 calls the shop's", async () => {
    const notShared = ["setting", "document", "shift", "user", "repair_ticket", "store_credit_voucher"];
    const { store, me } = await shopWithTwoTills([
      op({ entity: "product" }),
      op({ entity: "stock_movement" }),
      ...notShared.map((entity) => op({ entity })),
    ]);

    const res = await get(store, me.token);
    const served = (res.body.entries as SyncOp[]).map((e) => e.entity);

    expect(served.sort()).toEqual(["product", "stock_movement"]);
    for (const entity of notShared) expect(served).not.toContain(entity);
  });

  it("serves every entity that IS shared, so the list is the only gate", async () => {
    const { store, me } = await shopWithTwoTills(SHARED_ENTITIES.map((entity) => op({ entity })));
    const res = await get(store, me.token);
    const served = (res.body.entries as SyncOp[]).map((e) => e.entity);
    expect(served.sort()).toEqual([...SHARED_ENTITIES].sort());
  });

  it("carries the identity the till applies on — entity_id, not the payload's id", async () => {
    /*
     * The bug `pnpm cloud:reconcile` caught, in the direction that would be
     * worse: a partial payload like `{status}` has no `id` in it at all, so an
     * applier keying on `after.id` would write every row to one NULL key.
     */
    const { store, me } = await shopWithTwoTills([
      op({ entity: "product", entityId: "prod-real", after: { priceCents: 2000 } }),
    ]);
    const entry = (await get(store, me.token)).body.entries as SyncOp[];
    expect(entry[0]!.entityId).toBe("prod-real");
    expect((entry[0]!.after as Record<string, unknown>).id).toBeUndefined();
  });

  it("strips a redacted key even if an old row somehow holds one", async () => {
    /*
     * It should be impossible for one to be in the table — the till strips
     * before queueing and ingest strips before storing. This is the third pass,
     * and it is the one that protects a shop from rows a PREVIOUS version
     * stored before the rule existed.
     */
    const { store, them, me } = await shopWithTwoTills();
    /* bypass ingest() entirely, the way a legacy row would have */
    await store.recordBatch({
      device: them.device,
      ops: [op({ entity: "product", after: { id: "p1", name: "iPhone", devicePasscode: "1234" } })],
      appVersion: "1.0.0",
      now: SETTLED,
    });

    const entries = (await get(store, me.token)).body.entries as SyncOp[];
    const after = entries[0]!.after as Record<string, unknown>;
    expect(after.devicePasscode).toBeUndefined();
    expect(after.name).toBe("iPhone");
    expect(JSON.stringify(entries)).not.toContain("1234");
  });

  it("tells the till the server's clock, so a wrong one is visible", async () => {
    const { store, me } = await shopWithTwoTills();
    const res = await get(store, me.token);
    expect(res.body.serverTimeMs).toBe(NOW.getTime());
  });
});

describe("the settle window (§4) — the cursor must not step over a late commit", () => {
  it("does not serve a row that arrived a moment ago", async () => {
    const justNow = new Date(NOW.getTime() - 1_000);
    const { store, me } = await shopWithTwoTills([op()], justNow);

    const res = await get(store, me.token);
    expect(res.body.entries).toHaveLength(0);
    /* and the cursor does NOT move past it, or it would never be served */
    expect(res.body.cursor).toBe(0);
  });

  it("serves it once the window has passed", async () => {
    const edge = new Date(NOW.getTime() - SYNC_SETTLE_MS - 1);
    const { store, me } = await shopWithTwoTills([op()], edge);

    const res = await get(store, me.token);
    expect(res.body.entries).toHaveLength(1);
  });

  it("holds the cursor behind an unsettled row even when later rows are shared", async () => {
    /*
     * The real shape of the bug: settled rows exist, and an unsettled one sits
     * among them. The frontier must stop at the settled ones, never jump past
     * the row still in flight.
     */
    const { store, them, me } = await shopWithTwoTills([op(), op()]);
    await store.recordBatch({
      device: them.device,
      ops: [op()],
      appVersion: "1.3.0",
      now: new Date(NOW.getTime() - 500),
    });

    const res = await get(store, me.token);
    expect(res.body.entries).toHaveLength(2);
    /* the frontier is the second row, not the third */
    expect(res.body.cursor).toBe(2);
    expect(res.body.more).toBe(false);

    /* and the third is served on the next tick, once it has settled */
    const later = new Date(NOW.getTime() + 10_000);
    const next = await pull(
      store,
      { authorization: `Bearer ${me.token}`, query: ask({ afterIngestSeq: res.body.cursor }) },
      later,
    );
    expect(next.body.entries).toHaveLength(1);
  });
});

describe("the cursor is the server's answer, not the batch's maximum", () => {
  it("advances past rows it examined and did not want", async () => {
    /*
     * Why this matters: a shop with ONE till would otherwise rescan its whole
     * stream on every tick forever, because nothing it writes is ever served
     * back to it and so `max(ingestSeq)` of an empty batch is nothing.
     */
    const { store, me } = await shopWithTwoTills();
    await store.recordBatch({
      device: me.device,
      ops: [op(), op(), op()],
      appVersion: "1.3.0",
      now: SETTLED,
    });

    const res = await get(store, me.token);
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.cursor).toBe(3);
    expect(res.body.more).toBe(false);
  });

  it("stops at the last row HANDED OVER when the batch is truncated", async () => {
    const { store, me } = await shopWithTwoTills([op(), op(), op(), op(), op()]);
    const res = await get(store, me.token, { limit: 2 });

    expect(res.body.entries).toHaveLength(2);
    expect(res.body.more).toBe(true);
    /* the second row, not the frontier — the other three are not delivered yet */
    expect(res.body.cursor).toBe(2);
  });

  it("drains in pages without losing or repeating a row", async () => {
    const { store, me } = await shopWithTwoTills(Array.from({ length: 7 }, () => op()));

    const seen: string[] = [];
    let cursor = 0;
    let more = true;
    let rounds = 0;

    while (more && rounds < 20) {
      rounds += 1;
      const res = await get(store, me.token, { afterIngestSeq: cursor, limit: 3 });
      for (const entry of res.body.entries as SyncOp[]) seen.push(entry.opId);
      cursor = res.body.cursor as number;
      more = res.body.more as boolean;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(rounds).toBe(3);
  });

  it("never moves backwards, even if a till sends a cursor ahead of the frontier", async () => {
    const { store, me } = await shopWithTwoTills([op()]);
    const res = await get(store, me.token, { afterIngestSeq: 9_999 });
    expect(res.body.entries).toHaveLength(0);
    expect(res.body.cursor).toBe(9_999);
  });
});
