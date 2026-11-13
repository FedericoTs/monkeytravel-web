// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * New dates for the whole trip, in an ask on the trip page: the assistant can't
 * move a trip, so the owner's reply offers Change dates on them. The real route
 * runs with the engine, the chat model and Supabase faked, as in
 * trip-edits-route.vitest.ts.
 */

const proposeTripEdits = vi.fn();
vi.mock("@/lib/ai/assistant/trip-edits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/assistant/trip-edits")>()),
  proposeTripEdits: (input: unknown) => proposeTripEdits(input),
}));
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => ({ response: { text: () => '{"summary": "Noted.", "cards": []}', usageMetadata: {} } }),
      };
    }
  },
}));
vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));
vi.mock("@/lib/ai/regenerate-day", () => ({ regenerateSingleDay: vi.fn() }));
vi.mock("@/lib/trip/coordinate-fallback", () => ({ validateAndFixCoordinates: (days: unknown) => days }));
vi.mock("@/lib/activity-bank", () => ({
  populateActivityBank: vi.fn(async () => {}),
  isActivityBankPopulated: vi.fn(async () => true),
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: vi.fn(async () => {}) }));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 1, remaining: 9, limit: 10, tier: "free", resetAt: "2026-10-17T00:00:00Z" }),
  incrementUsage: vi.fn(),
}));
vi.mock("@/lib/ai/usage", () => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));
let role: "owner" | "editor" = "owner";
vi.mock("@/lib/ai/assistant-access", () => ({ resolveAssistantRole: async () => role, ASSISTANT_FORBIDDEN_MESSAGE: "no" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const act = (id: string, name: string) => ({
  id, name, type: "attraction", time_slot: "morning", start_time: "10:00", duration_minutes: 90,
  description: `${name} in full.`, location: "Centre", estimated_cost: { amount: 10, currency: "EUR", tier: "budget" },
});
const storedTrip = {
  id: "trip-1",
  user_id: "user-1",
  title: "Dublin Trip",
  start_date: "2027-03-11",
  end_date: "2027-03-13",
  budget: { total: 900, currency: "EUR" },
  tags: [],
  trip_meta: { destination: "Dublin, Ireland", locale: "en" },
  itinerary: [
    { day_number: 1, date: "2027-03-11", activities: [act("a1", "Trinity College")] },
    { day_number: 2, date: "2027-03-12", activities: [act("b1", "National Gallery")] },
    { day_number: 3, date: "2027-03-13", activities: [act("c1", "Grafton Street")] },
  ],
};

type Call = { table: string; op: string; value?: unknown };
let calls: Call[];
function fakeSupabase() {
  const from = (table: string) => {
    let op = "select";
    let value: unknown;
    const result = () => {
      calls.push({ table, op, value });
      if (table === "users") return { data: { preferred_language: "en" }, error: null };
      if (table === "trips") return op === "update" ? { data: null, error: null } : { data: storedTrip, error: null };
      if (table === "ai_conversations") {
        if (op === "insert") return { data: { id: "conv-new" }, error: null };
        if (op === "update") return { data: null, error: null };
        return { data: { id: "conv-1", messages: [], context: {} }, error: null };
      }
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "or", "not", "limit", "order", "is", "neq", "in"]) chain[m] = () => chain;
    chain.insert = (v: unknown) => ((op = "insert"), (value = v), chain);
    chain.update = (v: unknown) => ((op = "update"), (value = v), chain);
    chain.single = async () => result();
    chain.maybeSingle = async () => result();
    chain.then = (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return chain;
  };
  return { from };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "user-1", email: "owner@example.com" }, supabase: fakeSupabase(), errorResponse: null }),
}));

const { POST } = await import("./route");

async function send(message: string) {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant", {
      method: "POST",
      body: JSON.stringify({ tripId: "trip-1", message, conversationId: "conv-1" }),
    }),
  );
  return { status: res.status, json: await res.json() };
}
const savedReply = () => {
  const update = calls.filter((c) => c.table === "ai_conversations" && c.op === "update").at(-1);
  const msgs = (update?.value as { messages: Array<Record<string, unknown>> }).messages;
  return msgs[msgs.length - 1];
};

beforeEach(() => {
  role = "owner";
  calls = [];
  proposeTripEdits.mockReset();
  proposeTripEdits.mockResolvedValue({
    reply: "Your trip runs 11 to 13 March.",
    revisedDays: [],
    summary: "",
    meta: { model: "engine-model", costUsd: 0.002, generationTimeMs: 1200 },
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("trip-page assistant: new dates for the trip", () => {
  it("offers the owner Change dates on them, under a reply that says the trip's dates stand", async () => {
    const { status, json } = await send("we arrive 11 mar and fly home 15 mar");
    expect(status).toBe(200);
    expect(json.message.changeDates).toEqual({ start: "2027-03-11", end: "2027-03-15" });
    expect(json.message.content).toMatch(/^Your trip runs 11 to 13 March\.\n\n\(Your trip's dates are still .+: to change them to .+, tap the button below\.\)$/);
    // Kept in the thread, so the offer is still there when the chat is opened again.
    expect(savedReply().changeDates).toEqual({ start: "2027-03-11", end: "2027-03-15" });
    // Nothing moves before the traveller confirms the dates.
    expect(calls.some((c) => c.table === "trips" && c.op === "update")).toBe(false);
  });

  it("offers an editor nothing: only the owner changes the trip's dates", async () => {
    role = "editor";
    const { json } = await send("we arrive 11 mar and fly home 15 mar");
    expect(json.message.changeDates).toBeUndefined();
    expect(json.message.content).toBe("Your trip runs 11 to 13 March.");
  });

  it("reads days of the trip as days, not as new dates", async () => {
    const { json } = await send("the National Gallery on 12 mar and Howth on 15 mar");
    expect(json.message.changeDates).toBeUndefined();
  });
});
