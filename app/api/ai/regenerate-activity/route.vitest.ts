// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Swapping one activity spends a Gemini call. Who may ask, the kill switch and
 * the monthly limit all have to come before that call. The real route, usage
 * limits, gateway and regeneration run; only Gemini, the Supabase clients,
 * cookies, analytics and the stored prompt are faked. What the trip's language
 * does and what an out-of-credit model answers have their own tests one folder up.
 */

const OWNER = { id: "owner-1", email: "owner@mail.example.com" };
const TRIP = { id: "trip-1", user_id: OWNER.id, budget: { tier: "premium" }, trip_meta: {} };
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const FREE_MONTHLY_LIMIT = 100;

const s = vi.hoisted(() => ({
  signedIn: null as { id: string; email: string } | null,
  trip: null as Record<string, unknown> | null,
  tripRead: null as { data: unknown; error: unknown } | null,
  apiConfig: null as Record<string, unknown> | null,
  used: 0,
  reply: "",
  /** The text of what each model call was asked. */
  asked: [] as string[],
  outcomes: [] as unknown[],
}));

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (request: { contents: Array<{ parts: Array<{ text: string }> }> }) => {
          s.asked.push(request.contents.at(-1)?.parts[0].text ?? "");
          return { response: { text: () => s.reply, usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } } };
        },
      };
    }
  },
}));
// The daily limit's counter is real, on its in-memory store: nothing here reaches Redis.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = async () => {
      throw new Error("no Redis in tests");
    };
  },
}));
vi.mock("@/lib/prompts", () => ({ getPrompt: async () => "Generate one activity." }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => {} }));
vi.mock("@/lib/ai/observability", () => ({
  recordAiOutcome: async (outcome: unknown) => void s.outcomes.push(outcome),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

/** The signed-in person's client. A trip is found only under its owner's id, as RLS and the filter both want. */
const session = fakeSupabase((q: FakeQuery) => {
  if (q.table === "trips") {
    if (s.tripRead) return s.tripRead;
    return s.trip && eqOf(q, "id") === s.trip.id && eqOf(q, "user_id") === s.trip.user_id ? { data: s.trip, error: null } : NO_ROW;
  }
  if (q.table === "users") {
    return { data: { subscription_tier: "free", subscription_expires_at: null, email: OWNER.email, referral_tier: 0 }, error: null };
  }
  if (q.table === "user_usage") return { data: { ai_regenerations_used: s.used }, error: null };
  return NO_ROW;
});
const service = fakeSupabase((q: FakeQuery) => {
  if (q.table === "api_config") return { data: s.apiConfig, error: null };
  return { data: null, error: null };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ ...session.client, auth: { getUser: async () => ({ data: { user: s.signedIn }, error: null }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { POST } = await import("./route");

const ITINERARY = [
  {
    day_number: 1,
    date: "2027-05-10",
    theme: "Ancient Rome",
    activities: [
      { id: "a1", name: "Colosseum", type: "attraction", time_slot: "morning" },
      { id: "a2", name: "Roman Forum", type: "attraction", time_slot: "afternoon" },
    ],
  },
  {
    day_number: 2,
    date: "2027-05-11",
    activities: [{ id: "flight", name: "Flight home", type: "transport", time_slot: "morning", locked: true }],
  },
];
const ASK = { tripId: TRIP.id, activityId: "a1", dayIndex: 0, destination: "Rome", itinerary: ITINERARY };
const NEW_ACTIVITY = JSON.stringify({ name: "Pantheon", type: "attraction", time_slot: "morning", start_time: "09:00", description: "A temple." });

const regenerate = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/regenerate-activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const counted = () => service.log.filter((q) => q.table === "increment_usage").map((q) => q.value);
const logged = () => service.log.filter((q) => q.table === "api_request_logs").map((q) => q.value as Record<string, unknown>);

/** A refusal: this answer, no paid call, and no use of the monthly limit. */
const expectRefused = async (res: Response, status: number) => {
  expect(res.status).toBe(status);
  expect((await res.clone().json()).activity).toBeUndefined();
  expect(s.asked).toEqual([]);
  expect(counted()).toEqual([]);
};

beforeEach(() => {
  s.signedIn = OWNER;
  s.trip = { ...TRIP };
  s.tripRead = null;
  s.apiConfig = null;
  s.used = 7;
  s.reply = NEW_ACTIVITY;
  s.asked = [];
  s.outcomes = [];
  session.log.length = 0;
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("who may ask", () => {
  it("refuses someone signed out, reading no trip", async () => {
    s.signedIn = null;
    await expectRefused(await regenerate(ASK), 401);
    expect(session.log).toEqual([]);
  });

  it("answers 404 for a trip that isn't theirs, as if it didn't exist", async () => {
    s.signedIn = { id: "someone-else", email: "person@mail.example.com" };
    await expectRefused(await regenerate(ASK), 404);
  });

  it("answers 500, not 404, when the trip read is refused", async () => {
    s.tripRead = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    await expectRefused(await regenerate(ASK), 500);
  });
});

describe("what it refuses before paying for a call", () => {
  it("asks for each thing it needs", async () => {
    for (const missing of ["tripId", "activityId", "dayIndex", "destination", "itinerary"]) {
      const res = await regenerate({ ...ASK, [missing]: undefined });
      await expectRefused(res, 400);
      expect((await res.json()).error).toBe("Missing required fields");
    }
    expect(session.log).toEqual([]);
  });

  it.each<[string, unknown, number]>([
    ["a body that isn't JSON", "{not json", 400],
    ["a day outside the itinerary", { ...ASK, dayIndex: 9 }, 400],
    ["an activity that isn't in the itinerary", { ...ASK, activityId: "nope" }, 404],
    ["a fixed plan the person added themselves", { ...ASK, activityId: "flight", dayIndex: 1 }, 400],
  ])("%s", async (_name, body, status) => {
    await expectRefused(await regenerate(body), status);
  });

  it("takes the largest itinerary a real trip has, a few times over", async () => {
    const res = await regenerate({ ...ASK, itinerary: [ITINERARY[0], { ...ITINERARY[1], theme: "x".repeat(400_000) }] });
    expect(res.status).toBe(200);
  });

  it("refuses an oversized destination or itinerary, since all of it is sent to the model", async () => {
    await expectRefused(await regenerate({ ...ASK, destination: "Rome ".repeat(100_000) }), 400);
    const names = Array.from({ length: 50_000 }, (_, i) => ({ id: `x${i}`, name: `Place ${i}`, type: "attraction", time_slot: "morning" }));
    await expectRefused(await regenerate({ ...ASK, itinerary: [ITINERARY[0], { ...ITINERARY[1], activities: names }] }), 400);
  });

  it("answers 400, not 500, to a malformed itinerary, a day that isn't a number, or a body of JSON null", async () => {
    await expectRefused(await regenerate({ ...ASK, itinerary: "not a list" }), 400);
    await expectRefused(await regenerate({ ...ASK, itinerary: [{}] }), 400);
    await expectRefused(await regenerate({ ...ASK, dayIndex: "length" }), 400);
    await expectRefused(await regenerate({ ...ASK, destination: { any: "object" } }), 400);
    await expectRefused(await regenerate("null"), 400);
  });
});

describe("the kill switch and the limits", () => {
  it("makes no paid call while Gemini is switched off, and logs the blocked call at no cost", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    const res = await regenerate(ASK);
    await expectRefused(res, 503);
    expect((await res.json()).error).toBe("Gemini has been disabled by the administrator");
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ response_status: 503, cost_usd: 0 });
  });

  it("makes no paid call past Gemini's daily limit", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 1 };
    expect((await regenerate(ASK)).status).toBe(200);
    expect(s.asked).toHaveLength(1);
    expect((await regenerate(ASK)).status).toBe(503);
    expect(s.asked).toHaveLength(1);
  });

  it("makes no paid call for someone at the monthly limit, and points them to upgrade", async () => {
    s.used = FREE_MONTHLY_LIMIT;
    const res = await regenerate(ASK);
    await expectRefused(res, 429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT", upgradeUrl: "/pricing", usage: { allowed: false, used: FREE_MONTHLY_LIMIT } });

    s.used = FREE_MONTHLY_LIMIT - 1;
    expect((await regenerate(ASK)).status).toBe(200);
    expect(s.asked).toHaveLength(1);
  });
});

describe("a replacement", () => {
  it("answers the model's activity under a new id, and writes only the use and the call's log", async () => {
    const res = await regenerate(ASK);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toMatchObject({ name: "Pantheon", type: "attraction", time_slot: "morning" });
    expect(body.activity.id).toEqual(expect.any(String));
    expect(body.activity.id).not.toBe("a1");
    expect(body.usage).toMatchObject({ allowed: true, used: 8, remaining: 92 });

    expect(s.asked).toHaveLength(1);
    expect(session.log.filter((q) => q.op !== "select")).toEqual([]);
    expect(service.log.filter((q) => q.op !== "select").map((q) => q.table)).toEqual(["api_request_logs", "increment_usage"]);
    expect(counted()).toEqual([
      {
        p_user_id: OWNER.id,
        p_period_type: "monthly",
        p_period_key: expect.stringMatching(/^\d{4}-\d{2}$/),
        p_column_name: "ai_regenerations_used",
        p_amount: 1,
      },
    ]);
    expect(logged()[0]).toMatchObject({ api_name: "gemini", response_status: 200 });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });

  it("asks for what the trip is: its budget and style, and none of the places already in it", async () => {
    s.trip = { ...TRIP, trip_meta: { travel_style: "backpacker" } };
    await regenerate(ASK);
    expect(s.asked[0]).toContain("trip to Rome");
    expect(s.asked[0]).toContain("Budget Tier: premium");
    expect(s.asked[0]).toContain("BACKPACKER TRIP");
    expect(s.asked[0]).toContain("Colosseum, Roman Forum, Flight home");
  });

  it("answers 500, uses none of the limit, and logs what was spent when the model's answers are unusable", async () => {
    s.reply = "I could not do that";
    const res = await regenerate(ASK);
    expect(res.status).toBe(500);
    expect((await res.json()).activity).toBeUndefined();
    expect(counted()).toEqual([]);
    expect(s.asked).toHaveLength(2);
    expect(logged()[0]).toMatchObject({ response_status: 500 });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
    expect(s.outcomes).toMatchObject([{ endpoint: "regenerate-activity", outcome: "failure" }]);
  });
});
