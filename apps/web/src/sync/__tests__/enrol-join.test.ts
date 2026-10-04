/**
 * A second till JOINS a shop instead of founding one — ADR-0022 §9.
 *
 * This is the bug, written as tests. Arkom enrolled two tills on consecutive
 * days and the dashboard showed two shops: one with 31 products and 5 sales,
 * one with 377 products and 237 stock movements, with nothing in common. Both
 * tills were behaving exactly as designed. The design had no way for a till to
 * say "I am another counter in a shop that already exists", so each install
 * invented a shop and the up-only sync carried both upward, faithfully and
 * forever apart.
 *
 * The fix is one field in the RESPONSE: the cloud tells the till which keys to
 * use. Everything below is about that field being right, including in the three
 * cases where getting it wrong would be worse than the bug —
 *
 *   · a joining till must not rename somebody's shop;
 *   · a till already enrolled must not be moved or locked out by re-enrolling;
 *   · an account with two shops must be REFUSED, not guessed at, because
 *     picking one would silently strand the other's history.
 */
import { describe, expect, it } from "vitest";
import { enrol } from "../enrol";
import { memoryStore, type MemoryStore } from "./memory-store";

const NOW = new Date("2026-10-04T10:00:00.000Z");

const body = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  tenantId: "tenant-invented-at-first-run",
  locationId: "loc-invented",
  terminalId: "term-2",
  terminalName: "Caja 2",
  shopName: "Lo que escribió el ayudante",
  appVersion: "1.3.0",
  ...over,
});

/** An account whose first till is already enrolled and selling. */
function shopWithOneTill(): { store: MemoryStore; accountId: string; tenantId: string } {
  const store = memoryStore();
  const accountId = store.addAccount("Arkom");
  store.addDevice({
    accountId,
    tenantId: "tenant-the-real-shop",
    terminalId: "term-1",
    locationId: "loc-the-real-shop",
  });
  store.tenants.get("tenant-the-real-shop")!.name = "Arkom Móviles";
  return { store, accountId, tenantId: "tenant-the-real-shop" };
}

describe("the first till founds the shop", () => {
  it("keeps the keys it generated at first run", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Arkom");
    const res = await enrol(store, body(store.addCode(accountId)), NOW);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-invented-at-first-run");
    expect(res.body.locationId).toBe("loc-invented");
    expect(res.body.adopted).toBe(false);
    expect(res.body.tillCount).toBe(1);
  });

  it("names the shop, because there is nobody else to have named it", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Arkom");
    await enrol(store, body(store.addCode(accountId), { shopName: "Arkom Móviles" }), NOW);
    expect(store.tenants.get("tenant-invented-at-first-run")!.name).toBe("Arkom Móviles");
  });
});

describe("the second till joins it", () => {
  it("is handed the SHOP's tenant, not the one it invented", async () => {
    const { store, accountId, tenantId } = shopWithOneTill();
    const res = await enrol(store, body(store.addCode(accountId)), NOW);

    expect(res.status).toBe(200);
    expect(res.body.adopted).toBe(true);
    expect(res.body.tenantId).toBe(tenantId);
    /* and the shop it invented was never created */
    expect(store.tenants.has("tenant-invented-at-first-run")).toBe(false);
  });

  it("is handed the shop's LOCATION too, or its stock would be on another shelf", async () => {
    /*
     * `product_stock` is keyed by location, not terminal (ADR-0009). A till
     * that kept its own `locationId` would push movements for a shelf nobody
     * else can see, and the two tills would agree on the catalogue while
     * disagreeing about every quantity — which is harder to spot than two
     * shops, not easier.
     */
    const { store, accountId } = shopWithOneTill();
    const res = await enrol(store, body(store.addCode(accountId)), NOW);
    expect(res.body.locationId).toBe("loc-the-real-shop");
  });

  it("does NOT rename the shop", async () => {
    const { store, accountId } = shopWithOneTill();
    const res = await enrol(
      store,
      body(store.addCode(accountId), { shopName: "Lo que escribió el ayudante" }),
      NOW,
    );

    expect(store.tenants.get("tenant-the-real-shop")!.name).toBe("Arkom Móviles");
    /* and it is told the shop's real name, to show in Ajustes */
    expect(res.body.shopName).toBe("Arkom Móviles");
  });

  it("keeps its own terminalId, which is the one thing that must stay unique", async () => {
    const { store, accountId } = shopWithOneTill();
    await enrol(store, body(store.addCode(accountId), { terminalId: "term-2" }), NOW);

    const terminals = [...store.devices.values()]
      .filter((d) => d.tenantId === "tenant-the-real-shop")
      .map((d) => d.terminalId)
      .sort();
    expect(terminals).toEqual(["term-1", "term-2"]);
  });

  it("counts the tills, so Ajustes can say which of how many this is", async () => {
    const { store, accountId } = shopWithOneTill();
    const second = await enrol(store, body(store.addCode(accountId)), NOW);
    expect(second.body.tillCount).toBe(2);

    const third = await enrol(store, body(store.addCode(accountId), { terminalId: "term-3" }), NOW);
    expect(third.body.tillCount).toBe(3);
  });

  it("can then pull what the first till wrote", async () => {
    /* the join is only worth anything if the data follows, so this asserts the
       two halves meet: adopted keys make the sibling's rows visible */
    const { store, accountId } = shopWithOneTill();
    const joined = await enrol(store, body(store.addCode(accountId)), NOW);

    const them = [...store.devices.values()].find((d) => d.terminalId === "term-1")!;
    await store.recordBatch({
      device: them,
      ops: [
        {
          seq: 1,
          opId: "op-1",
          tenantId: "tenant-the-real-shop",
          locationId: "loc-the-real-shop",
          terminalId: "term-1",
          entity: "product",
          entityId: "prod-1",
          action: "create",
          before: null,
          after: { id: "prod-1", name: "Funda" },
          userId: null,
          authorizedByUserId: null,
          createdAtMs: NOW.getTime(),
        },
      ],
      appVersion: "1.3.0",
      now: NOW,
    });

    const me = await store.deviceByToken(String(joined.body.deviceToken));
    const batch = await store.pullBatch({
      device: me!,
      afterIngestSeq: 0,
      limit: 100,
      entities: ["product"],
      settleBefore: new Date(NOW.getTime() + 60_000),
    });

    expect(batch.entries).toHaveLength(1);
    expect(batch.entries[0]!.entityId).toBe("prod-1");
  });
});

describe("a till that is already in the shop", () => {
  it("re-enrols without being moved — a rotation is not a migration", async () => {
    const { store, accountId, tenantId } = shopWithOneTill();
    const res = await enrol(
      store,
      body(store.addCode(accountId), { tenantId, terminalId: "term-1" }),
      NOW,
    );

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.adopted).toBe(false);
  });

  it("is let back in even when the account has the two shops this ADR forbids", async () => {
    /*
     * Arkom's present state. Re-enrolling a WORKING till must never be the
     * thing that refuses it — the owner reaching for Ajustes → Nube on the till
     * that already works is not the moment to discover a data-modelling
     * problem.
     */
    const { store, accountId } = shopWithOneTill();
    store.addDevice({ accountId, tenantId: "tenant-the-other-one", terminalId: "term-9" });

    const res = await enrol(
      store,
      body(store.addCode(accountId), { tenantId: "tenant-the-real-shop", terminalId: "term-1" }),
      NOW,
    );
    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-the-real-shop");
  });
});

describe("an account with two shops", () => {
  it("refuses a NEW till rather than guessing which one it meant", async () => {
    const { store, accountId } = shopWithOneTill();
    store.addDevice({ accountId, tenantId: "tenant-the-other-one", terminalId: "term-9" });

    const res = await enrol(store, body(store.addCode(accountId)), NOW);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("SHOP_AMBIGUOUS");
    /* and says which two, so support is told facts rather than asked questions */
    expect(res.body.tenantIds).toEqual(
      expect.arrayContaining(["tenant-the-real-shop", "tenant-the-other-one"]),
    );
  });

  it("spends no code on a refusal", async () => {
    const { store, accountId } = shopWithOneTill();
    store.addDevice({ accountId, tenantId: "tenant-the-other-one", terminalId: "term-9" });

    const code = store.addCode(accountId);
    await enrol(store, body(code), NOW);

    /* the code is still good: what was wrong was the shop's state, not the code,
       and the owner should not lose one over it */
    const stillUnspent = [...store.codes.values()].every((c) => c.usedAt === null);
    expect(stillUnspent).toBe(true);
  });
});

describe("what adoption may never do", () => {
  it("still refuses a till whose tenant belongs to another account", async () => {
    /* ADR-0020's guarantee, unchanged: adoption works within an account and
       cannot reach across one. */
    const store = memoryStore();
    const mine = store.addAccount("Arkom");
    const theirs = store.addAccount("Somebody else");
    store.addDevice({ accountId: theirs, tenantId: "tenant-theirs", terminalId: "term-1" });

    const res = await enrol(store, body(store.addCode(mine), { tenantId: "tenant-theirs" }), NOW);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("TENANT_CLAIMED");
  });

  it("never moves a shop between accounts", async () => {
    const store = memoryStore();
    const mine = store.addAccount("Arkom");
    const theirs = store.addAccount("Somebody else");
    store.addDevice({ accountId: theirs, tenantId: "tenant-theirs", terminalId: "term-1" });

    await enrol(store, body(store.addCode(mine), { tenantId: "tenant-theirs" }), NOW);
    expect(store.tenants.get("tenant-theirs")!.accountId).toBe(theirs);
  });
});
