// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Part of a trip is rewritten in the trip's own language, wherever its owner is
 * browsing from. A trip with no language of its own gets the visitor's. The
 * routes run for real, up to what calls the model.
 */

const s = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  tripMeta: {} as Record<string, unknown>,
  asked: [] as unknown[],
}));
const ask = async (input: { language?: unknown }) => {
  s.asked.push(input.language);
  throw new Error("the reply isn't what these tests read");
};

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && s.cookie ? { value: s.cookie } : undefined) }),
}));
vi.mock("@/lib/ai/regenerate-activity", () => ({ regenerateSingleActivity: (input: { language?: unknown }) => ask(input) }));
vi.mock("@/lib/ai/regenerate-day", () => ({ regenerateSingleDay: (input: { language?: unknown }) => ask(input) }));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  blockedCall: () => new Response(null, { status: 503 }),
  logApiCall: async () => {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 5, limit: 5 }),
  incrementUsage: async () => {},
}));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/api/auth", async () => {
  const { fakeSupabase } = await import("@/tests/fake-supabase");
  return {
    getAuthenticatedUser: async () => ({ user: { id: "u1", email: "planner@example.com" }, supabase: fakeSupabase().client }),
    verifyTripOwnership: async () => ({
      trip: {
        id: "t1",
        user_id: "u1",
        title: "Rome",
        itinerary: [{ day_number: 1, date: "2027-05-10", activities: [] }],
        trip_meta: s.tripMeta,
      },
    }),
  };
});
vi.mock("@/lib/api/require-row", () => ({
  requireRow: async () => ({ row: { id: "t1", user_id: "u1", budget: null, trip_meta: s.tripMeta } }),
}));

const post = (path: string, body: unknown) =>
  new NextRequest(`https://monkeytravel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const routes = [
  [
    "an activity",
    async () =>
      (await import("./regenerate-activity/route")).POST(
        post("/api/ai/regenerate-activity", {
          tripId: "t1",
          activityId: "a1",
          dayIndex: 0,
          destination: "Rome",
          itinerary: [{ day_number: 1, date: "2027-05-10", activities: [{ id: "a1", name: "Colosseum", type: "attraction" }] }],
        })
      ),
  ],
  [
    "a day",
    async () => (await import("./regenerate-day/route")).POST(post("/api/ai/regenerate-day", { tripId: "t1", dayNumber: 1 })),
  ],
] as const;

const language = async (run: () => Promise<Response>) => {
  s.asked.length = 0;
  await run();
  expect(s.asked).toHaveLength(1);
  return s.asked[0];
};

beforeEach(() => {
  s.cookie = undefined;
  s.tripMeta = {};
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe.each(routes)("regenerating %s", (_name, run) => {
  it("uses the trip's own language before the visitor's", async () => {
    s.tripMeta = { locale: "pt" };
    s.cookie = "it";
    expect(await language(run)).toBe("pt");
  });

  it("uses the visitor's for a trip with none, a regional tag by its base language", async () => {
    s.cookie = "it";
    expect(await language(run)).toBe("it");
    s.cookie = "pt-BR";
    expect(await language(run)).toBe("pt");
  });

  it("uses English when nothing names a language the app has", async () => {
    expect(await language(run)).toBe("en");
    s.cookie = "de";
    s.tripMeta = { locale: "fr" };
    expect(await language(run)).toBe("en");
  });
});
