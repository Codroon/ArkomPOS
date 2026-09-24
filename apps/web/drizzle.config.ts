/**
 * Migrations for the cloud's Postgres. The till's live in `packages/db`; these
 * are a separate lineage on a different engine, and the two never meet — the
 * till's schema is SQLite and its own business.
 *
 * `db:generate` needs no database. `db:migrate` needs the DIRECT connection
 * (port 5432), not the transaction pooler the app runs on: DDL through a pooler
 * is a way to spend an afternoon. Both are read from `.env.local` here so that
 * every caller gets them the same way — a person, a package script or CI.
 */
import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* Not there — which is normal in CI and on a machine that exports the URL
     itself. A missing URL is drizzle-kit's complaint to make, not ours. */
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
