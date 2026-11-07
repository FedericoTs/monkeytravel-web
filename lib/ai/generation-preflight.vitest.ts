// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { TripCreationParams } from "@/types";

const checkUsageLimit = vi.fn();
const getCachedItinerary = vi.fn();
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: (...args: unknown[]) => checkUsageLimit(...args) }));
vi.mock("@/lib/ai/cache", () => ({ getCachedItinerary: (...args: unknown[]) => getCachedItinerary(...args) }));

const { readGenerationPreflight, generationQuotaReached } = await import("./generation-preflight");

const params = {
  destination: "Lisbon, Portugal",
  startDate: "2026-11-01",
  endDate: "2026-11-03",
  vibes: ["foodie", "cultural"],
  budgetTier: "budget",
  pace: "moderate",
  travelStyle: "backpacker",
} as TripCreationParams;
const planner = { id: "u1", email: "planner@example.com" } as User;
const cached = { days: [{}, {}, {}] };

beforeEach(() => {
  checkUsageLimit.mockReset().mockResolvedValue({ allowed: true, used: 2, remaining: 1, limit: 3 });
  getCachedItinerary.mockReset().mockResolvedValue(cached);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("readGenerationPreflight", () => {
  it.each<[string, Partial<TripCreationParams>]>([
    ["who's coming", { tripIntent: "solo" }],
    ["must-dos", { mustDos: ["Belem Tower"] }],
    ["a diet", { profilePreferences: { dietaryPreferences: ["vegan"] } }],
  ])("leaves the shared plans alone for a plan shaped by %s", async (_, shaped) => {
    const { cached: read } = await readGenerationPreflight(null, { ...params, ...shaped }, "en", 3);
    expect(getCachedItinerary).not.toHaveBeenCalled();
    expect(read).toBeNull();
  });

  it("reads a signed-in planner's monthly generations", async () => {
    const { usage } = await readGenerationPreflight(planner, params, "en", 3);
    expect(checkUsageLimit).toHaveBeenCalledWith("u1", "aiGenerations", "planner@example.com");
    expect(usage).toEqual({ allowed: true, used: 2, remaining: 1, limit: 3 });
  });

  it("has no quota to read for an anonymous visitor", async () => {
    const { usage } = await readGenerationPreflight(null, params, "en", 3);
    expect(checkUsageLimit).not.toHaveBeenCalled();
    expect(usage.allowed).toBe(true);
  });

  it("reads the cache entry for the trip, no shorter than it", async () => {
    const result = await readGenerationPreflight(null, params, "it", 3);
    expect(getCachedItinerary).toHaveBeenCalledWith(null, "Lisbon, Portugal", ["foodie", "cultural"], "budget", "it", "backpacker", 3);
    expect(result.cached).toBe(cached);
  });

  it("reads the classic pool when no style is given", async () => {
    await readGenerationPreflight(null, { ...params, travelStyle: undefined }, "en", 3);
    expect(getCachedItinerary.mock.calls[0][5]).toBe("classic");
  });
});

describe("generationQuotaReached", () => {
  it("answers 429 with the quota and where to upgrade", async () => {
    const usage = { allowed: false, used: 3, remaining: 0, limit: 3, message: "You have used this month's 3 trips." };
    const res = generationQuotaReached(usage as never);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: "You have used this month's 3 trips.",
      code: "RATE_LIMIT",
      usage,
      upgradeUrl: "/pricing",
    });
  });

  it("says the monthly limit is reached when the quota gives no message", async () => {
    const res = generationQuotaReached({ allowed: false, used: 3, remaining: 0, limit: 3 } as never);
    expect((await res.json()).error).toBe("Monthly trip generation limit reached.");
  });
});
