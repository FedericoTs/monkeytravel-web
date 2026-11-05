// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A signed-out visitor's free plans count plans, not tries. The stream has to
 * count a try before it starts, while its headers can still set the cookie, so
 * when it fails the JSON endpoint the wizard falls back to settles the count
 * under the same generation id. These run both routes over the real counter,
 * with one cookie jar standing in for the browser.
 */

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");

const s = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  streamRefusal: null as string | null,
  jsonRefusal: null as string | null,
  modelCalls: 0,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (s.jar.has(name) ? { name, value: s.jar.get(name)! } : undefined),
    set: (opts: { name: string; value: string }) => void s.jar.set(opts.name, opts.value),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));
vi.mock("@/lib/ai/user-context", () => ({
  loadUserContext: async () => ({ profilePreferences: {}, userLanguage: "en" }),
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
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
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async () => {
    s.modelCalls++;
    if (s.jsonRefusal) throw new Error(s.jsonRefusal);
    return plan();
  },
  generateItineraryStream: async function* () {
    s.modelCalls++;
    if (s.streamRefusal) throw new Error(s.streamRefusal);
    const text = JSON.stringify(plan());
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => [] }));
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [], knownPlacesUsed: () => 0 }));
vi.mock("@/lib/maps-grounding", () => ({
  canGroundDestination: () => false,
  generateItineraryWithMapsGrounding: async () => {
    throw new Error("not used");
  },
  isMapsGroundingAvailable: () => false,
  getMapsGroundingCost: () => 0,
}));

const { POST: postJson } = await import("./route");
const { POST: postStream } = await import("./stream/route");
const { MODEL_OUTAGE_MESSAGE } = await import("@/lib/ai/model-outage");
const { GENERATION_ID_HEADER } = await import("@/lib/ai/generation-id");

const OUT_OF_CREDIT = `{"error":{"code":402,"message":"Your prepayment credits are depleted.","status":"RESOURCE_EXHAUSTED"}}`;

function plan() {
  return {
    destination: { name: "Rome", country: "Italy" },
    days: [1, 2].map((n) => ({
      day_number: n,
      date: `2026-11-0${n}`,
      title: `Day ${n}`,
      activities: [{ name: `Sight ${n}`, type: "attraction", description: "", location: "Rome" }],
    })),
  };
}

const request = (path: string, generationId: string) =>
  new NextRequest(`https://monkeytravel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "mt_session_id=s1", [GENERATION_ID_HEADER]: generationId },
    body: JSON.stringify({ destination: "Rome, Italy", startDate: "2026-11-01", endDate: "2026-11-02", vibes: ["foodie"], mustDos: ["a quiet coffee"] }),
  });

/** One try as the wizard makes it: the stream, then the JSON endpoint unless the stream brought a plan. */
async function tryForAPlan() {
  const id = crypto.randomUUID();
  const stream = await postStream(request("/api/ai/generate/stream", id));
  const text = await stream.text();
  if (stream.ok && text.includes("event: complete")) return { via: "stream", status: 200, body: {} as Record<string, unknown> };
  const json = await postJson(request("/api/ai/generate", id));
  return { via: "json", status: json.status, body: (await json.json()) as Record<string, unknown> };
}

const used = () => (s.jar.has("mt_anon") ? JSON.parse(s.jar.get("mt_anon")!).used : 0);
const haveUsed = (n: number) =>
  s.jar.set("mt_anon", JSON.stringify({ used: n, resetAt: Date.now() + 60 * 60 * 1000 }));

beforeEach(() => {
  s.jar.clear();
  s.streamRefusal = null;
  s.jsonRefusal = null;
  s.modelCalls = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a signed-out visitor's free plans", () => {
  it("a plan from the stream counts once", async () => {
    expect(await tryForAPlan()).toMatchObject({ via: "stream", status: 200 });
    expect(used()).toBe(1);
  });

  it("tries the model refuses cost nothing and never reach the cap, however many", async () => {
    s.streamRefusal = OUT_OF_CREDIT;
    s.jsonRefusal = OUT_OF_CREDIT;
    for (let i = 0; i < 7; i++) {
      const answer = await tryForAPlan();
      expect(answer).toMatchObject({ via: "json", status: 503, body: { error: MODEL_OUTAGE_MESSAGE } });
      expect(used()).toBe(0);
    }
  });

  it("the try that takes the count to the limit still reaches the fallback, and is given back", async () => {
    haveUsed(4);
    s.streamRefusal = OUT_OF_CREDIT;
    s.jsonRefusal = OUT_OF_CREDIT;
    expect(await tryForAPlan()).toMatchObject({ status: 503, body: { error: MODEL_OUTAGE_MESSAGE } });
    expect(used()).toBe(4);
  });

  it("gives back a try that failed for any other reason too", async () => {
    s.streamRefusal = "the model answered nonsense";
    s.jsonRefusal = "the model answered nonsense";
    expect((await tryForAPlan()).status).toBe(500);
    expect(used()).toBe(0);
  });

  it("a stream that failed and a plan from the fallback is one plan", async () => {
    s.streamRefusal = "a dropped stream";
    expect(await tryForAPlan()).toMatchObject({ via: "json", status: 200 });
    expect(used()).toBe(1);
  });

  it("the fifth plan can come from the fallback", async () => {
    haveUsed(4);
    s.streamRefusal = "a dropped stream";
    expect(await tryForAPlan()).toMatchObject({ via: "json", status: 200 });
    expect(used()).toBe(5);
  });

  it("five plans are still the cap, on both endpoints, before any model call", async () => {
    haveUsed(5);
    expect(await tryForAPlan()).toMatchObject({ via: "json", status: 429, body: { code: "RATE_LIMIT" } });
    expect(s.modelCalls).toBe(0);
    expect(used()).toBe(5);
  });

  it("the JSON endpoint on its own counts plans and gives back nothing it didn't count", async () => {
    haveUsed(2);
    s.jsonRefusal = OUT_OF_CREDIT;
    const failed = await postJson(request("/api/ai/generate", crypto.randomUUID()));
    expect(failed.status).toBe(503);
    expect(used()).toBe(2);

    s.jsonRefusal = null;
    const planned = await postJson(request("/api/ai/generate", crypto.randomUUID()));
    expect(planned.status).toBe(200);
    expect(used()).toBe(3);
  });
});
