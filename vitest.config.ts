import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Only pick up files explicitly tagged as tests. We don't want vitest
    // to wander into the .next/ build output or the existing one-off
    // lib/proposals/consensus.test.ts (which is unrelated and not
    // structured as a vitest suite).
    include: ["**/*.vitest.ts", "**/*.vitest.tsx"],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
