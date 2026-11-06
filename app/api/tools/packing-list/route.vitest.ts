// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * A free tool anyone can call, and each call pays for Gemini. The real route,
 * limits, list building and call logging run; only Gemini, the Supabase clients
 * and the translations are faked.
 */

const s = vi.hoisted(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  return {
    user: null as { id: string } | null,
    apiConfig: null as Record<string, unknown> | null,
    anonDayOpen: true,
    modelError: null as Error | null,
    calls: 0,
    asked: [] as string[],
    ip: "",
  };
});

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (request: unknown) => {
          s.calls++;
          s.asked.push(JSON.stringify(request));
          if (s.modelError) throw s.modelError;
          return {
            response: {
              text: () => JSON.stringify({ categories: [{ id: "clothing", items: [] }], contextNote: "Pack light." }),
              usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 },
            },
          };
        },
      };
    }
  },
}));
// The limits' counters are real, on their in-memory store: nothing here reaches Redis.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    eval = async () => {
      throw new Error("no Redis in tests");
    };
  },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (id: string) => `label of ${id}`,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}));
vi.mock("@/lib/ai/anon-daily-limit", () => ({ withinAnonDailyLimit: async () => s.anonDayOpen }));
const service = fakeSupabase((q: FakeQuery) =>
  q.table === "api_config" ? { data: s.apiConfig, error: null } : { data: null, error: null }
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { POST } = await import("./route");

const TRIP = { destination: "Tokyo, Japan", startDate: "2027-06-10", endDate: "2027-06-17", travelStyle: "city" };

const ask = (body: unknown = TRIP) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/tools/packing-list", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": s.ip },
      body: JSON.stringify(body),
    })
  );
const askTimes = async (times: number) => {
  const answers: number[] = [];
  for (let i = 0; i < times; i++) answers.push((await ask()).status);
  return answers;
};
const logged = () => service.log.filter((q) => q.table === "api_request_logs").map((q) => q.value as Record<string, unknown>);

let run = 0;

beforeEach(() => {
  run++;
  s.ip = `10.0.0.${run}`;
  s.user = null;
  s.apiConfig = null;
  s.anonDayOpen = true;
  s.modelError = null;
  s.calls = 0;
  s.asked = [];
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a list", () => {
  it("answers it with its labels, and logs what the call cost", async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect((await res.json()).list.categories[0].label).toBe("label of clothing");
    expect(s.calls).toBe(1);
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ api_name: "gemini", endpoint: "/api/tools/packing-list", response_status: 200 });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });
});

describe("what goes to the model", () => {
  it("is at most 12 activities of 60 characters each", async () => {
    await ask({ ...TRIP, activities: Array.from({ length: 20 }, (_, i) => `${"x".repeat(5_000)}${i}`) });
    expect(s.asked[0].match(/x{2,}/)?.[0].length).toBe(60);
    expect(s.asked[0].match(/x{60}/g)).toHaveLength(12);
  });
});

describe("limits on who calls it", () => {
  it("gives a network 10 lists an hour signed out, and another network its own", async () => {
    const answers = await askTimes(11);
    expect(answers.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(answers[10]).toBe(429);
    expect(s.calls).toBe(10);

    s.ip = `10.1.0.${run}`;
    expect((await ask()).status).toBe(200);
  });

  it("gives an account 40 lists an hour, wherever it calls from", async () => {
    s.user = { id: `account-${run}` };
    const answers = await askTimes(40);
    expect(answers.every((status) => status === 200)).toBe(true);

    s.ip = `10.2.0.${run}`;
    expect((await ask()).status).toBe(429);
    expect(s.calls).toBe(40);
  });

  it("refuses someone signed out past today's limit on free AI calls, without calling the model", async () => {
    s.anonDayOpen = false;
    const res = await ask();
    expect(res.status).toBe(429);
    expect(s.calls).toBe(0);
  });

  it("doesn't hold an account to that limit", async () => {
    s.anonDayOpen = false;
    s.user = { id: `account-${run}` };
    expect((await ask()).status).toBe(200);
  });
});

describe("Gemini's switch", () => {
  it("makes no paid call while the kill switch is off, and logs the refusal at no cost", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    expect((await ask()).status).toBe(503);
    expect(s.calls).toBe(0);
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ endpoint: "/api/tools/packing-list", response_status: 503, cost_usd: 0 });
    expect(String(logged()[0].error_message)).toContain("BLOCKED");
  });

  it("makes no paid call past the daily limit", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 1 };
    expect((await ask()).status).toBe(200);
    expect((await ask()).status).toBe(503);
    expect(s.calls).toBe(1);
  });
});

describe("what it refuses before asking anything", () => {
  it.each<[string, unknown]>([
    ["no destination", { ...TRIP, destination: "" }],
    ["a date that isn't one", { ...TRIP, startDate: "soon" }],
    ["an end before the start", { ...TRIP, endDate: "2027-06-01" }],
    ["more than 30 days", { ...TRIP, endDate: "2027-08-01" }],
    ["an unknown style", { ...TRIP, travelStyle: "moon" }],
    ["an unknown language", { ...TRIP, locale: "xx" }],
  ])("%s", async (_name, body) => {
    expect((await ask(body)).status).toBe(400);
    expect(s.calls).toBe(0);
    expect(logged()).toEqual([]);
  });
});

describe("when the model doesn't deliver", () => {
  it("answers 503 and logs the failure", async () => {
    s.modelError = new Error("503 model overloaded");
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBeUndefined();
    expect(logged()[0]).toMatchObject({ response_status: 503, error_message: "503 model overloaded" });
  });

  it("says the model is out of service when its credit is used up", async () => {
    s.modelError = new Error('Failed: {"error":{"code":402,"message":"Your prepayment credits are depleted"}}');
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("MODEL_OUTAGE");
  });
});
