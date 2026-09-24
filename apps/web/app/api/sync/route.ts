/**
 * POST /api/sync — a till's batch arrives here and nowhere else.
 *
 * The handler is deliberately thin: read the request, hand it to `ingest()`,
 * write the answer down. Every decision worth arguing about is in
 * `src/sync/ingest.ts`, where it can be tested without a server or a database.
 *
 * Nothing in this file logs a request body. A batch is a shop's customers,
 * their phone numbers and what they paid; the token that carried it is a
 * credential. Neither belongs in a log aggregator, so the only thing recorded
 * on failure is that one happened.
 */
import { ingest } from "../../../src/sync/ingest";
import { pgStore } from "../../../src/db/pg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A batch is 200 rows of JSON. Anything this size is not one of ours. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "BAD_REQUEST" }, { status: 400 });
  }

  try {
    const result = await ingest(pgStore(), {
      authorization: request.headers.get("authorization"),
      body,
    });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error("sync ingest failed:", err instanceof Error ? err.message : "unknown error");
    /* 500 and no ack. The till keeps its cursor and sends the same rows again,
       which is the entire point of the design — a bad day here costs a repeat,
       never a gap in a shop's history. */
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
