/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** With Upstash configured (production), the balance typed is kept there, with no expiry. */

const set = vi.fn<(key: string, value: unknown, opts?: unknown) => Promise<string>>();
const get = vi.fn<(key: string) => Promise<unknown>>();
vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = set;
    get = get;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test.local");
vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");

const { readCreditReading, saveCreditReading } = await import("./gemini-credit");

const reading = { usd: 50, at: "2026-11-05T15:00:00.000Z" };

beforeEach(() => {
  set.mockReset();
  get.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the reading in Upstash", () => {
  it("is kept for good, and read back from the same place", async () => {
    set.mockResolvedValue("OK");
    get.mockResolvedValue(reading);
    expect(await saveCreditReading(reading)).toBe(true);
    expect(set).toHaveBeenCalledWith("ops:gemini-credit", reading);
    expect(await readCreditReading()).toEqual(reading);
    expect(get).toHaveBeenCalledWith("ops:gemini-credit");
  });

  it("has no reading until one is typed", async () => {
    get.mockResolvedValue(null);
    expect(await readCreditReading()).toBeNull();
  });

  it("says so when Upstash fails", async () => {
    set.mockRejectedValue(new Error("down"));
    get.mockRejectedValue(new Error("down"));
    expect(await saveCreditReading(reading)).toBe(false);
    expect(await readCreditReading()).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
