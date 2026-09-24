/**
 * The Postgres handle. Neon over HTTP, which is the right shape for a route
 * that does two statements and goes away again — no pool to keep warm between
 * serverless invocations, no WebSocket to negotiate.
 *
 * Region is pinned in `vercel.json` (`fra1`) and the database is created in a
 * Neon EU region. ADR-0020 §4 makes that a promise to the shops, not a
 * preference: personal data of Spanish shoppers does not leave the union
 * because of where we chose to deploy.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type CloudDb = ReturnType<typeof makeDb>;

function makeDb(url: string) {
  return drizzle(neon(url), { schema });
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
