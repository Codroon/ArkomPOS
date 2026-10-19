/**
 * "Something new is waiting" — ADR-0024 §3.
 *
 * The tills used to find out what a sibling did by asking every fifteen
 * seconds. Now, when a push lands, the cloud says so on a Supabase Realtime
 * broadcast channel and every till of that shop that is listening pulls at
 * once. The fifteen-second ask stays underneath as the fallback, so a till
 * whose socket is down is exactly as current as it was in v1.3.
 *
 * What travels on the channel is a POKE: an event name and a random tag the
 * pushing till uses to recognise its own echo. No row, no id, no amount, no
 * name. The pull that follows goes through the
 * same authenticated door as before, so the channel could be read by anybody
 * and tell them only that a shop is busy. The topic is still derived from a
 * server secret, so nobody can find that out from a tenant id either.
 *
 * Never throws and never blocks a push for long: a poke that fails costs the
 * other till up to fifteen seconds, which is how every poke failed before.
 */
import { createHmac } from "node:crypto";
import type { SyncLive } from "@arkom/core";

export interface LiveConfig {
  url: string;
  apiKey: string;
  secret: string;
}

/** Long enough that nobody waits on it; short enough that a dead Realtime never slows a push. */
const POKE_TIMEOUT_MS = 1_500;
export const POKE_EVENT = "changed";

/**
 * Read from the environment, or null when Realtime is not configured — in which
 * case every till simply keeps asking on its timer.
 *
 * The URL and key are the project's PUBLIC pair, the ones the browser bundle
 * already carries for sign-in. The secret that derives topics is
 * `SYNC_LIVE_SECRET` when set; otherwise it is derived from `DATABASE_URL`,
 * which is already a server-only secret on every deployment, so turning this on
 * needs no new variable. Rotating either changes every topic, and the tills
 * learn the new one on their next pull.
 */
export function liveConfig(env: Record<string, string | undefined> = process.env): LiveConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const apiKey = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  const secret = env.SYNC_LIVE_SECRET?.trim() || env.DATABASE_URL?.trim();
  if (!url || !apiKey || !secret) return null;
  return { url: url.replace(/\/+$/, ""), apiKey, secret };
}

/** One shop's channel name: not guessable from its tenant id, the same for all its tills. */
export function liveTopic(secret: string, tenantId: string): string {
  return `shop-${createHmac("sha256", secret).update(`live:${tenantId}`).digest("hex").slice(0, 40)}`;
}

/** What a till, or a dashboard tab, needs to listen. Never the secret. */
export function liveFor(config: LiveConfig | null, tenantId: string): SyncLive | null {
  if (!config) return null;
  return { url: config.url, apiKey: config.apiKey, topic: liveTopic(config.secret, tenantId) };
}

/** Tell one shop's listeners that something landed. Resolves true when Realtime accepted it. */
export async function poke(
  config: LiveConfig | null,
  tenantId: string,
  /** echoed in the push answer so the pushing till can ignore its own poke */
  tag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!config) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POKE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ topic: liveTopic(config.secret, tenantId), event: POKE_EVENT, payload: { tag } }],
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
