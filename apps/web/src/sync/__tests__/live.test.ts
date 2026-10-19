/**
 * Under five seconds — ADR-0024 §2–3, the cloud's half.
 *
 *   · a push that stored something pokes the shop, and a replay pokes nobody;
 *   · a poke carries a tag and nothing else, on a topic nobody can derive from
 *     a tenant id, sent with the project's PUBLIC key;
 *   · the pull hands a till the channel and the names of its shop's tills and
 *     people — names only, never a role or anything a till could sign in with.
 */
import { describe, expect, it, vi } from "vitest";
import { uuidv7, type SyncOp } from "@arkom/core";
import { ingest } from "../ingest";
import { pull } from "../pull";
import { liveConfig, liveFor, liveTopic, poke } from "../live";
import { memoryStore } from "./memory-store";

const NOW = new Date("2026-10-19T10:00:00.000Z");
const CONFIG = { url: "https://proj.supabase.co", apiKey: "sb_publishable_abc", secret: "server-only" };

function op(over: Partial<SyncOp> = {}): SyncOp {
  return {
    seq: 1,
    opId: uuidv7(),
    tenantId: "shop-1",
    locationId: "loc-1",
    terminalId: "term-1",
    entity: "product",
    entityId: uuidv7(),
    action: "create",
    before: null,
    after: { name: "Funda" },
    userId: "user-1",
    authorizedByUserId: null,
    createdAtMs: NOW.getTime() - 1_000,
    ...over,
  };
}

function shop() {
  const store = memoryStore();
  const accountId = store.addAccount("Arkom");
  const one = store.addDevice({ accountId, tenantId: "shop-1", terminalId: "term-1" });
  const two = store.addDevice({ accountId, tenantId: "shop-1", terminalId: "term-2" });
  return { store, one, two };
}

const push = (ops: SyncOp[]) => ({ tenantId: "shop-1", terminalId: "term-1", appVersion: "1.4.0", ops });

describe("a push pokes the shop", () => {
  it("once it stored something new", async () => {
    const { store, one } = shop();
    const poked: string[] = [];
    const res = await ingest(store, { authorization: `Bearer ${one.token}`, body: push([op()]) }, NOW, async (t) =>
      poked.push(t),
    );
    expect(res.status).toBe(200);
    expect(poked).toEqual(["shop-1"]);
  });

  it("not for a replay of rows it already holds", async () => {
    const { store, one } = shop();
    const batch = [op()];
    await ingest(store, { authorization: `Bearer ${one.token}`, body: push(batch) }, NOW);
    const poked: string[] = [];
    await ingest(store, { authorization: `Bearer ${one.token}`, body: push(batch) }, NOW, async (t) => poked.push(t));
    expect(poked).toEqual([]);
  });

  it("and a poke that fails never un-acks the batch", async () => {
    const { store, one } = shop();
    const res = await ingest(store, { authorization: `Bearer ${one.token}`, body: push([op({ seq: 7 })]) }, NOW, () =>
      Promise.reject(new Error("realtime down")),
    );
    expect(res.status).toBe(200);
    expect(res.body.ackedSeq).toBe(7);
  });
});

describe("what a poke is", () => {
  it("a tag on a topic, sent with the public key", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    expect(await poke(CONFIG, "shop-1", "tag-1", fetchImpl as unknown as typeof fetch)).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/realtime/v1/api/broadcast");
    expect((init.headers as Record<string, string>).apikey).toBe("sb_publishable_abc");
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ topic: liveTopic("server-only", "shop-1"), event: "changed", payload: { tag: "tag-1" } }],
    });
  });

  it("never names the shop: the topic cannot be derived from the tenant id without the secret", () => {
    const topic = liveTopic("server-only", "shop-1");
    expect(topic).not.toContain("shop-1");
    expect(topic).toBe(liveTopic("server-only", "shop-1")); /* every till of the shop agrees */
    expect(topic).not.toBe(liveTopic("server-only", "shop-2"));
    expect(topic).not.toBe(liveTopic("another-secret", "shop-1"));
  });

  it("is skipped, not failed, when Realtime is not configured or does not answer", async () => {
    expect(await poke(null, "shop-1", "t")).toBe(false);
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await poke(CONFIG, "shop-1", "t", down as unknown as typeof fetch)).toBe(false);
  });

  it("is configured from the public pair and a server secret, and never hands out the secret", () => {
    const config = liveConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co/",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc",
      DATABASE_URL: "postgres://user:pw@host/db",
    });
    expect(config?.url).toBe("https://proj.supabase.co");
    const handed = liveFor(config, "shop-1");
    expect(JSON.stringify(handed)).not.toContain("pw@host");
    expect(liveConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" })).toBeNull();
  });
});

describe("what a pull hands a till", () => {
  it("the shop's till names and people's names, and nothing else about them", async () => {
    const { store, one, two } = shop();
    await ingest(
      store,
      {
        authorization: `Bearer ${one.token}`,
        body: push([
          op({ seq: 1, entity: "user", entityId: "u-rosa", after: { name: "Rosa", role: "technician" } }),
          op({ seq: 2, entity: "user", entityId: "u-rosa", action: "login", after: { name: "Rosa María" }, createdAtMs: NOW.getTime() - 500 }),
          op({ seq: 3, entity: "terminal", entityId: "term-1", action: "rename", after: { name: "Caja 1" } }),
        ]),
      },
      NOW,
    );

    const res = await pull(
      store,
      { authorization: `Bearer ${two.token}`, query: { tenantId: "shop-1", terminalId: "term-2", appVersion: "1.4.0", afterIngestSeq: 0 } },
      NOW,
      CONFIG,
    );
    expect(res.status).toBe(200);
    const directory = res.body.directory as { tills: { terminalId: string; name: string }[]; staff: unknown[] };
    /* the latest name, by when it happened */
    expect(directory.staff).toEqual([{ userId: "u-rosa", name: "Rosa María" }]);
    expect(directory.tills).toContainEqual({ terminalId: "term-1", name: "Caja 1" });
    expect(JSON.stringify(directory)).not.toContain("technician");

    expect(res.body.live).toEqual({ url: CONFIG.url, apiKey: CONFIG.apiKey, topic: liveTopic(CONFIG.secret, "shop-1") });
  });

  it("no channel when Realtime is not configured, so the till keeps its timer", async () => {
    const { store, two } = shop();
    const res = await pull(
      store,
      { authorization: `Bearer ${two.token}`, query: { tenantId: "shop-1", terminalId: "term-2", appVersion: "1.4.0", afterIngestSeq: 0 } },
      NOW,
    );
    expect(res.body.live).toBeNull();
  });
});
