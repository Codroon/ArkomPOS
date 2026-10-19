"use client";

/**
 * The panel redraws itself when a till pushes — ADR-0024 §3.
 *
 * Listens on the same Realtime channel the tills do. A poke carries no data;
 * it only means "the numbers changed", so the answer is `router.refresh()`,
 * which re-runs the page's server queries through the signed-in session. Every
 * figure still comes from SQL in a server component, exactly as before; this
 * only decides WHEN to ask again.
 *
 * Gathered, so a sale's three pokes are one refresh, and paused while the tab
 * is hidden, so a dashboard left open in a background tab all day costs no
 * queries until somebody looks at it.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SyncLive } from "@arkom/core";

const GATHER_MS = 1_200;
const HEARTBEAT_MS = 25_000;
const RETRY_MAX_MS = 30_000;

export function LiveRefresh({ channels }: { channels: SyncLive[] }) {
  const router = useRouter();
  const key = channels.map((c) => c.topic).join(",");

  useEffect(() => {
    const first = channels[0];
    if (!first || typeof WebSocket === "undefined") return;

    let socket: WebSocket | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let gather: ReturnType<typeof setTimeout> | null = null;
    let retryMs = 1_000;
    let missedWhileHidden = false;
    let ref = 0;
    let stopped = false;

    const refresh = () => {
      if (document.hidden) {
        missedWhileHidden = true;
        return;
      }
      if (gather) return;
      gather = setTimeout(() => {
        gather = null;
        router.refresh();
      }, GATHER_MS);
    };

    const send = (topic: string, event: string, payload: unknown) => {
      ref += 1;
      socket?.send(JSON.stringify({ topic, event, payload, ref: String(ref), join_ref: "1" }));
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(
        `${first.url.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(first.apiKey)}&vsn=1.0.0`,
      );
      socket.onopen = () => {
        retryMs = 1_000;
        for (const c of channels) {
          send(`realtime:${c.topic}`, "phx_join", {
            config: { broadcast: { self: false }, presence: { key: "" }, private: false },
          });
        }
        heartbeat = setInterval(() => send("phoenix", "heartbeat", {}), HEARTBEAT_MS);
      };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { event?: string; payload?: { event?: string } };
          if (msg.event === "broadcast" && msg.payload?.event === "changed") refresh();
        } catch {
          /* not ours */
        }
      };
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (stopped) return;
        retry = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      };
    };

    const onVisible = () => {
      if (!document.hidden && missedWhileHidden) {
        missedWhileHidden = false;
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    connect();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (heartbeat) clearInterval(heartbeat);
      if (retry) clearTimeout(retry);
      if (gather) clearTimeout(gather);
      socket?.close();
    };
    // the channels are identified by their topics; a new array with the same topics is the same channel
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, router]);

  return null;
}
