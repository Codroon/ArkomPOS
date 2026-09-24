/**
 * POST /api/enrol — the one door that takes no credential, because it is where
 * a till gets one. ADR-0020 §1.
 *
 * Small body, small surface: a code, the ids the till generated at first run,
 * and what it calls itself. The rules are in `src/sync/enrol.ts`.
 */
import { enrol } from "../../../src/sync/enrol";
import { pgStore } from "../../../src/db/pg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

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
    const result = await enrol(pgStore(), body);
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error("enrol failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
