/**
 * The Postgres handle — Supabase, in the EU (ADR-0021 §3).
 *
 * One vendor holds the shops' personal data and the identities that sign in to
 * see it, so the data-processing agreement names one sub-processor rather than
 * two. ADR-0020 §4 makes the region a promise to the shops, not a preference:
 * Frankfurt, pinned again in `vercel.json` for the functions themselves.
 *
 * Two connection strings, because Supabase has two ports and they are not
 * interchangeable:
 *
 * - `DATABASE_URL` — the **transaction pooler** (6543). What a serverless route
 *   uses: a request checks out a connection, runs, and gives it back. Prepared
 *   statements cannot survive that, hence `prepare: false` — leave it on and the
 *   first pooled reuse fails with a prepared-statement name it has never heard of.
 * - `DIRECT_URL` — the **direct connection** (5432). What migrations use, because
 *   DDL through a transaction pooler is a way to spend an afternoon.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type CloudDb = ReturnType<typeof makeDb>;

function makeDb(url: string) {
  const sql = postgres(url, {
    prepare: false,
    /* A route does a couple of statements and goes away. One connection per
       lambda, recycled quickly, keeps a free-tier pooler from filling up with
       instances that have nothing left to say. */
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema });
}

let cached: CloudDb | null = null;

export function db(): CloudDb {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    /* Loud and early. A cloud with no database should refuse to answer, not
       quietly 500 on the first till that pushes. */
    throw new Error("DATABASE_URL is not set — the cloud has no database to write to.");
  }
  cached = makeDb(url);
  return cached;
}

export { schema };
