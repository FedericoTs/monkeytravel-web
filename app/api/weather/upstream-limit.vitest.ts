/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The trip page waits on this for its weather card. When the weather service
 * stalled, one request hung for the full five minutes; it now gives up after a
 * few seconds and one retry.
 */

const asked = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/api-gateway", () => ({
  apiGateway: {
    fetch: async (_url: string, _init: RequestInit, config: Record<string, unknown>) => {
      asked.push(config);
      return { response: new Response(null, { status: 503 }), data: null };
    },
  },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));

// The cache: always a miss, and writes go nowhere.
vi.mock("@/lib/supabase/admin", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "gt", "gte", "lt", "single", "maybeSingle", "upsert", "insert", "update", "limit", "order"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
  return { createAdminClient: () => chain };
});

import { GET } from "./route";

afterEach(() => {
  asked.length = 0;
});

describe("the weather service's time limit", () => {
  it("asks with a few seconds' limit and one retry", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new NextRequest("https://monkeytravel.app/api/weather?latitude=38.72&longitude=-9.14&startDate=2026-12-02&endDate=2026-12-05"));
    expect(res.status).toBe(500);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ apiName: "open_meteo", timeout: 8000, maxRetries: 1 });
  });
});
