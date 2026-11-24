import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: ["node_modules/**", ".next/**", "dist/**"],
    // The guards that read the whole source tree take a second or two alone,
    // and longer than the 5 s default while every worker is busy.
    testTimeout: 20_000,
    // Only files explicitly tagged as tests, so vitest never wanders into the
    // .next/ build output. A component test gets a browser page (jsdom); a
    // logic test runs without one, which starts several times faster, unless
    // its first line asks for a page (// @vitest-environment jsdom).
    projects: [
      { extends: true, test: { name: "logic", include: ["**/*.vitest.ts"], environment: "node" } },
      { extends: true, test: { name: "components", include: ["**/*.vitest.tsx"], environment: "jsdom" } },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See tests/server-only-stub.ts.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
