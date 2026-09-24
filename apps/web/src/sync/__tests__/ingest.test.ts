/**
 * The cloud's front door — ADR-0020 §1–2.
 *
 * Two kinds of case, and both are about somebody else's shop. The first kind is
 * trust: a token buys one till's stream and nothing near anyone else's. The
 * second is the cursor: what we ack is what we stored, because the till throws
 * away nothing except what we have said we hold.
 *
 * The happy path is one test. The rest of this file is the ways a shop could
 * lose a day's history, each one pinned so it cannot start happening quietly.
 */
import { describe, expect, it } from "vitest";
import { uuidv7, type SyncOp } from "@arkom/core";
import { ingest } from "../ingest";
import { memoryStore, type MemoryStore } from "./memory-store";

const TENANT = "tenant-garcia";
const OTHER = "tenant-lopez";
const NOW = new Date("2026-09-24T10:00:00.000Z");

function setup(): { store: MemoryStore; token: string; accountId: string } {
  const store = memoryStore();
  const accountId = store.addAccount("Codroon");
  const { token } = store.addDevice({ accountId, tenantId: TENANT });
  return { store, token, accountId };
}

function op(over: Partial<SyncOp> = {}): SyncOp {
  return {
    seq: 1,
    opId: uuidv7(),
    tenantId: TENANT,
    locationId: "loc-1",
    terminalId: "term-1",
    entity: "document",
    entityId: uuidv7(),
    action: "complete",
    before: null,
    after: { docNumber: "T1-000001", totalCents: 12_500 },
    userId: "u1",
    authorizedByUserId: null,
    createdAtMs: NOW.getTime(),
    ...over,
  };
}

const push = (ops: SyncOp[], over: Record<string, unknown> = {}) => ({
  tenantId: TENANT,
  terminalId: "term-1",
  appVersion: "1.1.0",
  ops,
  ...over,
});

const send = (store: MemoryStore, token: string | null, body: unknown) =>
  ingest(store, { authorization: token === null ? null : `Bearer ${token}`, body }, NOW);

describe("who is allowed to write", () => {
  it("turns away a caller with no credential, before it reads the batch", async () => {
    const { store } = setup();

    const res = await send(store, null, push([op()]));

    expect(res.status).toBe(401);
    expect(store.entries.size).toBe(0);
  });

  it("turns away a token nobody issued", async () => {
    const { store } = setup();

    const res = await send(store, "cdrn_not-a-real-token-at-all", push([op()]));

    expect(res.status).toBe(401);
    expect(store.entries.size).toBe(0);
  });

  it("says REVOKED rather than UNAUTHENTICATED for a till the account cut off", async () => {
    /* the till stops either way; the difference is what the owner reads in
       Ajustes, and only one of the two is something they did */
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const { token } = store.addDevice({ accountId, tenantId: TENANT, revokedAt: NOW });

    const res = await send(store, token, push([op()]));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "DEVICE_REVOKED" });
    expect(store.entries.size).toBe(0);
  });

  it("refuses a batch whose envelope names a different till", async () => {
    const { store, token } = setup();

    const res = await send(store, token, push([op()], { terminalId: "term-somebody-else" }));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "DEVICE_MISMATCH" });
    expect(store.entries.size).toBe(0);
  });

  it("refuses a batch whose envelope names a different shop", async () => {
    const { store, token } = setup();

    const res = await send(store, token, push([op()], { tenantId: OTHER }));

    expect(res.status).toBe(403);
    expect(store.entries.size).toBe(0);
  });

  it("rejects the WHOLE batch when one row belongs to another shop, keeping none of it", async () => {
    /* ADR-0020 §1: rejected, not ignored. Storing the honest rows and dropping
       the one would leave the till believing it had delivered all three. */
    const { store, token } = setup();
    const ours = op({ seq: 1 });
    const theirs = op({ seq: 2, tenantId: OTHER });
    const alsoOurs = op({ seq: 3 });

    const res = await send(store, token, push([ours, theirs, alsoOurs]));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "TENANT_MISMATCH", opId: theirs.opId });
    expect(store.entries.size).toBe(0);
  });

  it("accepts a row that names a terminal which no longer exists", async () => {
    /* a shop restores its backup onto a replacement PC: the old rows still say
       they were written on the old till. Refusing them would strand that
       shop's history for good — the boundary is the tenant, and the credential
       that delivered each row is recorded beside it */
    const { store, token } = setup();
    const fromTheOldPc = op({ terminalId: "term-the-one-that-died" });

    const res = await send(store, token, push([fromTheOldPc]));

    expect(res.status).toBe(200);
    const [stored] = store.entriesFor(TENANT);
    expect(stored?.terminalId).toBe("term-the-one-that-died");
    expect(stored?.deviceId).toBe([...store.devices.values()][0]?.id);
  });
});

describe("what comes back", () => {
  it("stores the batch and acks the highest seq in it", async () => {
    const { store, token } = setup();

    const res = await send(store, token, push([op({ seq: 1 }), op({ seq: 2 }), op({ seq: 3 })]));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ackedSeq: 3, duplicates: 0, serverTimeMs: NOW.getTime() });
    expect(store.entriesFor(TENANT).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("counts a replayed batch as duplicates and stores it once", async () => {
    const { store, token } = setup();
    const batch = [op({ seq: 1 }), op({ seq: 2 })];

    await send(store, token, push(batch));
    const again = await send(store, token, push(batch));

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ackedSeq: 2, duplicates: 2 });
    expect(store.entries.size).toBe(2);
  });

  it("acks the batch it was given, not the cursor it remembers", async () => {
    /* the re-enrolment case: the till has reset to zero and is replaying, while
       our copy of the cursor still says 500. Answering 500 would make it skip
       everything from 201 to 500 — a shop's month, gone, with no error */
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const { token } = store.addDevice({ accountId, tenantId: TENANT, lastAckedSeq: 500 });

    const res = await send(store, token, push([op({ seq: 1 }), op({ seq: 2 })]));

    expect(res.body).toMatchObject({ ackedSeq: 2 });
    /* our own copy stays where it was: it is a display, and displays do not go
       backwards while a till catches up */
    expect([...store.devices.values()][0]?.lastAckedSeq).toBe(500);
  });

  it("acks the cursor it holds when a push carries nothing", async () => {
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const { token } = store.addDevice({ accountId, tenantId: TENANT, lastAckedSeq: 12 });

    const res = await send(store, token, push([]));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ackedSeq: 12, duplicates: 0 });
  });

  it("does not repeat the shop's data back in a validation error", async () => {
    /* an error body is the part of a request most likely to end up in a log
       aggregator, so it says where the batch was wrong and never what was in it */
    const { store, token } = setup();
    /* built by hand rather than through push(): the point of the case is a
       batch that does NOT satisfy the contract */
    const bad = {
      tenantId: TENANT,
      terminalId: "term-1",
      appVersion: "1.1.0",
      ops: [{ ...op(), seq: "el primero", after: { customerName: "Marta Ruiz" } }],
    };

    const res = await send(store, token, bad);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain("Marta");
    expect(JSON.stringify(res.body)).toContain("ops.0.seq");
  });
});

describe("the secrets that must not become durable", () => {
  it("stores no device passcode, even when a till sends one", async () => {
    /* the till strips it before queuing (ADR-0020 §3) and core's tests pin
       that. This pins the far end refusing to be where a leak lasts: an old
       build, a future bug, or a hand-made batch all land here */
    const { store, token } = setup();
    const leaky = op({
      entity: "repair_ticket",
      action: "create",
      after: { ticketId: "r1", devicePasscode: "1234", device: { passcode: "9999" } },
    });

    const res = await send(store, token, push([leaky]));

    expect(res.status).toBe(200);
    const dump = JSON.stringify([...store.entries.values()]);
    expect(dump).toContain("r1");
    expect(dump).not.toContain("1234");
    expect(dump).not.toContain("9999");
    expect(dump).not.toContain("passcode");
  });

  it("keeps the customer's row, which is the whole point of hosting it", async () => {
    const { store, token } = setup();
    const sale = op({
      entity: "customer",
      action: "create",
      after: { name: "Marta Ruiz", phone: "600123456", taxId: "12345678Z" },
    });

    await send(store, token, push([sale]));

    const dump = JSON.stringify(store.entriesFor(TENANT));
    expect(dump).toContain("Marta Ruiz");
    expect(dump).toContain("600123456");
  });
});

describe("deleting a shop", () => {
  it("takes its rows and its tills with it, and leaves the neighbour alone", async () => {
    /* ADR-0020 §4: a feature, built before the first paying customer — not a
       support ticket answered with SQL at midnight */
    const store = memoryStore();
    const accountId = store.addAccount("Codroon");
    const ours = store.addDevice({ accountId, tenantId: TENANT });
    const theirs = store.addDevice({ accountId, tenantId: OTHER, terminalId: "term-2" });

    await send(store, ours.token, push([op({ seq: 1 }), op({ seq: 2 })]));
    await ingest(
      store,
      {
        authorization: `Bearer ${theirs.token}`,
        body: {
          tenantId: OTHER,
          terminalId: "term-2",
          appVersion: "1.1.0",
          ops: [op({ tenantId: OTHER, terminalId: "term-2" })],
        },
      },
      NOW,
    );

    const removed = await store.deleteTenant(TENANT);

    expect(removed).toEqual({ entries: 2, devices: 1 });
    expect(store.entriesFor(TENANT)).toHaveLength(0);
    expect(store.entriesFor(OTHER)).toHaveLength(1);
    expect(await store.deviceByToken(ours.token)).toBeNull();
    expect(await store.deviceByToken(theirs.token)).not.toBeNull();
  });
});
