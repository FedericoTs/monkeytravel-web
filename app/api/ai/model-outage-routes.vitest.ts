// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * With the model's credit used up no try can work, so each AI route answers with
 * the same code and its page says the AI is down, instead of asking for another
 * try. Any other failure stays the failure it was. The routes run for real, with
 * what calls the model faked to refuse.
 */

const OUT_OF_CREDIT = `Failed: AI service unavailable (root: {"error":{"code":402,"message":"Your prepayment credits are depleted."}})`;
const OVERLOADED = "503 model overloaded";

const s = vi.hoisted(() => ({
  refusal: "",
  extracted: null as unknown,
  booking: null as unknown,
  counted: [] as string[],
}));
const refuse = async () => {
  throw new Error(s.refusal);
};

vi.mock("@/lib/ai/assistant/engine", () => ({ assistTrip: () => refuse(), MAX_TRIP_DAYS_MULTI: 21 }));
vi.mock("@/lib/ai/regenerate-activity", () => ({ regenerateSingleActivity: () => refuse() }));
vi.mock("@/lib/ai/regenerate-day", () => ({ regenerateSingleDay: () => refuse() }));
vi.mock("@/lib/ai/packing-list", () => ({ generatePackingList: () => refuse() }));
vi.mock("@/lib/ai/anchor-import", () => ({
  extractPlan: async () => s.extracted,
  isPlanExtractError: (r: { error?: unknown }) => typeof r?.error === "string",
}));
vi.mock("@/lib/email-parse/extract", () => ({
  extractBooking: async () => s.booking,
  isParseError: (r: { error?: unknown }) => typeof r?.error === "string",
}));

vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  blockedCall: () => new Response(null, { status: 503 }),
  logApiCall: async () => {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 5, limit: 5 }),
  incrementUsage: async (_user: string, what: string) => void s.counted.push(what),
}));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/anonymous/rate-limit-extract", () => ({
  checkExtractRateLimit: async () => ({ allowed: true }),
  recordExtract: async () => {},
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "u1", email: "planner@example.com" },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({}) }) }) }) }) },
  }),
  verifyTripOwnership: async () => ({
    trip: { id: "t1", user_id: "u1", title: "Rome", itinerary: [{ day_number: 1, date: "2027-05-10", activities: [] }], trip_meta: {} },
  }),
}));
vi.mock("@/lib/api/require-row", () => ({
  requireRow: async () => ({ row: { id: "t1", user_id: "u1", budget: null, trip_meta: {} } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  signedInUserId: async () => null,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock("@/lib/ai/user-context", () => ({ readLocaleCookie: async () => null }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) }));

const post = (path: string, body: unknown) =>
  new NextRequest(`https://monkeytravel.app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const SAYS_DOWN = { status: 503, code: "MODEL_OUTAGE" };

beforeEach(() => {
  s.refusal = OUT_OF_CREDIT;
  s.counted.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const answer = async (res: Response) => ({ status: res.status, code: (await res.json()).code });

const refusing = [
  [
    "the wizard's assistant",
    async () =>
      (await import("./assistant-anon/route")).POST(
        post("/api/ai/assistant-anon", {
          message: "Make day 1 slower",
          destination: "Rome, Italy",
          tripTitle: "Rome",
          days: [{ day_number: 1, activities: [] }],
        })
      ),
  ],
  [
    "regenerating an activity",
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
    "regenerating a day",
    async () =>
      (await import("./regenerate-day/route")).POST(post("/api/ai/regenerate-day", { tripId: "t1", dayNumber: 1 })),
  ],
  [
    "the packing list",
    async () =>
      (await import("../tools/packing-list/route")).POST(
        post("/api/tools/packing-list", { destination: "Rome", startDate: "2027-05-10", endDate: "2027-05-12", locale: "en" })
      ),
  ],
] as const;

describe("a model refusing", () => {
  it.each(refusing)("%s says the model is out of service when the credit ran out", async (_name, call) => {
    expect(await answer(await call())).toEqual(SAYS_DOWN);
  });

  it.each(refusing)("%s keeps its own failure for anything else", async (_name, call) => {
    s.refusal = OVERLOADED;
    const { status, code } = await answer(await call());
    expect(status).toBeGreaterThanOrEqual(500);
    expect(code).not.toBe("MODEL_OUTAGE");
  });
});

describe("a pasted plan the model can't read", () => {
  const paste = async () =>
    (await import("./import-plan/route")).POST(
      post("/api/ai/import-plan", { text: "Day 1: land in Venice", startDate: "2027-05-10", endDate: "2027-05-12" })
    );

  it("says the model is out of service when it is", async () => {
    s.extracted = { error: "model_outage" };
    expect(await answer(await paste())).toEqual(SAYS_DOWN);
  });

  it("keeps its own failure for anything else", async () => {
    s.extracted = { error: "extract_failed" };
    const { status, code } = await answer(await paste());
    expect(status).toBe(503);
    expect(code).not.toBe("MODEL_OUTAGE");
  });
});

describe("a pasted booking the model can't read", () => {
  const paste = async () =>
    (await import("../trips/[id]/parse-confirmation/route")).POST(
      post("/api/trips/t1/parse-confirmation", { emailBody: "Your booking is confirmed. ".repeat(10) }),
      { params: Promise.resolve({ id: "t1" }) }
    );

  it("says the model is out of service, and spends none of the day's allowance", async () => {
    s.booking = { error: "model_outage" };
    const res = await paste();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ error: "model_outage" });
    expect(s.counted).toEqual([]);
  });

  it("spends it when the model did answer", async () => {
    s.booking = { error: "no_booking_found" };
    await paste();
    await vi.waitFor(() => expect(s.counted).toEqual(["aiAssistantMessages"]));
  });
});
