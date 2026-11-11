/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Every call through the gateway has a time limit: the caller's `timeout`, or
 * DEFAULT_TIMEOUT. The option was documented for a long time and never applied.
 */

const retried = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("./interceptors/retry", () => ({
  fetchWithRetry: async (_url: string, _init: RequestInit, config: Record<string, unknown>) => {
    retried.push(config);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  },
}));
vi.mock("./interceptors/logging", () => ({
  batchLogger: { add: vi.fn(), flush: vi.fn() },
  createLoggingInterceptor: () => ({ onRequest: vi.fn(), onResponse: vi.fn(), onError: vi.fn() }),
  logCacheHit: vi.fn(),
}));

import { apiGateway } from "./client";
import { DEFAULT_TIMEOUT } from "./config";

afterEach(() => {
  retried.length = 0;
});

describe("the gateway's time limit", () => {
  it("is the caller's when it gives one", async () => {
    await apiGateway.fetch("https://example.com/a", { method: "GET" }, { apiName: "open_meteo", endpoint: "/a", timeout: 8000, skipDedup: true });
    expect(retried[0]).toMatchObject({ timeoutMs: 8000 });
  });

  it("is DEFAULT_TIMEOUT otherwise", async () => {
    await apiGateway.fetch("https://example.com/b", { method: "GET" }, { apiName: "open_meteo", endpoint: "/b", skipDedup: true });
    expect(retried[0]).toMatchObject({ timeoutMs: DEFAULT_TIMEOUT });
    expect(DEFAULT_TIMEOUT).toBe(30000);
  });
});
