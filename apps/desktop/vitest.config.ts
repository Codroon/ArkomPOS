import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Main-process tests. `electron` and the native SQLite driver are aliased to
 * stubs so the guard can be exercised without launching a window — the guard is
 * the most security-relevant code in the app and "only testable by hand" was
 * not an acceptable answer for it.
 */
export default defineConfig({
  resolve: {
    alias: {
      electron: fileURLToPath(new URL("./src/main/__tests__/electron-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/main/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
