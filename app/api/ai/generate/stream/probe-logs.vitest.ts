// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A live check of production plans with a tagged probe session (mt_session_id
 * e2eprobe-...). Its log rows say so, so the reads of travellers' plans (the
 * daily reports, the costs tab) leave it out; a traveller's rows carry nothing.
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
}));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
const logged: Array<{ status?: number; metadata?: Record<string, unknown> }> = [];
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  logApiCall: async (row: (typeof logged)[number]) => void logged.push(row),
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 10, limit: 10 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/cache")>()),
  getCachedItinerary: async () => null,
  cacheItinerary: async () => {},
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => {} }));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [], knownPlacesUsed: () => 0 }));

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
let garbled = false;
vi.mock("@/lib/gemini", () => ({
  generateItineraryStream: async function* () {
    if (fails) throw new Error("model down");
    const text = garbled ? "{ the plan, cut off" : JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
// A long trip is written in parts after an outline: a part that fails is logged on its own row.
let inParts = false;
vi.mock("@/lib/ai/plan-in-parts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/plan-in-parts")>()),
  writesInParts: () => inParts,
  writeInParts: async function* () {
    yield* [];
    throw new Error("a part failed");
  },
}));
vi.mock("@/lib/ai/trip-outline", () => ({ generateTripOutline: async () => ({ days: [{ day_number: 1, theme: "t" }], costUsd: 0 }) }));
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
  const res = await POST(
    new NextRequest("http://localhost/api/ai/generate/stream", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ destination: "Kyoto, Japan", startDate: "2027-04-05", endDate: "2027-04-05", vibes: ["cultural"], budgetTier: "budget" }),
    }),
  );
  await res.text();
  await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));
  return logged[logged.length - 1];
};

beforeEach(() => {
  logged.length = 0;
  fails = false;
  garbled = false;
  inParts = false;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the stream's log rows", () => {
  it("say a probe session's plan is a probe", async () => {
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-stream-1");
    expect(row.status).toBe(200);
    expect(row.metadata?.probe).toBe(true);
    // The rest of the row is as a traveller's.
    expect(row.metadata?.destination).toBe("Kyoto, Japan");
  });

  it("say nothing of it for a traveller's session, or none", async () => {
    expect((await plansWith("mt_session_id=6f2c1d3e-0a4b-4c5d-8e9f-a1b2c3d4e5f6")).metadata).not.toHaveProperty("probe");
    logged.length = 0;
    expect((await plansWith()).metadata).not.toHaveProperty("probe");
  });

  it("mark a probe's failed plan too", async () => {
    fails = true;
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-stream-2");
    expect(row.status).toBe(500);
    expect(row.metadata?.probe).toBe(true);
    logged.length = 0;
    expect((await plansWith()).metadata).not.toHaveProperty("probe");
  });

  it("mark a probe's plan that came back unreadable", async () => {
    garbled = true;
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-stream-4");
    expect(String((row as { error?: string }).error)).toContain("unparseable output");
    expect(row.metadata?.probe).toBe(true);
    logged.length = 0;
    expect((await plansWith()).metadata).not.toHaveProperty("probe");
  });

  it("mark a probe's long trip whose part failed", async () => {
    inParts = true;
    const row = await plansWith("mt_session_id=e2eprobe-techdebt-live-stream-3");
    expect(row.status).toBe(500);
    expect(String((row as { error?: string }).error)).toContain("parts failed");
    expect(row.metadata?.probe).toBe(true);
    logged.length = 0;
    expect((await plansWith()).metadata).not.toHaveProperty("probe");
  });
});
