// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ItineraryDay } from "@/types";

/**
 * The trip page's assistant hands free-form edits to the wizard's edit engine
 * (lib/ai/assistant/trip-edits.ts) and proposes its days as one multi-day
 * change. Before, only a few phrasings produced a change: "adding Wigwam to
 * Day 3" or "nightclubs on the 2nd, 4th and 6th night" got a promise and no
 * card. The real route runs with the engine, the chat model and Supabase faked.
 */

const proposeTripEdits = vi.fn();
vi.mock("@/lib/ai/assistant/trip-edits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/assistant/trip-edits")>()),
  proposeTripEdits: (input: unknown) => proposeTripEdits(input),
}));

const chatCalls = vi.fn();
let chatReply = '{"summary": "Which day should it go on?", "cards": []}';
vi.mock("@/lib/ai/genai-compat", () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (prompt: unknown) => {
          chatCalls(prompt);
          return { response: { text: () => chatReply, usageMetadata: {} } };
        },
      };
    }
  },
}));
vi.mock("@/lib/gemini", () => ({
  logCacheMetrics: vi.fn(),
  regenerateSingleDay: vi.fn(),
  validateAndFixCoordinates: (days: unknown) => days,
}));
vi.mock("@/lib/activity-bank", () => ({
  findMatchingActivity: vi.fn(async () => null),
  isRelevantBankMatch: vi.fn(() => false),
  populateActivityBank: vi.fn(async () => {}),
  isActivityBankPopulated: vi.fn(async () => true),
  saveToActivityBank: vi.fn(async () => {}),
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => ({ allowed: true }), logApiCall: vi.fn() }));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 1, remaining: 9, limit: 10, tier: "free", resetAt: "2026-10-17T00:00:00Z" }),
  incrementUsage: vi.fn(),
}));
const recordUsage = vi.fn();
vi.mock("@/lib/ai/usage", () => ({ recordUsage: (u: unknown) => recordUsage(u) }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: vi.fn() }));
vi.mock("@/lib/ai/assistant-access", () => ({ resolveAssistantRole: async () => "owner", ASSISTANT_FORBIDDEN_MESSAGE: "no" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const act = (id: string, name: string, start: string, slot: string) => ({
  id, name, type: "attraction", time_slot: slot, start_time: start, duration_minutes: 90,
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
    { day_number: 1, date: "2027-03-11", activities: [act("a1", "Trinity College", "09:00", "morning")] },
    { day_number: 2, date: "2027-03-12", activities: [act("b1", "National Gallery", "10:00", "morning")] },
    { day_number: 3, date: "2027-03-13", activities: [act("c1", "Grafton Street", "14:00", "afternoon")] },
  ],
};
const savedMessages = [
  { role: "user", content: "Add nightclubs", timestamp: "2026-10-16T11:26:01Z" },
  { role: "assistant", content: "Which nights would you like them on?", timestamp: "2026-10-16T11:26:02Z" },
];

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
        return { data: { id: "conv-1", messages: savedMessages }, error: null };
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

async function send(message: string, previewMode = true, extra: Record<string, unknown> = {}) {
  const res = await POST(
    new NextRequest("http://localhost/api/ai/assistant", {
      method: "POST",
      body: JSON.stringify({ tripId: "trip-1", message, conversationId: "conv-1", previewMode, ...extra }),
    }),
  );
  return { status: res.status, json: await res.json() };
}

const wigwamDay3: ItineraryDay = {
  day_number: 3,
  date: "2027-03-13",
  activities: [
    act("c1", "Grafton Street", "14:00", "afternoon"),
    { ...act("edit-3-1-wigwam", "Wigwam", "22:00", "evening"), type: "nightlife" },
  ] as ItineraryDay["activities"],
};
const meta = { model: "gemini-2.5-flash", costUsd: 0.002, generationTimeMs: 1200 };
const savedAssistantMessage = () => {
  const update = calls.filter((c) => c.table === "ai_conversations" && c.op === "update").at(-1);
  const msgs = (update?.value as { messages: Array<Record<string, unknown>> }).messages;
  return msgs[msgs.length - 1];
};

beforeEach(() => {
  calls = [];
  proposeTripEdits.mockReset();
  chatCalls.mockReset();
  recordUsage.mockReset();
  chatReply = '{"summary": "Which day should it go on?", "cards": []}';
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("trip-page assistant: free-form edits", () => {
  it("proposes the engine's days as one multi-day change, from the request and the conversation", async () => {
    proposeTripEdits.mockResolvedValue({
      reply: "Ready: Wigwam on Day 3 at 22:00, after Grafton Street.",
      revisedDays: [wigwamDay3],
      summary: "Day 3: Wigwam at 22:00.",
      meta,
    });
    const { status, json } = await send("adding Wigwam to Day 3");
    expect(status).toBe(200);

    expect(proposeTripEdits).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "adding Wigwam to Day 3",
        destination: "Dublin, Ireland",
        locale: "en",
        history: [
          { role: "user", text: "Add nightclubs" },
          { role: "assistant", text: "Which nights would you like them on?" },
        ],
      }),
    );
    expect(json.pendingChange).toEqual({
      type: "apply_draft",
      days: [wigwamDay3],
      changedDayNumbers: [3],
      unmappedDayNumbers: [],
      reason: "Day 3: Wigwam at 22:00.",
    });
    expect(json.message.content).toBe("Ready: Wigwam on Day 3 at 22:00, after Grafton Street.");
    // The engine's reply is the reply: no second model call.
    expect(chatCalls).not.toHaveBeenCalled();
    // Nothing is written before Apply, and the history records a pending change.
    expect(calls.some((c) => c.table === "trips" && c.op === "update")).toBe(false);
    expect(savedAssistantMessage().action).toMatchObject({ type: "apply_draft", pending: true, applied: false, dayCount: 1 });
    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({ modelId: "gemini-2.5-flash", costCents: 0.2 }));
  });

  it("keeps the honesty rule: a reply claiming the change is done is replaced", async () => {
    proposeTripEdits.mockResolvedValue({ reply: "I've added Wigwam to Day 3.", revisedDays: [wigwamDay3], summary: "", meta });
    const { json } = await send("adding Wigwam to Day 3");
    expect(json.message.content).toBe(`I've prepared this change. Nothing is saved until you tap "Save to my trip" below.`);
    expect(json.pendingChange?.type).toBe("apply_draft");
    expect(json.pendingChange?.reason).toBeUndefined();
  });

  it("uses the engine's answer when nothing needs to change", async () => {
    proposeTripEdits.mockResolvedValue({ reply: "Which nights would you like?", revisedDays: [], summary: "", meta });
    const { json } = await send("add nightclubs");
    expect(json.message.content).toBe("Which nights would you like?");
    expect(json.pendingChange).toBeNull();
    expect(chatCalls).not.toHaveBeenCalled();
  });

  it("answers a question with the engine, in the currency the page shows", async () => {
    proposeTripEdits.mockResolvedValue({ reply: "Day 2 comes to about 22 USD.", revisedDays: [], summary: "", meta });
    const { json } = await send("How much is day 2?", true, { display: { currency: "USD", rate: 1.08 } });
    expect(proposeTripEdits).toHaveBeenCalledWith(
      expect.objectContaining({ message: "How much is day 2?", display: { currency: "USD", rate: 1.08 } }),
    );
    expect(chatCalls).not.toHaveBeenCalled();
    expect(json.message.content).toBe("Day 2 comes to about 22 USD.");
  });

  it("makes a change asked as a question, which the chat could only promise", async () => {
    proposeTripEdits.mockResolvedValue({ reply: "Ready: Wigwam on Day 3.", revisedDays: [wigwamDay3], summary: "", meta });
    const { json } = await send("can we fix that?");
    expect(json.pendingChange?.type).toBe("apply_draft");
    expect(chatCalls).not.toHaveBeenCalled();
  });

  it("still answers a question from the chat when the engine fails", async () => {
    proposeTripEdits.mockRejectedValue(new Error("model overloaded"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    chatReply = '{"summary": "It opens at 9:30.", "cards": []}';
    const { json } = await send("What time does the Guinness Storehouse open?");
    expect(chatCalls).toHaveBeenCalledTimes(1);
    expect(json.message.content).toBe("It opens at 9:30.");
  });

  it("falls back to the patterns and the chat when the engine fails", async () => {
    proposeTripEdits.mockRejectedValue(new Error("model overloaded"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, json } = await send("add a museum");
    expect(status).toBe(200);
    expect(chatCalls).toHaveBeenCalledTimes(1);
    expect(json.message.content).toBe("Which day should it go on?");
    expect(json.pendingChange).toBeNull();
  });

  it("writes the days at once when the owner asks for no preview", async () => {
    proposeTripEdits.mockResolvedValue({ reply: "Done: Wigwam on Day 3.", revisedDays: [wigwamDay3], summary: "", meta });
    const { json } = await send("adding Wigwam to Day 3", false);
    const write = calls.find((c) => c.table === "trips" && c.op === "update");
    const days = (write?.value as { itinerary: ItineraryDay[] }).itinerary;
    expect(days.map((d) => d.day_number)).toEqual([1, 2, 3]);
    expect(days[2].activities.map((a) => a.name)).toEqual(["Grafton Street", "Wigwam"]);
    expect(json.modifiedItinerary?.[2].activities.map((a: { name: string }) => a.name)).toEqual(["Grafton Street", "Wigwam"]);
    expect(json.pendingChange).toBeNull();
  });
});
