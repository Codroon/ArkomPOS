import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Workspace packages are TypeScript source — they must be bundled, not externalized.
const workspacePackages = ["@arkom/core", "@arkom/db", "@arkom/ui"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      rollupOptions: {
        // native module: must stay a runtime require, never bundled
        external: ["better-sqlite3"],
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
  },
});
