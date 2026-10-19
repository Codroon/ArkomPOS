/**
 * pnpm cloud:live-probe [-- --url https://cloud.arkom.es]
 *
 * End-to-end proof of ADR-0024 against a DEPLOYED cloud, with a throwaway shop
 * that is deleted at the end. Two fake tills: B listens on the shop's live
 * channel the way a real till does; A pushes one row. It measures:
 *
 *   push → poke heard by B     (the announcement)
 *   push → row served to B     (what a till can actually apply)
 *
 * and checks the pull answer carries the directory and the channel. Touches no
 * real shop: the account, tenant and devices are created here and cascade away.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const urlArg = process.argv.indexOf("--url");
const BASE = (urlArg > 0 ? process.argv[urlArg + 1] : "https://cloud.arkom.es").replace(/\/+$/, "");
const sql = postgres(process.env.DIRECT_URL, { prepare: false, max: 1 });
const digest = (s) => createHash("sha256").update(s.trim(), "utf8").digest("hex");
const id = () => randomUUID();

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const account = id();
const tenant = id();
const [termA, termB] = [id(), id()];
const [devA, devB] = [id(), id()];
const [tokA, tokB] = [`cdrn_${randomBytes(32).toString("base64url")}`, `cdrn_${randomBytes(32).toString("base64url")}`];

async function setup() {
  await sql`insert into accounts (id, name, email) values (${account}, 'Live probe', ${`probe.${account}@codroon.invalid`})`;
  await sql`insert into tenants (id, account_id, name) values (${tenant}, ${account}, 'Probe shop')`;
  for (const [dev, term, tok, name] of [[devA, termA, tokA, "Probe A"], [devB, termB, tokB, "Probe B"]]) {
    await sql`insert into devices (id, account_id, tenant_id, location_id, terminal_id, terminal_name, token_hash, app_version)
              values (${dev}, ${account}, ${tenant}, 'loc', ${term}, ${name}, ${digest(tok)}, '1.4.0')`;
  }
}

async function pull(token, terminalId, after = 0) {
  const u = new URL("/api/sync/pull", BASE);
  Object.entries({ tenantId: tenant, terminalId, appVersion: "1.4.0", afterIngestSeq: String(after) }).forEach(([k, v]) =>
    u.searchParams.set(k, v),
  );
  const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json() };
}

function listen(topic) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${supabase.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${encodeURIComponent(apiKey)}&vsn=1.0.0`);
    const handle = { ws, pokes: [], joined: null };
    ws.onopen = () =>
      ws.send(JSON.stringify({ topic: `realtime:${topic}`, event: "phx_join", payload: { config: { broadcast: { self: false }, presence: { key: "" }, private: false } }, ref: "1", join_ref: "1" }));
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.event === "phx_reply" && msg.ref === "1") resolve(handle);
      if (msg.event === "broadcast") handle.pokes.push({ at: Date.now(), tag: msg.payload?.payload?.tag });
    };
    ws.onerror = () => reject(new Error("socket error"));
    setTimeout(() => reject(new Error("join timeout")), 8000);
  });
}

let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? "  OK  " : "  FAIL"} ${what}`);
  if (!ok) failed = true;
};

try {
  await setup();
  /* B learns its channel from a pull, exactly as a till does */
  const first = await pull(tokB, termB);
  check(first.status === 200, `pull answers 200 (got ${first.status})`);
  check(Boolean(first.body.directory), "pull carries the directory");
  check(first.body.directory?.tills?.some((t) => t.name === "Probe A"), "directory names the sibling till");
  const live = first.body.live;
  check(Boolean(live?.topic), "pull carries the live channel");
  if (live) check(!live.topic.includes(tenant), "topic does not contain the tenant id");

  const b = live ? await listen(live.topic) : null;

  const t0 = Date.now();
  const push = await fetch(new URL("/api/sync", BASE), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tokA}` },
    body: JSON.stringify({
      tenantId: tenant,
      terminalId: termA,
      appVersion: "1.4.0",
      ops: [{ seq: 1, opId: id(), tenantId: tenant, locationId: "loc", terminalId: termA, entity: "product", entityId: id(),
              action: "create", before: null, after: { name: "Probe product", priceCents: 100 }, userId: null,
              authorizedByUserId: null, createdAtMs: Date.now() }],
    }),
  });
  const ack = await push.json();
  const tPushed = Date.now();
  check(push.status === 200 && ack.ackedSeq === 1, `push stored and acked (${push.status}, ackedSeq ${ack.ackedSeq})`);
  check(typeof ack.pokeTag === "string", "push answer names its poke");

  /* when does B hear it, and when can B actually pull the row? */
  let heardAt = null;
  let servedAt = null;
  while (Date.now() - t0 < 15_000 && (heardAt === null || servedAt === null)) {
    if (heardAt === null && b?.pokes.length) heardAt = b.pokes[0].at;
    if (servedAt === null) {
      const p = await pull(tokB, termB, first.body.cursor);
      if (p.body.entries?.length) servedAt = Date.now();
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\n  push round trip:            ${tPushed - t0} ms`);
  console.log(`  push sent -> poke heard:     ${heardAt ? heardAt - t0 + " ms" : "never"}`);
  console.log(`  push sent -> row servable:   ${servedAt ? servedAt - t0 + " ms" : "never (15 s)"}`);
  check(heardAt !== null, "the other till heard the poke");
  check(b?.pokes[0]?.tag === ack.pokeTag, "the poke carries the push's tag and nothing else");
  b?.ws.close();
} catch (err) {
  console.error("probe error:", err.message);
  failed = true;
} finally {
  await sql`delete from accounts where id = ${account}`;
  await sql.end();
  console.log(failed ? "\nLIVE PROBE: FAILED" : "\nLIVE PROBE: all checks passed");
  process.exit(failed ? 1 : 0);
}
