import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

// the Login footer prints this — "which version are you on?" starts every support call
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Workspace packages are TypeScript source — they must be bundled, not externalized.
const workspacePackages = ["@arkom/core", "@arkom/db", "@arkom/ui"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        // native module: must stay a runtime require, never bundled
        external: ["better-sqlite3", "@node-rs/argon2"],
      },
    },
  },
  preload: {
    // sandboxed preloads cannot require external modules at runtime — bundle
    // everything they import (zod comes in via @arkom/core's IPC schemas)
    plugins: [externalizeDepsPlugin({ exclude: [...workspacePackages, "zod"] })],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(version) },
  },
});
