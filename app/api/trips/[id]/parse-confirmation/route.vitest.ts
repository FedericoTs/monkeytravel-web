// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Pasting a booking email spends one Gemini call for the trip's owner. Everything
 * that can refuse comes first, and the call goes in the usage log, which is what
 * the spend alert reads. The real route, extractor and logging run; only Gemini,
 * sign-in, the usage counter and the Supabase client are faked.
 */

const s = vi.hoisted(() => {
  process.env.GOOGLE_AI_API_KEY = "test-key";
  return {
    apiConfig: null as Record<string, unknown> | null,
    owner: true,
    usageOpen: true,
    reply: "",
    modelError: null as Error | null,
    calls: 0,
    counted: [] as string[],
    ip: "",
  };
});

vi.mock("@/lib/ai/genai-compat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/genai-compat")>()),
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => {
          s.calls++;
          if (s.modelError) throw s.modelError;
          return { response: { text: () => s.reply, usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } } };
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
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "owner-1", email: "owner@mail.example.com" }, supabase: {}, errorResponse: null }),
  verifyTripOwnership: async () =>
    s.owner ? { errorResponse: null } : { errorResponse: NextResponse.json({ error: "Forbidden" }, { status: 403 }) },
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: s.usageOpen, used: 0, remaining: 5, limit: 5 }),
  incrementUsage: async (_user: string, what: string) => void s.counted.push(what),
}));
const service = fakeSupabase((q: FakeQuery) =>
  q.table === "api_config" ? { data: s.apiConfig, error: null } : { data: null, error: null }
);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => service.client }));

const { POST } = await import("./route");

const EMAIL = "Your booking is confirmed. Hotel Danieli, Venice. Check-in 10 May 2027 at 15:00. ".repeat(3);
const A_BOOKING = JSON.stringify({ kind: "hotel", name: "Hotel Danieli", startAt: "2027-05-10T15:00:00" });
const NOT_A_BOOKING = JSON.stringify({ kind: "unknown", name: "", startAt: "" });

const paste = (body: unknown = { emailBody: EMAIL }) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/trips/trip-1/parse-confirmation", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": s.ip },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "trip-1" }) }
  );
const logged = () => service.log.filter((q) => q.table === "api_request_logs").map((q) => q.value as Record<string, unknown>);

let run = 0;

beforeEach(() => {
  run++;
  s.ip = `10.0.1.${run}`;
  s.apiConfig = null;
  s.owner = true;
  s.usageOpen = true;
  s.reply = A_BOOKING;
  s.modelError = null;
  s.calls = 0;
  s.counted = [];
  service.log.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("what a paste costs", () => {
  it("answers the booking, counts one use, and logs what the call cost and for whom", async () => {
    const res = await paste();
    expect(res.status).toBe(200);
    expect((await res.json()).parsed).toMatchObject({ kind: "hotel", name: "Hotel Danieli" });
    expect(s.counted).toEqual(["aiAssistantMessages"]);
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({
      api_name: "gemini",
      endpoint: "/api/trips/[id]/parse-confirmation",
      response_status: 200,
      user_id: "owner-1",
      error_message: null,
    });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });

  it("logs and counts an email with no booking in it, since the model read it", async () => {
    s.reply = NOT_A_BOOKING;
    const res = await paste();
    expect((await res.json()).error).toBe("no_booking_found");
    expect(s.counted).toEqual(["aiAssistantMessages"]);
    expect(logged()[0]).toMatchObject({ response_status: 200, error_message: "no_booking_found" });
    expect(logged()[0].cost_usd).toBeGreaterThan(0);
  });

  it("logs a failed call as one", async () => {
    s.modelError = new Error("503 model overloaded");
    const res = await paste();
    expect((await res.json()).error).toBe("parse_failed");
    expect(logged()[0]).toMatchObject({ response_status: 503, error_message: "parse_failed", cost_usd: 0 });
  });

  it("logs the model out of service, and counts no use for it", async () => {
    s.modelError = new Error('Failed: {"error":{"code":402,"message":"Your prepayment credits are depleted"}}');
    const res = await paste();
    expect((await res.json()).error).toBe("model_outage");
    expect(logged()[0]).toMatchObject({ response_status: 503, error_message: "model_outage" });
    expect(s.counted).toEqual([]);
  });

  it("logs nothing for a paste too short to send to the model", async () => {
    const res = await paste({ emailBody: "Too short" });
    expect((await res.json()).error).toBe("too_short");
    expect(s.calls).toBe(0);
    expect(logged()).toEqual([]);
    expect(s.counted).toEqual([]);
  });
});

describe("Gemini's switch", () => {
  it("makes no paid call while the kill switch is off, counts no use, and logs the refusal", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: false, block_mode: "block_calls", daily_limit: null };
    expect((await paste()).status).toBe(503);
    expect(s.calls).toBe(0);
    expect(s.counted).toEqual([]);
    expect(logged()).toHaveLength(1);
    expect(logged()[0]).toMatchObject({ response_status: 503, cost_usd: 0 });
    expect(String(logged()[0].error_message)).toContain("BLOCKED");
  });

  it("makes no paid call past the daily limit", async () => {
    s.apiConfig = { api_name: "gemini", display_name: "Gemini", enabled: true, block_mode: "none", daily_limit: 1 };
    expect((await paste()).status).toBe(200);
    expect((await paste()).status).toBe(503);
    expect(s.calls).toBe(1);
  });
});

describe("what comes before the switch", () => {
  it("turns away anyone but the trip's owner", async () => {
    s.owner = false;
    expect((await paste()).status).toBe(403);
    expect(s.calls).toBe(0);
  });

  it("turns away an owner out of their AI quota", async () => {
    s.usageOpen = false;
    expect((await paste()).status).toBe(403);
    expect(s.calls).toBe(0);
  });

  it.each<[string, unknown]>([
    ["no email", {}],
    ["an email that isn't text", { emailBody: 7 }],
    ["an email over the size limit", { emailBody: "x".repeat(50_001) }],
  ])("refuses %s", async (_name, body) => {
    expect((await paste(body)).status).toBe(400);
    expect(s.calls).toBe(0);
  });
});
