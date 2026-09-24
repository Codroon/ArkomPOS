import { defineConfig } from "vitest/config";

/**
 * The suite that needs a database. It skips itself when DATABASE_URL and
 * DIRECT_URL are not set, so running it without credentials is a no-op rather
 * than a wall of failures.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
