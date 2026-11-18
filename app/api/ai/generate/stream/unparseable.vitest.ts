// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan the model wrote that couldn't be read even mended (lib/ai/json-mend.ts) logs the text around the slip
 * that stopped it, so the next slip can be taught; the traveller is told nothing of the model.
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
  refundAnonymousGeneration: async () => {},
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
const logged: Array<{ status?: number; error?: string; metadata?: Record<string, unknown> }> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (row: { status?: number; error?: string; metadata?: Record<string, unknown> }) => void logged.push(row),
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
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));
let reply = "";
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    yield { done: true, fullText: reply, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100 } };
  },
}));

const { POST } = await import("./route");

async function lastEvent() {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mt_session_id=s1" },
      body: JSON.stringify({ destination: "Rome, Italy", startDate: "2026-11-01", endDate: "2026-11-02", vibes: ["foodie"] }),
    })
  );
  const events = (await res.text()).split("\n\n").filter(Boolean);
  return events[events.length - 1];
}

beforeEach(() => {
  logged.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a plan the model wrote that can't be read", () => {
  it("logs the text around the slip that stopped the mend, and tells the traveller nothing of it", async () => {
    reply = '{"destination":{"name":"Rome"},"days":[{"day_number":1,"date":"2026-11-01","activities":[]}],\n      x: 2}';
    const last = await lastEvent();
    expect(last.startsWith("event: error")).toBe(true);
    expect(last).not.toContain("⟪");
    const row = logged.find((r) => r.status === 500);
    expect(row?.error).toMatch(/^unparseable output: Expected double-quoted property name/);
    expect(row?.metadata?.slip).toBe('":"2026-11-01","activities":[]}],\\n      ⟪x: 2}');
  });

  it("logs no slip when the reply simply stops", async () => {
    reply = '{"destination":{"name":"Rome"},"days":[';
    await lastEvent();
    const row = logged.find((r) => r.status === 500);
    expect(row?.error).toMatch(/^unparseable output/);
    expect(row?.metadata).not.toHaveProperty("slip");
  });
});
