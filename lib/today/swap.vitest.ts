// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The swap chip asks the model for a nearby place, for anyone on a live trip,
 * guests with a share link included. It is the one chip that spends, so it asks
 * Gemini's switch first and logs its call. The real write, suggestion and logging
 * run; only Gemini and the Supabase client are faked.
 */

const s = vi.hoisted(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  return {
    apiConfig: null as Record<string, unknown> | null,
    anonDayOpen: true,
    reply: "",
    modelError: null as Error | null,
    calls: 0,
    asked: [] as string[],
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (prompt: string) => {
          s.calls++;
          s.asked.push(prompt);
          if (s.modelError) throw s.modelError;
          return { response: { text: () => s.reply, usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 } } };
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
vi.mock("@/lib/ai/anon-daily-limit", () => ({ withinAnonDailyLimit: async () => s.anonDayOpen }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: () => {} }));
const service = fakeSupabase((q: FakeQuery) => {
  if (q.table === "api_config") return { data: s.apiConfig, error: null };
  if (q.table === "users") return { data: { display_name: "Luca" }, error: null };
  return { data: null, error: null };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { writeTodayAction } = await import("./write");

const TRIP = { id: "trip-1", user_id: "owner-1", trip_meta: { destination: "Lisbon", locale: "en" } };
const OWNER = { user: { id: "owner-1" }, cookieId: null };
const GUEST = { user: null, cookieId: "guest-cookie" };
const SWAP = { action_type: "swap", day_number: 1, activity_id: "a1", activity: { name: "Museu do Fado", type: "museum" } };

const tap = (requester: typeof OWNER | typeof GUEST = OWNER, body: Record<string, unknown> = SWAP) =>
  writeTodayAction(service.client as unknown as SupabaseClient, TRIP, requester, body);
const stored = () => service.log.filter((q) => q.table === "trip_today_actions" && q.op === "insert").map((q) => q.value as Record<string, unknown>);
const logged = () => service.log.filter((q) => q.table === "api_request_logs").map((q) => q.value as Record<string, unknown>);

beforeEach(() => {
  s.apiConfig = null;
  s.anonDayOpen = true;
  s.reply = JSON.stringify({ name: "Museu do Azulejo", why: "Same kind of place, ten minutes away" });
  s.modelError = null;
  s.calls = 0;
  s.asked = [];
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a swap", () => {
  it("stores the suggestion, and logs what the call cost and for whom", async () => {
    expect(await tap()).toBeNull();
    expect(s.calls).toBe(1);
    expect(stored()).toHaveLength(1);
    expect(stored()[0].payload).toEqual({ swap_to: { name: "Museu do Azulejo", why: "Same kind of place, ten minutes away" } });
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ api_name: "gemini", endpoint: "/api/today-action/swap", response_status: 200, user_id: "owner-1" });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });

  it("sends the model at most 200 characters of anything the page supplies", async () => {
    const long = (letter: string) => letter.repeat(5_000);
    await tap(OWNER, { ...SWAP, destination: long("Q"), activity: { name: long("W"), type: long("X"), location: long("Z") } });
    for (const letter of ["Q", "W", "X", "Z"]) {
      expect(s.asked[0].match(new RegExp(`${letter}{2,}`))?.[0].length).toBe(200);
    }
  });

  it("logs the failure and stores nothing when the model has no suggestion", async () => {
    s.modelError = new Error("503 model overloaded");
    expect((await tap())?.status).toBe(500);
    expect(stored()).toEqual([]);
    expect(logged()[0]).toMatchObject({ response_status: 503, cost_usd: 0 });
  });
});

describe("Gemini's switch", () => {
  it("makes no paid call and stores nothing while the kill switch is off, and logs the refusal", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    expect((await tap())?.status).toBe(503);
    expect(s.calls).toBe(0);
    expect(stored()).toEqual([]);
    expect(logged()).toHaveLength(1);
    expect(String(logged()[0].error_message)).toContain("BLOCKED");
  });

  it("makes no paid call past the daily limit", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 1 };
    expect(await tap()).toBeNull();
    expect((await tap())?.status).toBe(503);
    expect(s.calls).toBe(1);
  });
});

describe("today's limit on free AI calls", () => {
  it("stops a guest", async () => {
    s.anonDayOpen = false;
    expect((await tap(GUEST))?.status).toBe(429);
    expect(s.calls).toBe(0);
    expect(stored()).toEqual([]);
  });

  it("doesn't stop someone signed in", async () => {
    s.anonDayOpen = false;
    expect(await tap(OWNER)).toBeNull();
    expect(s.calls).toBe(1);
  });
});

describe("the chips that need no model", () => {
  it.each(["skip", "running_late"])("%s asks nothing and logs no call, even with the switch off", async (action_type) => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    expect(await tap(OWNER, { action_type, day_number: 1, activity_id: "a1" })).toBeNull();
    expect(s.calls).toBe(0);
    expect(service.log.filter((q) => q.table === "api_config")).toEqual([]);
    expect(logged()).toEqual([]);
    expect(stored()).toHaveLength(1);
  });
});
