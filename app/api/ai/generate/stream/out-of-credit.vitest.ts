// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * What the stream tells the wizard when the model refuses: with the credit used up
 * the planner is unavailable and no try helps; anything else is worth another try.
 * Neither passes on the model's own words.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));
vi.mock("@/lib/anonymous/rate-limit", () => ({
  checkAnonymousRateLimit: async () => ({ allowed: true, used: 0, limit: 5, resetAt: Date.now() + 60_000 }),
  recordAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
const logged: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (row: Record<string, unknown>) => void logged.push(row),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 10, limit: 10 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async () => null,
  cacheItinerary: async () => {},
  adjustItineraryDates: (itinerary: unknown) => itinerary,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
let refusal = "";
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    throw new Error(refusal);
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));

const { POST } = await import("./route");
const { MODEL_OUTAGE_MESSAGE } = await import("@/lib/ai/model-outage");

async function errorEvent() {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mt_session_id=s1" },
      body: JSON.stringify({ destination: "Rome, Italy", startDate: "2026-11-01", endDate: "2026-11-02", vibes: ["foodie"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  const last = events[events.length - 1];
  expect(last.startsWith("event: error")).toBe(true);
  return JSON.parse(last.split("\ndata: ")[1]);
}

beforeEach(() => {
  logged.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a stream the model refuses", () => {
  it("says the planner is unavailable when the credit ran out, and logs the real reason", async () => {
    refusal = `parts failed: {"error":{"message":"{\\n \\"error\\": {\\n \\"code\\": 402,\\n \\"message\\": \\"Your prepayment credits are depleted.\\"\\n }\\n}\\n","code":402,"status":"Payment Required"}}`;
    expect(await errorEvent()).toEqual({ error: MODEL_OUTAGE_MESSAGE, code: "upstream" });
    expect(logged.find((row) => row.status === 500)?.error).toContain("prepayment credits");
  });

  it("asks for another try for anything else, and tells nothing of the model", async () => {
    refusal = "API key was reported as leaked";
    expect(await errorEvent()).toEqual({ error: "Generation failed. Please try again.", code: "upstream" });
  });
});
