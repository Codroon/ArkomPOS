/**
 * Listening for "something new is waiting" — ADR-0024 §3.
 *
 * The cloud pokes a shop's Supabase Realtime channel whenever one of its tills
 * pushes something new. This till keeps one socket open to that channel and,
 * on a poke, pulls straight away through the same authenticated door as the
 * timer does. That is the whole mechanism: the socket carries no data, only the
 * fact that there is some, so nothing here is trusted with anything.
 *
 * Built on the WebSocket that Node ships (Electron 37 = Node 22) and the
 * Phoenix wire format Realtime speaks — four message shapes, not worth a
 * dependency. The timer in `receive.ts` stays underneath: a socket that is down
 * costs the till the old fifteen seconds, never a missed row, because the pull
 * is what moves data and the pull does not depend on this file.
 *
 * Never throws. Every failure ends in a reconnect with a growing wait.
 */
import type { SyncLive } from "@arkom/core";

/** Realtime drops a socket that has not said anything for a minute. */
const HEARTBEAT_MS = 25_000;
/** No reply to two heartbeats: the socket is dead even if nobody told us (sleep, Wi-Fi). */
const DEAD_AFTER_MS = 60_000;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;
/**
 * A poke for this till's OWN push arrives about when the push's answer does,
 * sometimes before it. Waiting this long lets the answer register its tag so the
 * till does not pull for nothing; a sibling's poke costs the same short wait.
 */
const OWN_POKE_GRACE_MS = 200;
export const POKE_EVENT = "changed";

type Socket = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};
type SocketFactory = (url: string) => Socket;

interface State {
  config: () => SyncLive | null;
  onPoke: () => void;
  open: SocketFactory;
  socket: Socket | null;
  /** which channel the open socket is on, so a changed topic reconnects */
  topic: string | null;
  joined: boolean;
  ref: number;
  lastHeardAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  retry: ReturnType<typeof setTimeout> | null;
  retryMs: number;
  lastPokeAtMs: number | null;
}

let state: State | null = null;
/** tags of pokes this till caused, from its push answers — the newest few */
const ownTags: string[] = [];

/** The push answer named the poke it caused; ignore that one when it arrives. */
export function rememberOwnPoke(tag: string | undefined): void {
  if (!tag) return;
  ownTags.push(tag);
  if (ownTags.length > 32) ownTags.shift();
}

export function listenStatus(): { connected: boolean; lastPokeAtMs: number | null } {
  return { connected: Boolean(state?.joined), lastPokeAtMs: state?.lastPokeAtMs ?? null };
}

const nativeSocket: SocketFactory = (url) => new WebSocket(url) as unknown as Socket;

/**
 * Start listening. `config` is read on every (re)connect, because the channel
 * arrives with a pull and can change with one; `onPoke` should schedule a pull
 * and return — it is called on the socket's event, not awaited.
 */
export function startListening(
  config: () => SyncLive | null,
  onPoke: () => void,
  open: SocketFactory = nativeSocket,
): void {
  if (state) return;
  state = {
    config,
    onPoke,
    open,
    socket: null,
    topic: null,
    joined: false,
    ref: 0,
    lastHeardAt: 0,
    heartbeat: null,
    retry: null,
    retryMs: RETRY_MIN_MS,
    lastPokeAtMs: null,
  };
  connect();
}

/** The channel may have changed (a pull just answered): reconnect if so, connect if idle. */
export function refreshListening(): void {
  if (!state) return;
  const live = safeConfig();
  if (!live) return disconnect(false);
  if (state.socket && state.topic === live.topic) return;
  disconnect(false);
  connect();
}

export function stopListening(): void {
  if (!state) return;
  disconnect(false);
  state = null;
}

function safeConfig(): SyncLive | null {
  try {
    return state?.config() ?? null;
  } catch {
    return null;
  }
}

function connect(): void {
  const s = state;
  if (!s || s.socket) return;
  if (s.retry) {
    clearTimeout(s.retry);
    s.retry = null;
  }
  const live = safeConfig();
  if (!live) return; /* not linked, or an older cloud: the timer does the work */

  let socket: Socket;
  try {
    const url = `${live.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(live.apiKey)}&vsn=1.0.0`;
    socket = s.open(url);
  } catch {
    return scheduleRetry();
  }
  s.socket = socket;
  s.topic = live.topic;
  s.joined = false;
  s.lastHeardAt = Date.now();

  socket.onopen = () => {
    send({
      topic: `realtime:${live.topic}`,
      event: "phx_join",
      payload: { config: { broadcast: { self: false }, presence: { key: "" }, private: false } },
    });
  };
  socket.onmessage = (ev) => onMessage(socket, ev.data);
  socket.onclose = () => {
    if (state?.socket === socket) disconnect(true);
  };
  socket.onerror = () => {
    if (state?.socket === socket) disconnect(true);
  };

  s.heartbeat = setInterval(() => {
    if (!state || state.socket !== socket) return;
    if (Date.now() - state.lastHeardAt > DEAD_AFTER_MS) return disconnect(true);
    send({ topic: "phoenix", event: "heartbeat", payload: {} });
  }, HEARTBEAT_MS);
}

function send(message: { topic: string; event: string; payload: unknown }): void {
  const s = state;
  if (!s?.socket) return;
  s.ref += 1;
  try {
    s.socket.send(JSON.stringify({ ...message, ref: String(s.ref), join_ref: "1" }));
  } catch {
    disconnect(true);
  }
}

function onMessage(socket: Socket, data: unknown): void {
  const s = state;
  if (!s || s.socket !== socket) return;
  s.lastHeardAt = Date.now();

  let msg: { event?: string; payload?: { status?: string; event?: string; payload?: { tag?: unknown } } };
  try {
    msg = JSON.parse(String(data)) as typeof msg;
  } catch {
    return;
  }

  if (msg.event === "phx_reply" && !s.joined && msg.payload?.status === "ok") {
    s.joined = true;
    s.retryMs = RETRY_MIN_MS;
    /* anything a sibling did while this socket was down was not poked to us */
    s.onPoke();
    return;
  }
  if (msg.event === "phx_error" || msg.event === "phx_close") return disconnect(true);
  if (msg.event !== "broadcast" || msg.payload?.event !== POKE_EVENT) return;

  const tag = typeof msg.payload.payload?.tag === "string" ? msg.payload.payload.tag : undefined;
  setTimeout(() => {
    if (!state) return;
    if (tag && ownTags.includes(tag)) return; /* our own push; nothing to fetch */
    state.lastPokeAtMs = Date.now();
    try {
      state.onPoke();
    } catch {
      /* a pull that could not be scheduled is the timer's to do */
    }
  }, OWN_POKE_GRACE_MS);
}

function disconnect(retry: boolean): void {
  const s = state;
  if (!s) return;
  if (s.heartbeat) clearInterval(s.heartbeat);
  s.heartbeat = null;
  const socket = s.socket;
  s.socket = null;
  s.topic = null;
  s.joined = false;
  if (socket) {
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close();
    } catch {
      /* already gone */
    }
  }
  if (retry) scheduleRetry();
}

function scheduleRetry(): void {
  const s = state;
  if (!s || s.retry) return;
  const wait = s.retryMs;
  s.retryMs = Math.min(s.retryMs * 2, RETRY_MAX_MS);
  s.retry = setTimeout(() => {
    if (!state) return;
    state.retry = null;
    connect();
  }, wait);
}
