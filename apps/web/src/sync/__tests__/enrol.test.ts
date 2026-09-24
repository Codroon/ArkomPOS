/**
 * Claiming a till for an account — ADR-0020 §1.
 *
 * The code is the only thing standing between a stranger and a shop's stream,
 * so the cases here are about spending it exactly once, telling a caller
 * nothing they did not already know, and never letting one account adopt
 * another account's shop.
 */
import { describe, expect, it } from "vitest";
import { enrol } from "../enrol";
import { ingest } from "../ingest";
import { memoryStore, type MemoryStore } from "./memory-store";

const NOW = new Date("2026-09-24T10:00:00.000Z");
const TENANT = "tenant-garcia";

const body = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  tenantId: TENANT,
  locationId: "loc-1",
  terminalId: "term-1",
  terminalName: "Caja mostrador",
  shopName: "Telefonía García",
  appVersion: "1.1.0",
  ...over,
});

function setup(): { store: MemoryStore; accountId: string; code: string } {
  const store = memoryStore();
  const accountId = store.addAccount("Codroon");
  return { store, accountId, code: store.addCode(accountId) };
}

describe("a good code", () => {
  it("buys a token, records the shop under the account, and spends itself", async () => {
    const { store, accountId, code } = setup();

    const res = await enrol(store, body(code), NOW);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accountName: "Codroon", shopName: "Telefonía García" });
    expect(String(res.body.deviceToken).length).toBeGreaterThanOrEqual(20);
    expect(store.tenants.get(TENANT)).toMatchObject({ accountId, name: "Telefonía García" });
    expect([...store.codes.values()][0]?.usedAt).toEqual(NOW);
  });

  it("returns a token that the sync door accepts", async () => {
    /* the two halves meet here: whatever enrolment hands back has to be a
       credential the ingest route recognises, or the shop links and then sits
       there failing to push with nothing on screen to explain it */
    const { store, code } = setup();

    const res = await enrol(store, body(code), NOW);
    const device = await store.deviceByToken(String(res.body.deviceToken));

    expect(device).toMatchObject({ tenantId: TENANT, terminalId: "term-1", revokedAt: null });
  });

  it("keeps the token out of the database in plain text", async () => {
    const { store, code } = setup();

    const res = await enrol(store, body(code), NOW);

    const token = String(res.body.deviceToken);
    const dump = JSON.stringify([...store.devices.values()]);
    expect(dump).not.toContain(token);
    /* nor a prefix of it: a partial secret in a dump is still a head start */
    expect(dump).not.toContain(token.slice(5, 20));
  });
});

describe("a code that should not work", () => {
  it("refuses one nobody issued", async () => {
    const { store } = setup();

    const res = await enrol(store, body("ABCD-EFGH-JKLM"), NOW);

    expect(res.status).toBe(404);
    expect(store.devices.size).toBe(0);
  });

  it("refuses the second use of one that worked", async () => {
    const { store, code } = setup();

    await enrol(store, body(code), NOW);
    const second = await enrol(store, body(code, { tenantId: "tenant-somebody-else" }), NOW);

    expect(second.status).toBe(404);
    expect(store.tenants.has("tenant-somebody-else")).toBe(false);
  });

  it("refuses one that has expired", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const code = store.addCode(accountId, { expiresAt: new Date("2026-09-01T00:00:00.000Z") });

    const res = await enrol(store, body(code), NOW);

    expect(res.status).toBe(404);
  });

  it("says the same thing to all three, because the difference is not the caller's business", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const spent = store.addCode(accountId);
    const expired = store.addCode(accountId, { expiresAt: new Date("2026-09-01T00:00:00.000Z") });
    await enrol(store, body(spent), NOW);

    const answers = await Promise.all([
      enrol(store, body("ABCD-EFGH-JKLM", { tenantId: "t-a" }), NOW),
      enrol(store, body(spent, { tenantId: "t-b" }), NOW),
      enrol(store, body(expired, { tenantId: "t-c" }), NOW),
    ]);

    expect(answers.map((a) => a.status)).toEqual([404, 404, 404]);
    expect(new Set(answers.map((a) => JSON.stringify(a.body))).size).toBe(1);
  });

  it("rejects a code that is not shaped like one, without reaching the database", async () => {
    const { store } = setup();

    const res = await enrol(store, body("hola"), NOW);

    expect(res.status).toBe(400);
    expect([...store.codes.values()][0]?.usedAt).toBeNull();
  });
});

describe("a shop already belongs to somebody", () => {
  it("will not let a second account adopt it, and gives the code back", async () => {
    /* the code was good; what was wrong was where it was pasted. Spending it
       would cost the owner a code for somebody else's mistake */
    const store = memoryStore();
    const first = store.addAccount("Codroon");
    const second = store.addAccount("Otra empresa");
    await enrol(store, body(store.addCode(first)), NOW);
    const theirCode = store.addCode(second);

    const res = await enrol(store, body(theirCode), NOW);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "TENANT_CLAIMED" });
    expect(store.tenants.get(TENANT)?.accountId).toBe(first);
    const unspent = [...store.codes.values()].find((c) => c.accountId === second);
    expect(unspent?.usedAt).toBeNull();
  });
});

describe("enrolling a till that was already enrolled", () => {
  it("rotates the token instead of leaving the old one alive", async () => {
    /* the shop replaced the PC, or the owner re-linked after a revocation.
       One till is one row; an old token that still works is a spare key
       nobody remembers cutting */
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const first = await enrol(store, body(store.addCode(accountId)), NOW);
    const oldToken = String(first.body.deviceToken);

    const second = await enrol(store, body(store.addCode(accountId)), NOW);
    const newToken = String(second.body.deviceToken);

    expect(newToken).not.toBe(oldToken);
    expect(store.devices.size).toBe(1);
    expect(await store.deviceByToken(oldToken)).toBeNull();
    expect(await store.deviceByToken(newToken)).not.toBeNull();
  });

  it("lifts a revocation, because the account is the one handing out the code", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    await enrol(store, body(store.addCode(accountId)), NOW);
    const device = [...store.devices.values()][0]!;
    device.revokedAt = NOW;

    const again = await enrol(store, body(store.addCode(accountId)), NOW);
    const res = await ingest(
      store,
      {
        authorization: `Bearer ${String(again.body.deviceToken)}`,
        body: { tenantId: TENANT, terminalId: "term-1", appVersion: "1.1.0", ops: [] },
      },
      NOW,
    );

    expect(res.status).toBe(200);
  });

  it("does not rewind what we already hold for that till", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    await enrol(store, body(store.addCode(accountId)), NOW);
    const device = [...store.devices.values()][0]!;
    device.lastAckedSeq = 431;

    await enrol(store, body(store.addCode(accountId)), NOW);

    expect([...store.devices.values()][0]?.lastAckedSeq).toBe(431);
  });
});
