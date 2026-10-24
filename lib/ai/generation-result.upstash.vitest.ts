/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * With Upstash configured (production), a finished plan is kept there for
 * half an hour, and a slow Upstash never holds the answer up for long.
 */

const store = new Map<string, unknown>();
const set = vi.fn<(key: string, value: unknown, opts?: { ex: number }) => Promise<string>>(async (key, value) => {
  store.set(key, value);
  return "OK";
});
vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = set;
    // The client parses JSON it reads back.
    get = async (key: string) => {
      const value = store.get(key);
      return typeof value === "string" ? JSON.parse(value) : value ?? null;
    };
  },
}));
vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test.local");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

const { findGeneration, keepGeneration } = await import("./generation-result");
const { newGenerationId } = await import("./generation-id");

const plan = { itinerary: { days: [{ day_number: 1 }] }, meta: { cached: false } };

afterEach(() => {
  vi.useRealTimers();
  set.mockClear();
});

describe("kept generations in Upstash", () => {
  it("are kept for half an hour and found by the browser that asked", async () => {
    const id = newGenerationId();
    await keepGeneration(id, "s1", plan);
    expect(set).toHaveBeenCalledWith(`generation:${id}`, expect.any(String), { ex: 1800 });
    expect(await findGeneration(id, "s1")).toEqual(plan);
    expect(await findGeneration(id, "s2")).toBeNull();
  });

  it("hold the answer up for 1.5 s at most when Upstash is slow", async () => {
    vi.useFakeTimers();
    set.mockImplementationOnce(() => new Promise<string>(() => {}));
    let kept = false;
    void keepGeneration(newGenerationId(), "s1", plan).then(() => (kept = true));
    await vi.advanceTimersByTimeAsync(1499);
    expect(kept).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(kept).toBe(true);
  });

  it("are never kept when too big for Upstash", async () => {
    await keepGeneration(newGenerationId(), "s1", { itinerary: "x".repeat(1_000_000) });
    expect(set).not.toHaveBeenCalled();
  });
});
