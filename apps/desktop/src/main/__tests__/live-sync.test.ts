/**
 * Under five seconds — ADR-0024 §3, the till's half.
 *
 * Two mechanisms, each tested where it can fail:
 *
 *   · a committed write rings the outbox, so a sale leaves within a fraction of
 *     a second instead of at the next minute — and a write that ROLLED BACK
 *     rings nothing, because there is nothing to send;
 *   · the live channel turns a poke into a pull, ignores the till's own echo,
 *     and recovers from a socket that dies, so a till whose Wi-Fi blinked is
 *     back to instant within seconds and was never worse than the old timer.
 *
 * The socket is a fake that speaks the four Phoenix messages the listener
 * uses. The real channel was proved against the live Supabase project before
 * this was written (a poke arrived 485 ms after it was sent); what is pinned
 * here is the till's behaviour around it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mutate } from "@arkom/core";
import { openDb, runMigrations, schema as s } from "@arkom/db";
import "./electron-stub";
import { makeMutateRunner } from "../mutate-runner";
import { onLocalWrite } from "../sync/outbox-signal";
import { listenStatus, rememberOwnPoke, startListening, stopListening } from "../sync/listen";

const MIGRATIONS = join(__dirname, "../../../../../packages/db/drizzle");
const CTX = { tenantId: "t1", locationId: "l1", terminalId: "term1", userId: null };

describe("a committed write rings the outbox", () => {
  let off: (() => void) | null = null;
  afterEach(() => off?.());

  function freshDb() {
    const { db } = openDb(join(mkdtempSync(join(tmpdir(), "arkom-live-")), "t.db"));
    runMigrations(db, MIGRATIONS);
    return db;
  }

  it("once per write, after it committed", () => {
    const db = freshDb();
    let rang = 0;
    let oplogAtRing = -1;
    off = onLocalWrite(() => {
      rang += 1;
      /* what the push would read: the entry is already there */
      oplogAtRing = db.select().from(s.oplog).all().length;
    });

    mutate(makeMutateRunner(db), CTX, (_tx, log) => {
      log({ entity: "setting", entityId: "k", action: "update", before: null, after: { key: "k", value: "1" } });
    });

    expect(rang).toBe(1);
    expect(oplogAtRing).toBe(1);
  });

  it("not at all for a write that rolled back", () => {
    const db = freshDb();
    let rang = 0;
    off = onLocalWrite(() => (rang += 1));

    expect(() =>
      mutate(makeMutateRunner(db), CTX, (_tx, log) => {
        log({ entity: "setting", entityId: "k", action: "update", before: null, after: {} });
        throw new Error("refused");
      }),
    ).toThrow("refused");

    expect(rang).toBe(0);
    expect(db.select().from(s.oplog).all()).toHaveLength(0);
  });

  it("never lets a broken listener fail the write that rang it", () => {
    const db = freshDb();
    off = onLocalWrite(() => {
      throw new Error("push exploded");
    });
    expect(() =>
      mutate(makeMutateRunner(db), CTX, (_tx, log) => {
        log({ entity: "setting", entityId: "k", action: "update", before: null, after: {} });
      }),
    ).not.toThrow();
  });
});

/* ------------------------------------------------------------ the channel */

interface FakeSocket {
  url: string;
  sent: { topic: string; event: string; payload: unknown }[];
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
  closed: boolean;
}

const LIVE = { url: "https://proj.supabase.co", apiKey: "sb_publishable_x", topic: "shop-0123456789abcdef0123" };

describe("the live channel", () => {
  let sockets: FakeSocket[];
  let pokes: number;

  const open = (url: string): FakeSocket => {
    const socket: FakeSocket = {
      url,
      sent: [],
      readyState: 1,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      closed: false,
      send(data) {
        this.sent.push(JSON.parse(data) as FakeSocket["sent"][number]);
      },
      close() {
        this.closed = true;
      },
    };
    sockets.push(socket);
    return socket;
  };
  const say = (socket: FakeSocket, msg: unknown) => socket.onmessage?.({ data: JSON.stringify(msg) });
  const joinOk = (socket: FakeSocket) => {
    socket.onopen?.({});
    say(socket, { event: "phx_reply", topic: `realtime:${LIVE.topic}`, payload: { status: "ok", response: {} } });
  };
  const poke = (socket: FakeSocket, tag?: string) =>
    say(socket, { event: "broadcast", topic: `realtime:${LIVE.topic}`, payload: { event: "changed", payload: { tag } } });

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    pokes = 0;
  });
  afterEach(() => {
    stopListening();
    vi.useRealTimers();
  });

  it("joins the shop's topic with the public key, and pulls once on joining", () => {
    startListening(() => LIVE, () => (pokes += 1), open as never);
    const socket = sockets[0]!;
    expect(socket.url).toBe(`wss://proj.supabase.co/realtime/v1/websocket?apikey=sb_publishable_x&vsn=1.0.0`);
    joinOk(socket);
    expect(socket.sent[0]).toMatchObject({ topic: `realtime:${LIVE.topic}`, event: "phx_join" });
    /* whatever happened while it was not listening was poked to nobody */
    expect(pokes).toBe(1);
    expect(listenStatus().connected).toBe(true);
  });

  it("pulls on a sibling's poke, and ignores the poke its own push caused", () => {
    startListening(() => LIVE, () => (pokes += 1), open as never);
    joinOk(sockets[0]!);
    pokes = 0;

    rememberOwnPoke("mine-123");
    poke(sockets[0]!, "mine-123");
    vi.advanceTimersByTime(500);
    expect(pokes).toBe(0);

    poke(sockets[0]!, "theirs-456");
    vi.advanceTimersByTime(500);
    expect(pokes).toBe(1);
  });

  it("does nothing at all on a till with no channel — the timer carries on as before", () => {
    startListening(() => null, () => (pokes += 1), open as never);
    expect(sockets).toHaveLength(0);
    expect(listenStatus().connected).toBe(false);
  });

  it("reconnects after the socket dies, and pulls again on rejoining", () => {
    startListening(() => LIVE, () => (pokes += 1), open as never);
    joinOk(sockets[0]!);
    pokes = 0;

    sockets[0]!.onclose?.({});
    expect(listenStatus().connected).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    joinOk(sockets[1]!);
    expect(pokes).toBe(1);
  });

  it("notices a socket that went silent (a laptop lid, a dropped Wi-Fi) and replaces it", () => {
    startListening(() => LIVE, () => (pokes += 1), open as never);
    joinOk(sockets[0]!);
    /* heartbeats go out and nothing ever answers */
    vi.advanceTimersByTime(75_000);
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
  });

  it("carries nothing but the poke: the socket is never sent a row, a name or a token", () => {
    startListening(() => LIVE, () => (pokes += 1), open as never);
    joinOk(sockets[0]!);
    vi.advanceTimersByTime(30_000);
    const wire = JSON.stringify(sockets[0]!.sent);
    expect(wire).not.toContain("cdrn_"); /* a device token's prefix */
    expect(sockets[0]!.sent.map((m) => m.event).sort()).toEqual(["heartbeat", "phx_join"]);
  });
});

