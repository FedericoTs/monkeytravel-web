// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getModelForPurpose } from "@/lib/ai/model-router";

/**
 * What the concierge checks before it answers, what it tells the model, and what it
 * leaves behind, through the real route with Gemini, auth and Supabase faked. Its
 * proposals are in route.vitest.ts.
 */

type Turn = { role: string; parts: { text: string }[] };
const gemini = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  streams: [] as { contents: Turn[] }[],
  calls: [] as { contents: Turn[] }[],
  reply: "",
  streamError: null as Error | null,
  midStreamError: null as Error | null,
  usageError: null as Error | null,
  followUp: "NONE",
}));

vi.mock("@/lib/ai/genai-compat", async (original) => ({
  ...(await original<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel(config: Record<string, unknown>) {
      gemini.configs.push(config);
      return {
        generateContentStream: async (req: { contents: Turn[] }) => {
          gemini.streams.push(req);
          if (gemini.streamError) throw gemini.streamError;
          const text = gemini.reply;
          return {
            stream: (async function* () {
              for (let i = 0; i < text.length; i += 9) {
                const piece = text.slice(i, i + 9);
                yield { text: () => piece };
                if (gemini.midStreamError) throw gemini.midStreamError;
              }
            })(),
            response: gemini.usageError ? Promise.reject(gemini.usageError) : Promise.resolve({ usageMetadata: { promptTokenCount: 10 } }),
          };
        },
        generateContent: async (req: { contents: Turn[] }) => {
          gemini.calls.push(req);
          return { response: { text: () => gemini.followUp, usageMetadata: { promptTokenCount: 5 } } };
        },
      };
    }
  },
}));
vi.mock("@/lib/ai/cache-metrics", () => ({ logCacheMetrics: vi.fn() }));
vi.mock("@/lib/ai/gemini-cost", () => ({ geminiCostUsd: () => 0.01 }));

const guards = vi.hoisted(() => ({
  access: { allowed: true } as { allowed: boolean; message?: string },
  usage: { allowed: true } as { allowed: boolean; message?: string },
  logApiCall: vi.fn(async () => {}),
  incrementUsage: vi.fn(async () => {}),
  recordAiOutcome: vi.fn(async () => {}),
  checkUsageLimit: vi.fn(),
}));
vi.mock("@/lib/api-gateway", () => ({ checkApiAccess: async () => guards.access, logApiCall: guards.logApiCall }));
vi.mock("@/lib/usage-limits", () => ({ checkUsageLimit: guards.checkUsageLimit, incrementUsage: guards.incrementUsage }));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: guards.recordAiOutcome }));

const activity = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  type: "attraction",
  time_slot: "morning",
  start_time: "09:00",
  duration_minutes: 60,
  location: "Old town",
  image_url: "https://example.com/photo.jpg",
  ...extra,
});
const baseTrip = () => ({
  id: "trip-1",
  title: "Porto trip",
  start_date: "2027-05-10",
  end_date: "2027-05-12",
  trip_meta: { destination: "Porto, Portugal" },
  budget: { currency: "EUR" },
  itinerary: [
    { day_number: 1, date: "2027-05-10", activities: [activity("a1", "Cathedral", { locked: true })] },
    { day_number: 2, date: "2027-05-11", activities: [activity("b1", "Bridge"), activity("b2", "Lunch")] },
  ] as unknown,
});

const db = vi.hoisted(() => ({
  user: { id: "user-1", email: "owner@example.com" },
  authRefused: false,
  throwOnAuth: false,
  trip: null as Record<string, unknown> | null,
  tripError: null as { message: string } | null,
  tripReads: 0,
  timelineFilters: [] as [string, unknown][],
  timeline: [] as { activity_id: string; status: string }[],
  timelineThrows: false,
  history: [] as unknown[],
  historyThrows: false,
  inserted: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  insertThrows: false,
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => {
    if (db.throwOnAuth) throw new Error("auth down");
    if (db.authRefused) {
      return { user: null, supabase: null, errorResponse: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) };
    }
    return {
      user: db.user,
      errorResponse: null,
      supabase: {
        from(table: string) {
          const chain: Record<string, unknown> = {};
          chain.select = () => chain;
          if (table === "activity_timelines") {
            const filters: [string, unknown][] = [];
            chain.eq = (column: string, value: unknown) => {
              filters.push([column, value]);
              if (filters.length === 2) {
                db.timelineFilters.push(...filters);
                if (db.timelineThrows) throw new Error("timeline down");
                return Promise.resolve({ data: db.timeline, error: null });
              }
              return chain;
            };
            return chain;
          }
          chain.eq = () => chain;
          chain.maybeSingle = async () => {
            db.tripReads += 1;
            return { data: db.tripError ? null : db.trip, error: db.tripError };
          };
          return chain;
        },
      },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from() {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "order", "eq"]) chain[m] = () => chain;
      chain.limit = async () => {
        if (db.historyThrows) throw new Error("history down");
        return { data: db.history, error: null };
      };
      chain.insert = async (row: Record<string, unknown>) => {
        if (db.insertThrows) throw new Error("insert down");
        db.inserted.push(row);
        return { error: db.insertError };
      };
      return chain;
    },
  }),
}));

const { POST } = await import("./route");

// A new trip id per test, so the route's in-process trip memo starts empty.
let tripId = "";
let tripNumber = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/ai/concierge", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const events = async (res: Response) =>
  (await res.text())
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => JSON.parse(frame.slice(5)) as Record<string, unknown>);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const ask = async (extra: Record<string, unknown> = {}) => {
  const res = await post({ tripId, question: "what is on today?", ...extra });
  const frames = await events(res);
  await settled();
  return { res, frames };
};
const lastTurn = () => gemini.streams.at(-1)!.contents.at(-1)!.parts[0].text;
const contextSent = () => JSON.parse(lastTurn().split("TRIP CONTEXT (JSON):\n")[1].split("\n\nUSER QUESTION:")[0]);

beforeEach(() => {
  vi.stubEnv("GOOGLE_AI_API_KEY", "test-key");
  tripId = `trip-${++tripNumber}`;
  gemini.configs.length = 0;
  gemini.streams.length = 0;
  gemini.calls.length = 0;
  gemini.reply = "Here is the plan.";
  gemini.streamError = null;
  gemini.midStreamError = null;
  gemini.usageError = null;
  gemini.followUp = "NONE";
  guards.access = { allowed: true };
  guards.usage = { allowed: true };
  guards.checkUsageLimit.mockImplementation(async () => guards.usage);
  guards.incrementUsage.mockImplementation(async () => {});
  db.user = { id: "user-1", email: "owner@example.com" };
  db.authRefused = false;
  db.throwOnAuth = false;
  db.trip = baseTrip();
  db.tripError = null;
  db.tripReads = 0;
  db.timelineFilters.length = 0;
  db.timeline = [];
  db.timelineThrows = false;
  db.history = [];
  db.historyThrows = false;
  db.inserted.length = 0;
  db.insertError = null;
  db.insertThrows = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  guards.logApiCall.mockClear();
  guards.incrementUsage.mockClear();
  guards.recordAiOutcome.mockClear();
  guards.checkUsageLimit.mockClear();
});

describe("before it answers", () => {
  it("passes on the refusal of someone signed out, and asks no model", async () => {
    db.authRefused = true;
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(401);
    expect(gemini.streams).toHaveLength(0);
  });

  it("stops when the AI budget is closed, in the gateway's words", async () => {
    guards.access = { allowed: false, message: "Budget closed" };
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Budget closed");
    expect(gemini.streams).toHaveLength(0);
  });

  it("has words of its own when the gateway gives none", async () => {
    guards.access = { allowed: false };
    const res = await post({ tripId, question: "hi" });
    expect((await res.json()).error).toBe("AI is currently unavailable");
  });

  it("refuses a body that isn't JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it.each([
    ["no trip", { question: "hi" }, "tripId is required"],
    ["a trip that isn't text", { tripId: 7, question: "hi" }, "tripId is required"],
    ["no question", { tripId: "x" }, "question is required"],
    ["a blank question", { tripId: "x", question: "   " }, "question is required"],
    ["a question that isn't text", { tripId: "x", question: 7 }, "question is required"],
    ["a question too long", { tripId: "x", question: "q".repeat(801) }, "question too long (max 800 chars)"],
  ])("refuses %s", async (_name, body, message) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
    expect(guards.checkUsageLimit).not.toHaveBeenCalled();
  });

  it("takes a question of exactly the limit, trimmed first", async () => {
    await ask({ question: `  ${"q".repeat(800)}  ` });
    expect(gemini.streams).toHaveLength(1);
    expect(lastTurn()).toContain(`USER QUESTION:\n${"q".repeat(800)}`);
    expect(lastTurn()).not.toContain(`USER QUESTION:\n `);
  });

  it("counts against the assistant's daily limit, for this user", async () => {
    await ask();
    expect(guards.checkUsageLimit).toHaveBeenCalledWith("user-1", "aiAssistantMessages", "owner@example.com");
  });

  it("stops at the daily limit, in the limit's words, with its code", async () => {
    guards.usage = { allowed: false, message: "Twenty a day" };
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Twenty a day", code: "USAGE_LIMIT_REACHED" });
    expect(db.tripReads).toBe(0);
    expect(guards.incrementUsage).not.toHaveBeenCalled();
  });

  it("has words of its own at the limit", async () => {
    guards.usage = { allowed: false };
    const res = await post({ tripId, question: "hi" });
    expect((await res.json()).error).toBe("Daily AI limit reached. Try again tomorrow or upgrade.");
  });

  it("says so when the trip can't be read", async () => {
    db.tripError = { message: "boom" };
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to load trip context");
    expect(gemini.streams).toHaveLength(0);
  });

  it("doesn't find a trip this user can't see", async () => {
    db.trip = null;
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Trip not found or you don't have access to it");
    expect(guards.incrementUsage).not.toHaveBeenCalled();
  });

  it("stops when no model is configured, and charges nothing", async () => {
    vi.stubEnv("GOOGLE_AI_API_KEY", "");
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("AI not configured");
    expect(guards.incrementUsage).not.toHaveBeenCalled();
  });

  it("answers an unexpected failure with its own words, and reports it", async () => {
    db.throwOnAuth = true;
    const res = await post({ tripId, question: "hi" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Concierge failed");
    expect(guards.recordAiOutcome).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "assistant", outcome: "failure", metadata: { subroute: "concierge" } }));
  });
});

describe("the trip it reads", () => {
  it("is read once for follow-ups at the same version", async () => {
    await ask({ itineraryVersion: 3 });
    await ask({ itineraryVersion: 3 });
    expect(db.tripReads).toBe(1);
    expect(gemini.streams).toHaveLength(2);
  });

  it("is read again after an applied edit moves the version on", async () => {
    await ask({ itineraryVersion: 3 });
    await ask({ itineraryVersion: 4 });
    expect(db.tripReads).toBe(2);
  });

  it("treats a version that isn't a whole, positive number as 0 or its floor", async () => {
    await ask({ itineraryVersion: "7" });
    await ask({ itineraryVersion: -2 });
    await ask({ itineraryVersion: 0.5 });
    expect(db.tripReads).toBe(1);
  });

  it("is read again after a minute", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    await ask();
    now.mockReturnValue(1_000_000 + 60_000);
    await ask();
    expect(db.tripReads).toBe(1);
    now.mockReturnValue(1_000_000 + 60_001);
    await ask();
    expect(db.tripReads).toBe(2);
  });

  it("is never served to another user from the memo", async () => {
    await ask();
    db.user = { id: "user-2", email: "mate@example.com" };
    await ask();
    expect(db.tripReads).toBe(2);
  });

  it("copes with an itinerary that isn't a list", async () => {
    db.trip = { ...baseTrip(), itinerary: { oops: true } };
    await ask();
    expect(contextSent()).toMatchObject({ total_days: 0, itinerary: [] });
  });

  it("copes with one on a day of the trip too", async () => {
    db.trip = { ...baseTrip(), itinerary: { oops: true } };
    const { res, frames } = await ask({ clientToday: "2027-05-11" });
    expect(res.status).toBe(200);
    expect(contextSent().today.day_number).toBe(2);
    expect(frames.at(-1)).toEqual({ type: "done", isLiveTrip: true, dayNumber: 2 });
  });
});

describe("what it tells the model", () => {
  it("uses the concierge's model, warm but factual, with room for the answer", async () => {
    await ask();
    expect(gemini.configs[0]).toMatchObject({
      model: getModelForPurpose("concierge"),
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
    });
  });

  it("opens with the rules, which forbid claiming a change was made", async () => {
    await ask();
    const [rules, understood] = gemini.streams[0].contents;
    expect(rules.role).toBe("user");
    expect(rules.parts[0].text).toContain("NEVER claim a change has already been made");
    expect(rules.parts[0].text).toContain("<<<PROPOSAL>>>");
    expect(understood.role).toBe("model");
  });

  it("replays the last turns as real turns, oldest first, then the trip and the question", async () => {
    db.history = [
      { messages: [{ role: "user", content: "second?" }, { role: "assistant", content: "second." }] },
      { messages: [{ role: "user", content: "first?" }, { role: "assistant", content: "first." }] },
    ];
    await ask({ question: "and now?" });
    const turns = gemini.streams[0].contents.slice(2);
    expect(turns.slice(0, 4).map((t) => [t.role, t.parts[0].text])).toEqual([
      ["user", "first?"],
      ["model", "first."],
      ["user", "second?"],
      ["model", "second."],
    ]);
    expect(turns.at(-1)!.role).toBe("user");
    expect(turns.at(-1)!.parts[0].text).toMatch(/^TRIP CONTEXT \(JSON\):\n[\s\S]*\n\nUSER QUESTION:\nand now\?/);
  });

  it("leaves out a stored turn missing its question or answer", async () => {
    db.history = [
      { messages: [{ role: "user", content: "only a question" }] },
      { messages: null },
      { messages: [{ role: "user", content: "whole?" }, { role: "assistant", content: "whole." }] },
    ];
    await ask();
    const texts = gemini.streams[0].contents.map((t) => t.parts[0].text);
    expect(texts).toContain("whole?");
    expect(texts).not.toContain("only a question");
  });

  it("answers without memory when the memory can't be read", async () => {
    db.historyThrows = true;
    const { frames } = await ask();
    expect(frames.at(-1)).toMatchObject({ type: "done" });
    expect(gemini.streams[0].contents).toHaveLength(3);
  });

  it("sends what the plan needs and no more", async () => {
    await ask();
    const context = contextSent();
    expect(context).toMatchObject({
      title: "Porto trip",
      destination: "Porto, Portugal",
      start_date: "2027-05-10",
      end_date: "2027-05-12",
      total_days: 2,
    });
    const first = context.itinerary[0].activities[0];
    expect(first).toEqual({
      id: "a1",
      time_slot: "morning",
      start_time: "09:00",
      name: "Cathedral",
      type: "attraction",
      location: "Old town",
      duration_minutes: 60,
      locked: true,
    });
    expect(context.itinerary[1].activities[0].locked).toBeUndefined();
    expect(lastTurn()).not.toContain("photo.jpg");
  });

  it("falls back to an activity's address for where it is", async () => {
    db.trip = {
      ...baseTrip(),
      itinerary: [{ day_number: 1, date: "2027-05-10", activities: [activity("a1", "Cathedral", { location: "", address: "Rua 1" })] }],
    };
    await ask();
    expect(contextSent().itinerary[0].activities[0].location).toBe("Rua 1");
  });
});

describe("today", () => {
  it("is named when the traveller's own date falls inside the trip, with what's done", async () => {
    db.timeline = [{ activity_id: "b1", status: "completed" }];
    const { frames } = await ask({ clientToday: "2027-05-11" });
    expect(db.timelineFilters).toEqual([["trip_id", tripId], ["day_number", 2]]);
    const today = contextSent().today;
    expect(today.day_number).toBe(2);
    expect(today.activities.map((a: { id: string; status?: string }) => [a.id, a.status])).toEqual([["b1", "completed"], ["b2", undefined]]);
    expect(frames.at(-1)).toEqual({ type: "done", isLiveTrip: true, dayNumber: 2 });
  });

  it("works on the trip's first and last days", async () => {
    await ask({ clientToday: "2027-05-10" });
    expect(contextSent().today.day_number).toBe(1);
    await ask({ clientToday: "2027-05-12" });
    expect(contextSent().today.day_number).toBe(3);
  });

  it("has no activities on a day the plan doesn't reach", async () => {
    await ask({ clientToday: "2027-05-12" });
    expect(contextSent().today).toEqual({ day_number: 3, activities: [] });
  });

  it.each([
    ["before the trip", "2027-05-09"],
    ["after the trip", "2027-05-13"],
  ])("isn't named %s, and nothing about today is read", async (_name, clientToday) => {
    const { frames } = await ask({ clientToday });
    expect(contextSent().today).toBeUndefined();
    expect(db.timelineFilters).toEqual([]);
    expect(frames.at(-1)).toEqual({ type: "done", isLiveTrip: false, dayNumber: null });
  });

  it("falls back to the server's date when the traveller's isn't a date", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2027-05-11T12:00:00Z") });
    try {
      await ask({ clientToday: "tomorrow" });
      expect(contextSent().today.day_number).toBe(2);
      await ask({ clientToday: 20270511 });
      expect(contextSent().today.day_number).toBe(2);
      await ask();
      expect(contextSent().today.day_number).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers without progress when it can't be read", async () => {
    db.timelineThrows = true;
    const { frames } = await ask({ clientToday: "2027-05-11" });
    expect(frames.at(-1)).toMatchObject({ type: "done" });
    expect(contextSent().today.activities[0].status).toBeUndefined();
  });
});

describe("the answer", () => {
  it("is an event stream the edge won't buffer", async () => {
    const { res } = await ask();
    expect(res.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  it("arrives in pieces, whole, and ends with done", async () => {
    const { frames } = await ask();
    const chunks = frames.filter((f) => f.type === "chunk");
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((f) => f.text).join("")).toBe("Here is the plan.");
    expect(frames.at(-1)?.type).toBe("done");
  });

  it("never shows the machine-readable proposal, even split across pieces", async () => {
    gemini.reply = `Drop the bridge. <<<PROPOSAL>>>${JSON.stringify({ type: "remove", dayNumber: 2, targetActivityId: "b1" })}`;
    const { frames } = await ask({ question: "drop the bridge" });
    const said = frames.filter((f) => f.type === "chunk").map((f) => f.text).join("");
    expect(said.trim()).toBe("Drop the bridge.");
    expect(said).not.toContain("<<<");
    expect(frames.find((f) => f.type === "proposal")).toMatchObject({ proposal: { type: "remove", dayNumber: 2 } });
  });

  it("keeps an ending that only looks like the start of a proposal", async () => {
    gemini.reply = "Turn left at the sign <";
    const { frames } = await ask();
    expect(frames.filter((f) => f.type === "chunk").map((f) => f.text).join("")).toBe("Turn left at the sign <");
  });

  it.each([
    ["the trip's currency", { currency: "EUR" }, "EUR"],
    ["dollars when the trip has none", null, "USD"],
  ])("prices a proposed activity in %s", async (_name, budget, currency) => {
    db.trip = { ...baseTrip(), budget };
    gemini.reply = `Add a boat tour. <<<PROPOSAL>>>${JSON.stringify({ type: "add", dayNumber: 2, newActivity: { name: "Boat tour", estimated_cost: { amount: 20 } } })}`;
    const { frames } = await ask({ question: "add a boat tour" });
    expect(frames.find((f) => f.type === "proposal")).toMatchObject({
      proposal: { type: "add", newActivity: { name: "Boat tour", estimated_cost: { amount: 20, currency } } },
    });
  });

  it("is charged once, before it streams", async () => {
    await ask();
    expect(guards.incrementUsage).toHaveBeenCalledExactlyOnceWith("user-1", "aiAssistantMessages");
  });

  it("still arrives when the charge fails", async () => {
    guards.incrementUsage.mockImplementation(async () => Promise.reject(new Error("usage down")));
    const { frames } = await ask();
    expect(frames.at(-1)?.type).toBe("done");
    expect(console.error).toHaveBeenCalledWith("[concierge] usage increment failed", expect.any(Error));
  });

  it("is logged with what it cost, and who asked", async () => {
    await ask({ clientToday: "2027-05-11" });
    expect(guards.logApiCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        apiName: "gemini",
        endpoint: "/api/ai/concierge",
        status: 200,
        cacheHit: false,
        costUsd: 0.01,
        exactCost: true,
        metadata: { user_id: "user-1", trip_id: tripId, is_live_trip: true },
      })
    );
    expect(guards.recordAiOutcome).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        endpoint: "assistant",
        outcome: "success",
        model: getModelForPurpose("concierge"),
        userId: "user-1",
        metadata: { subroute: "concierge", is_live_trip: true },
      })
    );
  });

  it("adds what asking once more for a proposal cost", async () => {
    gemini.reply = "Sure, I can remove the bridge from Day 2.";
    await ask({ question: "drop the bridge" });
    expect(gemini.calls).toHaveLength(1);
    expect(guards.logApiCall).toHaveBeenCalledWith(expect.objectContaining({ costUsd: 0.02 }));
  });

  it("survives the usage figures not arriving", async () => {
    gemini.usageError = new Error("no usage");
    const { frames } = await ask();
    expect(frames.at(-1)?.type).toBe("done");
    expect(guards.logApiCall).toHaveBeenCalledWith(expect.objectContaining({ status: 200, costUsd: 0 }));
  });

  it("is stored with the question, as a turn of this surface", async () => {
    await ask({ question: "what is on?", clientToday: "2027-05-11" });
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      user_id: "user-1",
      trip_id: tripId,
      messages: [
        { role: "user", content: "what is on?" },
        { role: "assistant", content: "Here is the plan.", model: getModelForPurpose("concierge") },
      ],
      context: { surface: "concierge_f4", is_live_trip: true, day_number: 2 },
    });
    expect(db.inserted[0].context).not.toHaveProperty("proposal_type");
  });

  it.each([
    ["answers with an error", () => (db.insertError = { message: "nope" })],
    ["throws", () => (db.insertThrows = true)],
  ])("still arrives when storing it %s", async (_name, arrange) => {
    arrange();
    const { frames } = await ask();
    expect(frames.at(-1)?.type).toBe("done");
    expect(console.error).toHaveBeenCalled();
  });
});

describe("when the model fails", () => {
  it.each([
    ["before anything arrives", () => (gemini.streamError = new Error("402 prepayment"))],
    ["part way through", () => (gemini.midStreamError = new Error("connection lost"))],
  ])("%s it sends an error with no words of the model's, and reports it", async (_name, arrange) => {
    arrange();
    const { frames } = await ask();
    expect(frames.at(-1)).toEqual({ type: "error" });
    expect(guards.recordAiOutcome).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        endpoint: "assistant",
        outcome: "failure",
        model: getModelForPurpose("concierge"),
        error: expect.any(Error),
        userId: "user-1",
        metadata: { subroute: "concierge" },
      })
    );
    expect(guards.logApiCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ apiName: "gemini", endpoint: "/api/ai/concierge", status: 500, costUsd: 0, error: expect.stringMatching(/402 prepayment|connection lost/) })
    );
    expect(db.inserted).toHaveLength(0);
  });
});
