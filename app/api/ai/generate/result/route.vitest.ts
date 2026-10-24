/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A wizard that never received its answer collects the plan kept under its
 * generation id; another browser, or an id with nothing kept, gets a 404.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  logApiCall: async (row: Record<string, unknown>) => void logged.push(row),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void p }));

const { GET } = await import("./route");
const { keepGeneration } = await import("@/lib/ai/generation-result");
const { newGenerationId } = await import("@/lib/ai/generation-id");

const get = (id: string, session = "s1") =>
  GET(new NextRequest(`https://monkeytravel.app/api/ai/generate/result?id=${id}`, { headers: { cookie: `mt_session_id=${session}` } }));
const plan = { itinerary: { days: [{ day_number: 1 }] }, meta: { cached: false } };

beforeEach(() => {
  logged.length = 0;
});

describe("GET /api/ai/generate/result", () => {
  it("hands back the plan kept under the id", async () => {
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ success: true, ...plan, recovered: true });
  });

  it("is a 404 while nothing is kept, or for another browser", async () => {
    expect((await get(newGenerationId())).status).toBe(404);
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    expect((await get(id, "s2")).status).toBe(404);
  });

  it("refuses a malformed id", async () => {
    expect((await get("not-an-id")).status).toBe(400);
    expect(logged).toEqual([]);
  });

  it("logs each lookup with its generation id, at no cost", async () => {
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    await get(id);
    await get(newGenerationId());
    expect(logged.map((row) => [row.apiName, row.status, row.costUsd])).toEqual([
      ["generation_result", 200, 0],
      ["generation_result", 404, 0],
    ]);
    expect(logged[0].metadata).toEqual({ generation_id: id });
  });
});
