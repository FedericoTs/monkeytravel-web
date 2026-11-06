// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A free tool anyone can call, paying for one model call and up to ten Google
 * searches. The limits come before the spending, the searches have a budget of
 * their own, and a failed read says what failed.
 */

const PLAN = { destination: "Rome", days: [{ label: "Day 1", stops: [] }] };
const REPORT = { destination: "Rome", days: [], looked: 2, closed: 1, missing: 0, packedDays: 1, keep: ["Uffizi"] };

const s = vi.hoisted(() => ({
  user: null as { id: string } | null,
  limits: {} as Record<string, boolean>,
  limitedBy: [] as [string, string | undefined][],
  access: { allowed: true } as { allowed: boolean },
  anonDayOpen: true,
  extracted: null as unknown,
  extractCalls: [] as string[],
  checkCalls: [] as unknown[][],
  logged: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (name: string) => ({
    check: async (_request: unknown, id?: string) => {
      s.limitedBy.push([name, id]);
      return { allowed: s.limits[name] !== false };
    },
    checkKey: async (id: string) => {
      s.limitedBy.push([name, id]);
      return { allowed: s.limits[name] !== false };
    },
  }),
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => s.access,
  blockedCall: () => new Response(null, { status: 503 }),
  logApiCall: async (entry: Record<string, unknown>) => {
    s.logged.push(entry);
  },
}));
vi.mock("@/lib/ai/anon-daily-limit", () => ({ withinAnonDailyLimit: async () => s.anonDayOpen }));
vi.mock("@/lib/ai/gemini-cost", () => ({
  GeminiCostMeter: class {
    usd = 0.001;
    run = (fn: () => unknown) => fn();
  },
}));
vi.mock("@/lib/plans/plan-check-extract", () => ({
  MAX_PLAN_TEXT_CHARS: 100,
  extractPastedPlan: async (text: string) => {
    s.extractCalls.push(text);
    return s.extracted;
  },
  isPastedPlanError: (r: { error?: unknown }) => typeof r?.error === "string",
}));
vi.mock("@/lib/plans/plan-check", () => ({
  checkPlan: async (...args: unknown[]) => {
    s.checkCalls.push(args);
    return REPORT;
  },
}));

const { POST } = await import("./route");

const post = async (body: unknown) => {
  const res = await POST(
    new NextRequest("https://monkeytravel.app/api/tools/check-plan", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};

beforeEach(() => {
  s.user = null;
  s.limits = {};
  s.limitedBy = [];
  s.access = { allowed: true };
  s.anonDayOpen = true;
  s.extracted = PLAN;
  s.extractCalls = [];
  s.checkCalls = [];
  s.logged = [];
});

describe("checking a plan", () => {
  it("answers the report, with the searches made, and isn't cached", async () => {
    const { status, json, headers } = await post({ text: "Day 1: Rome" });
    expect(status).toBe(200);
    expect(json).toEqual({ ...REPORT, lookedUp: true });
    expect(s.checkCalls).toEqual([[PLAN, { lookUp: true }]]);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(s.logged[0]).toMatchObject({ endpoint: "/api/tools/check-plan", status: 200, metadata: { looked: 2, closed: 1, packed_days: 1, looked_up: true } });
  });

  it("logs nothing of the plan's words", async () => {
    await post({ text: "Day 1: Trattoria Secret" });
    expect(JSON.stringify(s.logged)).not.toContain("Trattoria Secret");
  });

  it("reads the days but searches nothing once the day's searches are used up", async () => {
    s.limits["check-plan-lookups"] = false;
    const { status, json } = await post({ text: "Day 1: Rome" });
    expect(status).toBe(200);
    expect(json.lookedUp).toBe(false);
    expect(s.checkCalls).toEqual([[PLAN, { lookUp: false }]]);
  });

  it("counts the searches for everyone together", async () => {
    await post({ text: "Day 1: Rome" });
    expect(s.limitedBy).toContainEqual(["check-plan-lookups", "all"]);
  });
});

describe("what comes before the spending", () => {
  const nothingSpent = () => {
    expect(s.extractCalls).toEqual([]);
    expect(s.checkCalls).toEqual([]);
  };

  it("limits by network when signed out", async () => {
    s.limits["check-plan"] = false;
    expect((await post({ text: "Day 1: Rome" })).status).toBe(429);
    nothingSpent();
  });

  it("limits by account when signed in, which has more room", async () => {
    s.user = { id: "me" };
    s.limits["check-plan"] = false;
    expect((await post({ text: "Day 1: Rome" })).status).toBe(200);
    expect(s.limitedBy[0]).toEqual(["check-plan-account", "me"]);

    s.limits["check-plan-account"] = false;
    expect((await post({ text: "Day 1: Rome" })).status).toBe(429);
  });

  it.each([
    ["no text", {}],
    ["blank text", { text: "   " }],
    ["text that isn't text", { text: 12 }],
  ])("refuses %s", async (_name, body) => {
    const { status, json } = await post(body);
    expect(status).toBe(400);
    expect(json.reason).toBe("too_short");
    nothingSpent();
  });

  it("refuses text far past what's read", async () => {
    const { status, json } = await post({ text: "x".repeat(201) });
    expect(status).toBe(400);
    expect(json.reason).toBe("too_long");
    nothingSpent();
  });

  it("refuses a body that isn't JSON", async () => {
    expect((await post("not json")).status).toBe(400);
    nothingSpent();
  });

  it("asks Gemini's switch", async () => {
    s.access = { allowed: false };
    expect((await post({ text: "Day 1: Rome" })).status).toBe(503);
    nothingSpent();
  });

  it("stops signed-out checks at the daily limit, and not signed-in ones", async () => {
    s.anonDayOpen = false;
    expect((await post({ text: "Day 1: Rome" })).status).toBe(429);
    nothingSpent();

    s.user = { id: "me" };
    expect((await post({ text: "Day 1: Rome" })).status).toBe(200);
  });
});

describe("a failed read", () => {
  it.each([
    ["too_short", 400],
    ["nothing_found", 400],
  ])("%s says why, and searches nothing", async (error, status) => {
    s.extracted = { error };
    const res = await post({ text: "Day 1: Rome" });
    expect(res.status).toBe(status);
    expect(res.json.reason).toBe(error);
    expect(s.checkCalls).toEqual([]);
    expect(s.logged[0]).toMatchObject({ status: 400, error });
  });

  it("a model that failed is a 503, and is logged", async () => {
    s.extracted = { error: "extract_failed" };
    expect((await post({ text: "Day 1: Rome" })).status).toBe(503);
    expect(s.logged[0]).toMatchObject({ status: 503, error: "extract_failed" });
  });

  it("a model out of credit answers with the outage's code", async () => {
    s.extracted = { error: "model_outage" };
    const { json, status } = await post({ text: "Day 1: Rome" });
    expect(status).toBe(503);
    expect(json.code).toBe("MODEL_OUTAGE");
  });
});
