/** @vitest-environment node */
/**
 * The browser tests' server in CI keeps an idle connection open for longer than a test pauses between two requests
 * on one request context. With Node's default (5 s), a request sent just as the server closes that connection fails
 * with "socket hang up" and the test only passes on its retry. Kept under Node's 60 s headersTimeout.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const CONFIG = readFileSync(join(__dirname, "..", "playwright.config.ts"), "utf8").replace(/\r/g, "");

describe("the browser tests' server in CI", () => {
  it("keeps idle connections open for longer than a test's pauses", () => {
    const command = /command:\s*process\.env\.CI\s*\?\s*"([^"]+)"/.exec(CONFIG)?.[1] ?? "";
    const ms = Number(/--keepAliveTimeout[ =](\d+)\b/.exec(command)?.[1]);
    expect(command).toMatch(/^npm run start -- /);
    expect(ms).toBeGreaterThanOrEqual(30_000);
    expect(ms).toBeLessThan(60_000);
  });
});
