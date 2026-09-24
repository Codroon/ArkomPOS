import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    /* The integration suite talks to a real Supabase and creates real rows.
       Unit tests stay hermetic and fast, and nobody's `pnpm test` should depend
       on somebody else's network — run it with `pnpm test:db`. */
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    environment: "node",
  },
});
