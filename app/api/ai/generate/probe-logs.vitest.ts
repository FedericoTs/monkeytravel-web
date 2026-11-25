// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The JSON route (trips through several cities, plans around fixed
 * commitments) marks a tagged probe session's log rows as the stream does, so
 * reads of travellers' plans leave live checks out.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
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
const logged: Array<{ status?: number; metadata?: Record<string, unknown> }> = [];
let access = { allowed: true } as { allowed: boolean; reason?: string; message?: string };
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => access,
  logApiCall: async (row: (typeof logged)[number]) => void logged.push(row),
  blockedCall: (_access: unknown, row: { metadata?: Record<string, unknown> }) => {
    logged.push({ status: 503, metadata: row.metadata });
    return new Response(null, { status: 503 });
  },
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
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

const stop = (start_time: string, name: string, type: string) => ({
  name,
  type,
  start_time,
  duration_minutes: 90,
  description: "",
  location: "Kyoto",
  coordinates: { lat: 35.0, lng: 135.77 },
});
const plan = () => ({
  destination: { name: "Kyoto", country: "Japan" },
  days: [[stop("09:00", "Kinkaku-ji", "attraction"), stop("12:30", "Okonomiyaki Kiraku", "restaurant"), stop("19:00", "Gion Karyo", "restaurant")]].map(
    (activities, i) => ({ day_number: i + 1, date: `2027-04-0${5 + i}`, theme: "t", activities }),
  ),
});
let fails = false;
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async () => {
    if (fails) throw new Error("model down");
    return plan();
  },
}));
vi.mock("@/lib/ai/gemini-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini-call")>()),
  genAI: {
    getGenerativeModel: () => ({
      generateContent: async () => ({ response: { text: () => JSON.stringify({ places: [] }), usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 } } }),
    }),
  },
}));

const { POST } = await import("./route");

const plansWith = async (cookie?: string) => {
  await POST(
    new NextRequest("https://monkeytravel.app/api/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ destination: "Kyoto, Japan", startDate: "2027-04-05", endDate: "2027-04-05", vibes: ["cultural"] }),
    }),
  );
  return logged[logged.length - 1];
};

beforeEach(() => {
  logged.length = 0;
  fails = false;
  access = { allowed: true };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the JSON route's log rows", () => {
  it("say a probe session's plan is a probe, and nothing of it for a traveller", async () => {
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-json-1");
    expect(row.status).toBe(200);
    expect(row.metadata?.probe).toBe(true);
    // The rest of the row is as a traveller's.
    expect(row.metadata?.destination).toBe("Kyoto, Japan");
    expect((await plansWith("mt_session_id=6f2c1d3e-0a4b-4c5d-8e9f-a1b2c3d4e5f6")).metadata).not.toHaveProperty("probe");
  });

  it("mark a probe's failed plan, and leave a traveller's failure with no params", async () => {
    fails = true;
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-json-2");
    expect(row.status).toBe(500);
    expect(row.metadata).toEqual({ probe: true });
    expect((await plansWith()).metadata).toBeUndefined();
  });

  it("mark a probe's plan refused while generation is switched off", async () => {
    access = { allowed: false, reason: "disabled" };
    expect((await plansWith("mt_session_id=e2eprobe-techdebt-live-json-3")).metadata).toEqual({ user_id: "anonymous", probe: true });
    expect((await plansWith()).metadata).toEqual({ user_id: "anonymous" });
  });
});
