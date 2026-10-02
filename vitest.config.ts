import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // Only pick up files explicitly tagged as tests, so vitest never
    // wanders into the .next/ build output.
    include: ["**/*.vitest.ts", "**/*.vitest.tsx"],
    exclude: ["node_modules/**", ".next/**", "dist/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // See tests/server-only-stub.ts.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
});
