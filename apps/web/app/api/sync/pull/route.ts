/**
 * GET /api/sync/pull — a till asks what its siblings did. ADR-0022 §2.
 *
 * Thin for the same reason `POST /api/sync` is thin: every decision worth
 * arguing about lives in `src/sync/pull.ts`, where it is tested without a
 * server or a database.
 *
 * A GET, because it is a read — of rows this shop's own tills wrote, served
 * back to another of its tills. It takes its cursor from the query string and
 * changes nothing, so a retry after a dropped connection is free, which is the
 * same property that makes the push safe.
 *
 * Nothing here logs a query or a body. The response is a shop's catalogue,
 * its customers and what it has on the shelf; the token that asked for it is a
 * credential. On failure the only thing recorded is that one happened.
 */
import { pull } from "../../../../src/sync/pull";
import { pgStore } from "../../../../src/db/pg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const query = Object.fromEntries(new URL(request.url).searchParams);

  try {
    const result = await pull(pgStore(), {
      authorization: request.headers.get("authorization"),
      query,
    });
    return Response.json(result.body, {
      status: result.status,
      /* a cursor's answer is true for one instant and for one till; nothing
         between here and the counter may keep a copy of it */
      headers: { "cache-control": "no-store, private" },
    });
  } catch (err) {
    console.error("sync pull failed:", err instanceof Error ? err.message : "unknown error");
    /* 500 and no cursor. The till keeps the cursor it had and asks again, so a
       bad day here costs a repeat and never a row a shop does not receive. */
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
