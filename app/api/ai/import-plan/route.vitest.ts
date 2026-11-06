// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Pasting a plan spends one Gemini call. Everything that can refuse has to come
 * before that call, and what the model answers isn't trusted. The real route,
 * extraction, normalization, anonymous quota and call logging run; only Gemini,
 * the Supabase clients, cookies and error reporting are faked.
 */

const QUOTA_COOKIE = "mt_anon_extract";
const SIGNED_IN = { id: "user-1", email: "person@mail.example.com" };

const s = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  sessionError: null as Error | null,
  cookies: new Map<string, string>(),
  reply: "",
  modelError: null as Error | null,
  /** The text of what each model call was asked. */
  asked: [] as string[],
  apiConfig: null as Record<string, unknown> | null,
  outcomes: [] as unknown[],
}));

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async (request: { contents: Array<{ parts: Array<{ text: string }> }> }) => {
          s.asked.push(request.contents.at(-1)?.parts[0].text ?? "");
          if (s.modelError) throw s.modelError;
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
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (s.cookies.has(name) ? { value: s.cookies.get(name) } : undefined),
    set: ({ name, value }: { name: string; value: string }) => void s.cookies.set(name, value),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (s.sessionError) throw s.sessionError;
    return { auth: { getUser: async () => ({ data: { user: s.user } }) } };
  },
}));
const service = fakeSupabase((q: FakeQuery) =>
  q.table === "api_config" ? { data: s.apiConfig, error: null } : { data: null, error: null }
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));
vi.mock("@/lib/ai/observability", () => ({
  recordAiOutcome: async (outcome: unknown) => void s.outcomes.push(outcome),
}));

const { POST } = await import("./route");

const PLAN = {
  text: "Day 1: land in Venice at 09:40. Day 3: wedding in Trieste. Would love to see the Uffizi.",
  startDate: "2027-05-10",
  endDate: "2027-05-14",
  destination: "Venice, Italy",
};
const READ_BY_MODEL = JSON.stringify({
  items: [
    { date: "Day 1", title: "Land in Venice", type: "transport", location: "Venice", time: "09:40" },
    { date: "2027-05-12", title: "Wedding", type: "event", location: "Trieste", time: "" },
    { date: "2031-01-01", title: "A date outside the trip", type: "event" },
  ],
  undated: ["Uffizi at some point"],
});
const NOTHING_READ = JSON.stringify({ items: [], undated: [] });
const BAD_DATES = "startDate and endDate must be valid ISO dates (YYYY-MM-DD)";

const paste = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/import-plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
const quotaUsed = () => {
  const raw = s.cookies.get(QUOTA_COOKIE);
  return raw ? (JSON.parse(raw) as { used: number }).used : 0;
};
const useUpQuota = () => s.cookies.set(QUOTA_COOKIE, JSON.stringify({ used: 10, resetAt: Date.now() + 3_600_000 }));
const logged = () => service.log.filter((q) => q.table === "api_request_logs").map((q) => q.value as Record<string, unknown>);

beforeEach(() => {
  s.user = null;
  s.sessionError = null;
  s.cookies.clear();
  s.reply = READ_BY_MODEL;
  s.modelError = null;
  s.asked = [];
  s.apiConfig = null;
  s.outcomes = [];
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a plan the model can read", () => {
  it("answers anchors on the trip's dates, drops what the model made up, and logs what the one call cost", async () => {
    s.user = SIGNED_IN;
    const res = await paste(PLAN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchors.map((a: { date: string; title: string }) => [a.date, a.title])).toEqual([
      ["2027-05-10", "Land in Venice"],
      ["2027-05-12", "Wedding"],
    ]);
    expect(body.dropped).toEqual([{ title: "A date outside the trip", reason: "date_out_of_range" }]);
    expect(body.undated).toEqual(["Uffizi at some point"]);
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]).toContain(PLAN.text);
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ api_name: "gemini", response_status: 200 });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });
});

describe("the anonymous budget", () => {
  it("counts one use for an anonymous import that worked", async () => {
    expect((await paste(PLAN)).status).toBe(200);
    expect(quotaUsed()).toBe(1);
  });

  it("refuses an anonymous caller past the budget before reading the body or calling the model", async () => {
    useUpQuota();
    const res = await paste("{not json");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "RATE_LIMIT", signupUrl: "/auth/signup" });
    expect(s.asked).toEqual([]);
    expect(logged()).toEqual([]);
  });

  it("doesn't hold a signed-in caller to the anonymous cookie, or count against it", async () => {
    useUpQuota();
    s.user = SIGNED_IN;
    expect((await paste(PLAN)).status).toBe(200);
    expect(quotaUsed()).toBe(10);
  });

  it.skip("counts an anonymous import the model found nothing in, since that call was paid for", async () => {
    s.reply = NOTHING_READ;
    await paste(PLAN);
    expect(quotaUsed()).toBe(1);
  });

  it.skip("stops an anonymous caller who drops the cookie before every request", async () => {
    const answers = [];
    for (let i = 0; i < 400; i++) {
      s.cookies.clear();
      answers.push((await paste(PLAN)).status);
    }
    expect(answers).toContain(429);
    expect(s.asked.length).toBeLessThan(400);
  });
});

describe("limits on anyone calling it", () => {
  it.skip("makes no paid call while Gemini's kill switch is off", async () => {
    s.user = SIGNED_IN;
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    expect((await paste(PLAN)).status).toBe(503);
    expect(s.asked).toEqual([]);
  });

  it.skip("makes no paid call past Gemini's daily limit", async () => {
    s.user = SIGNED_IN;
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 1 };
    await paste(PLAN);
    expect((await paste(PLAN)).status).toBe(503);
    expect(s.asked).toHaveLength(1);
  });

  it.skip("stops a signed-in caller who keeps importing", async () => {
    s.user = SIGNED_IN;
    const answers = [];
    for (let i = 0; i < 400; i++) answers.push((await paste(PLAN)).status);
    expect(answers).toContain(429);
    expect(s.asked.length).toBeLessThan(400);
  });
});

describe("what it refuses before paying for a call", () => {
  it.each<[string, unknown, string]>([
    ["a body that isn't JSON", "{not json", "Invalid JSON body"],
    ["blank text", { ...PLAN, text: " \n " }, "text is required"],
    ["a date that isn't a date", { ...PLAN, endDate: "next week" }, BAD_DATES],
    ["a day the calendar doesn't have", { ...PLAN, endDate: "2027-02-30" }, BAD_DATES],
    ["an end before the start", { ...PLAN, endDate: "2027-05-09" }, "endDate must not be before startDate"],
  ])("%s", async (_name, body, error) => {
    const res = await paste(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(error);
    expect(s.asked).toEqual([]);
    expect(quotaUsed()).toBe(0);
  });

  it("takes a trip of 30 days and refuses one of 31", async () => {
    expect((await paste({ ...PLAN, endDate: "2027-06-08" })).status).toBe(200);
    const res = await paste({ ...PLAN, endDate: "2027-06-09" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Anchored trips are limited to 30 days");
    expect(s.asked).toHaveLength(1);
  });

  it("answers a paste too short to be a plan with its reason", async () => {
    const res = await paste({ ...PLAN, text: "Venice" });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("too_short");
    expect(s.asked).toEqual([]);
  });

  it("sends the model at most 8,000 characters of a paste and 120 of a destination", async () => {
    await paste({ ...PLAN, text: "x".repeat(50_000), destination: "y".repeat(5_000) });
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0].match(/x{2,}/)?.[0].length).toBe(8_000);
    expect(s.asked[0].match(/y{2,}/)?.[0].length).toBe(120);
  });

  it("answers 400, not 500, to a body of JSON null", async () => {
    expect((await paste("null")).status).toBe(400);
  });
});

describe("when the model doesn't deliver", () => {
  it.each<[string, Error | null, string]>([
    ["the call fails", new Error("503 model overloaded"), READ_BY_MODEL],
    ["its answer isn't JSON", null, "I could not read that"],
  ])("answers 503 with no anchors when %s, logs it, and spends no budget", async (_name, error, reply) => {
    s.modelError = error;
    s.reply = reply;
    const res = await paste(PLAN);
    expect(res.status).toBe(503);
    expect((await res.json()).anchors).toBeUndefined();
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ response_status: 503, error_message: "extract_failed" });
    expect(quotaUsed()).toBe(0);
  });

  it("answers 400 with its reason when the model found no plan in the text", async () => {
    s.reply = NOTHING_READ;
    const res = await paste(PLAN);
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("nothing_found");
    expect(logged()[0]).toMatchObject({ response_status: 400, error_message: "nothing_found" });
  });

  it("answers 500 and reports it when something unexpected breaks, without calling the model", async () => {
    s.sessionError = new Error("session store unavailable");
    expect((await paste(PLAN)).status).toBe(500);
    expect(s.outcomes).toMatchObject([{ endpoint: "import-plan", outcome: "failure" }]);
    expect(s.asked).toEqual([]);
  });
});
