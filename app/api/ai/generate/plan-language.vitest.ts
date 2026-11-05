// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A plan is written in the language of the page that asked for it. When the
 * request names none it's the locale cookie's, then the profile's. A cached plan
 * is looked for in that language too, and the plan says which it is, which is
 * what a save keeps as the trip's language.
 */

const s = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  profile: null as string | null,
  written: [] as unknown[],
  lookedUp: [] as unknown[],
}));

const itinerary = {
  destination: { name: "Lisbon", country: "Portugal" },
  days: [1, 2].map((n) => ({
    day_number: n,
    date: `2026-11-0${n}`,
    title: `Day ${n}`,
    activities: [{ name: `Sight ${n}`, type: "attraction", description: "", location: "Lisbon" }],
  })),
};

vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
vi.stubEnv("KV_REST_API_URL", "");
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && s.cookie ? { value: s.cookie } : undefined) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "planner@example.com" } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { preferred_language: s.profile }, error: null }) }) }),
    }),
  }),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: async () => {} }));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 1, remaining: 2, limit: 3 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/cache", () => ({
  getCachedItinerary: async (_user: unknown, _place: unknown, _vibes: unknown, _budget: unknown, language: unknown) => {
    s.lookedUp.push(language);
    return null;
  },
  cacheItinerary: async () => {},
  adjustItineraryDates: (plan: unknown) => plan,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/trips/request-validation", () => ({ validateTripParams: () => ({ valid: true }) }));
vi.mock("@/lib/gemini", () => ({
  generateItinerary: async (_params: unknown, options: { language?: unknown }) => {
    s.written.push(options.language);
    return structuredClone(itinerary);
  },
  generateItineraryStream: async function* (_params: unknown, options: { language?: unknown }) {
    s.written.push(options.language);
    const text = JSON.stringify(itinerary);
    yield { text, done: false };
    yield { text: "", done: true, fullText: text, latencyMs: 1 };
  },
}));
vi.mock("@/lib/ai/itinerary-text", () => ({ parseStreamedItinerary: (text: string) => JSON.parse(text) }));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async () => [] }));
vi.mock("@/lib/activity-bank", () => ({ isActivityBankPopulated: async () => true, populateActivityBank: async () => ({}) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/ai/known-places", () => ({ knownPlacesFor: async () => [] }));

const { POST: postJson } = await import("./route");
const { POST: postStream } = await import("./stream/route");

const request = (path: string, extra: Record<string, unknown>) =>
  new NextRequest(`https://monkeytravel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "mt_session_id=s1" },
    body: JSON.stringify({
      destination: "Lisbon, Portugal",
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      vibes: ["foodie"],
      ...extra,
    }),
  });

const routes = [
  [
    "JSON",
    async (extra: Record<string, unknown>) => {
      const body = await (await postJson(request("/api/ai/generate", extra))).json();
      return (body.data ?? body).itinerary as { language?: unknown };
    },
  ],
  [
    "streaming",
    async (extra: Record<string, unknown>) => {
      const events = (await (await postStream(request("/api/ai/generate/stream", extra))).text()).split("\n\n").filter(Boolean);
      const complete = events.find((event) => event.startsWith("event: complete"));
      if (!complete) throw new Error(`no plan came back: ${events.join(" | ")}`);
      return JSON.parse(complete.split("\ndata: ")[1]).itinerary as { language?: unknown };
    },
  ],
] as const;

beforeEach(() => {
  s.cookie = undefined;
  s.profile = null;
  s.written.length = 0;
  s.lookedUp.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe.each(routes)("the %s route", (_name, plan) => {
  it("writes in the page's language before the cookie's, a regional tag by its base language", async () => {
    s.cookie = "it";
    const { language } = await plan({ locale: "pt-BR" });
    expect(s.written).toEqual(["pt"]);
    expect(s.lookedUp).toEqual(["pt"]);
    expect(language).toBe("pt");
  });

  it("writes in the cookie's when the page names none", async () => {
    s.cookie = "it";
    s.profile = "es";
    const { language } = await plan({});
    expect(s.written).toEqual(["it"]);
    expect(language).toBe("it");
  });

  it("writes in the profile's without a cookie, then in English", async () => {
    s.profile = "es";
    expect((await plan({})).language).toBe("es");
    s.profile = null;
    expect((await plan({ locale: "de" })).language).toBe("en");
    expect(s.written).toEqual(["es", "en"]);
  });
});
