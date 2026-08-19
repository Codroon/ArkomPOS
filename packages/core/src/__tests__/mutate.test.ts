import { describe, expect, it } from "vitest";
import { mutate, toOplogJson, type MutateRunner, type OplogEntry } from "../mutate";

type FakeTx = { writes: string[] };

function fakeRunner() {
  const state = {
    txCount: 0,
    committed: false,
    rolledBack: false,
    oplogWritten: [] as OplogEntry[],
    writeOrder: [] as string[],
  };
  const runner: MutateRunner<FakeTx> = {
    transaction<T>(fn: (tx: FakeTx) => T): T {
      state.txCount++;
      const tx: FakeTx = { writes: [] };
      try {
        const result = fn(tx);
        state.committed = true;
        return result;
      } catch (err) {
        state.rolledBack = true; // a real driver discards tx.writes here
        throw err;
      }
    },
    writeOplog(tx, entries) {
      tx.writes.push("oplog");
      state.writeOrder.push("oplog");
      state.oplogWritten.push(...entries);
    },
  };
  return { runner, state };
}

const CTX = { tenantId: "t1", locationId: "l1", terminalId: "term1", userId: null };

describe("mutate", () => {
  it("wraps business writes and oplog entries in one transaction, oplog last", () => {
    const { runner, state } = fakeRunner();
    const result = mutate(runner, CTX, (tx, log) => {
      tx.writes.push("product");
      state.writeOrder.push("product");
      log({ entity: "product", entityId: "p1", action: "create", before: null, after: { id: "p1" } });
      return "ok";
    });
    expect(result).toBe("ok");
    expect(state.txCount).toBe(1);
    expect(state.committed).toBe(true);
    expect(state.writeOrder).toEqual(["product", "oplog"]);
    expect(state.oplogWritten).toHaveLength(1);
  });

  it("stamps entries with ctx, a UUIDv7 opId and a timestamp; keeps before/after verbatim", () => {
    const { runner, state } = fakeRunner();
    const before = { costCents: 100 };
    const after = { costCents: 200 };
    mutate(runner, CTX, (_tx, log) => {
      log({ entity: "product", entityId: "p1", action: "update", before, after });
    });
    const entry = state.oplogWritten[0]!;
    expect(entry).toMatchObject({ ...CTX, entity: "product", entityId: "p1", action: "update" });
    expect(entry.before).toBe(before);
    expect(entry.after).toBe(after);
    expect(entry.opId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it("gives every entry of a batch its own opId", () => {
    const { runner, state } = fakeRunner();
    mutate(runner, CTX, (_tx, log) => {
      for (let i = 0; i < 50; i++) {
        log({ entity: "e", entityId: `id${i}`, action: "create", before: null, after: {} });
      }
    });
    expect(new Set(state.oplogWritten.map((e) => e.opId)).size).toBe(50);
  });

  it("throws (and rolls back) when build records no oplog entry — ADR-0005", () => {
    const { runner, state } = fakeRunner();
    expect(() =>
      mutate(runner, CTX, (tx) => {
        tx.writes.push("product"); // a write that skips the oplog is a bug
        return "nope";
      }),
    ).toThrow(/no oplog entries/);
    expect(state.rolledBack).toBe(true);
    expect(state.oplogWritten).toHaveLength(0);
  });

  it("propagates build errors without writing any oplog", () => {
    const { runner, state } = fakeRunner();
    expect(() =>
      mutate(runner, CTX, (_tx, log) => {
        log({ entity: "e", entityId: "1", action: "create", before: null, after: {} });
        throw new Error("domain rejection");
      }),
    ).toThrow("domain rejection");
    expect(state.rolledBack).toBe(true);
    expect(state.oplogWritten).toHaveLength(0);
  });
});

describe("toOplogJson", () => {
  it("converts Date values to epoch ms and leaves the rest untouched", () => {
    const d = new Date(1_700_000_000_000);
    expect(toOplogJson({ id: "x", createdAt: d, costCents: 120, barcode: null })).toEqual({
      id: "x",
      createdAt: 1_700_000_000_000,
      costCents: 120,
      barcode: null,
    });
  });
});
