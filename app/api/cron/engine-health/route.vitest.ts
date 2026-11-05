// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Hourly, the owner hears about a plan engine that's failing people, at most every
 * six hours. Google refusing for lack of credit stops everything AI until someone
 * tops up, so the first refusal alerts without waiting for a failure rate, and the
 * email says what to do. The real route runs over a fake database.
 */

const s = vi.hoisted(() => ({
  health: null as unknown,
  healthError: null as unknown,
  failures: [] as Array<{ error_message: string | null }>,
  failuresError: null as unknown,
  allowed: true,
  alerts: [] as Array<{ subject: string; lines: string[] }>,
  log: [] as FakeQuery[],
}));

vi.mock("@/lib/api/cron-auth", () => ({ refuseUnlessCron: () => null }));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: s.allowed, remaining: 0 }) }),
}));
vi.mock("@/lib/ops/alert", () => ({
  sendOpsAlert: async (subject: string, lines: string[]) => {
    s.alerts.push({ subject, lines });
    return true;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) =>
      q.op === "rpc" ? { data: s.health, error: s.healthError } : { data: s.failures, error: s.failuresError }
    );
    s.log = db.log;
    return db.client;
  },
}));

const { GET } = await import("./route");

const HEALTHY = { minutes: 60, requests: 12, errors: 0, client_generating: 11, client_failed: 0, ok_last_3h: 30 };
const FAILING = { ...HEALTHY, errors: 6, client_failed: 6 };
const OUT_OF_CREDIT = `Failed to generate itinerary: AI service unavailable (root: {"error":{"code":402,"message":"Your prepayment credits are depleted.`;
const STREAMED_OUT_OF_CREDIT = String.raw`{"error":{"message":"{\n  \"error\": {\n    \"code\": 402,\n    \"message\": \"Your prepayment credits are depleted.`;

const check = async () => {
  const res = await GET(new NextRequest("https://monkeytravel.app/api/cron/engine-health"));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const failuresRead = () => s.log.find((q) => q.table === "api_request_logs");

beforeEach(() => {
  s.health = HEALTHY;
  s.healthError = null;
  s.failures = [];
  s.failuresError = null;
  s.allowed = true;
  s.alerts.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe("the hourly engine check", () => {
  it("stays quiet while plans are working", async () => {
    expect((await check()).status).toBe(200);
    expect(s.alerts).toEqual([]);
  });

  it("stays quiet over a few failures that have nothing to do with credit", async () => {
    s.failures = [{ error_message: "503 model overloaded" }, { error_message: null }];
    expect((await check()).status).toBe(200);
    expect(s.alerts).toEqual([]);
  });

  it.each([
    ["the JSON route's", OUT_OF_CREDIT],
    ["the stream's", STREAMED_OUT_OF_CREDIT],
  ])("alerts on one refusal for lack of credit, in %s words, and says what to do", async (_name, error_message) => {
    s.failures = [{ error_message: "503 model overloaded" }, { error_message }];
    const { status, body } = await check();
    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, alerted: true });
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0].lines[0]).toContain("credits");
    expect(s.alerts[0].lines[0]).toContain("https://aistudio.google.com/billing");
  });

  it("gives the cause first when people are failing too", async () => {
    s.health = FAILING;
    s.failures = [{ error_message: OUT_OF_CREDIT }];
    await check();
    expect(s.alerts[0].lines[0]).toContain("credits");
    expect(s.alerts[0].lines[1]).toBe("6 of 12 generations failed in the last 60 min.");
  });

  it("alerts on a failure rate without blaming credit", async () => {
    s.health = FAILING;
    await check();
    expect(s.alerts[0].lines[0]).toBe("6 of 12 generations failed in the last 60 min.");
    expect(s.alerts[0].lines.join("\n")).not.toContain("credits");
  });

  it("looks only at the last hour's failed Gemini calls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    try {
      await check();
    } finally {
      vi.useRealTimers();
    }
    expect(failuresRead()?.filters).toEqual(
      expect.arrayContaining([
        ["eq", "api_name", "gemini"],
        ["gte", "response_status", 400],
        ["gte", "timestamp", "2026-11-05T11:00:00.000Z"],
      ])
    );
  });

  it("still judges the engine when those calls can't be read", async () => {
    s.failuresError = { message: "read failed" };
    expect((await check()).status).toBe(200);
    s.health = FAILING;
    expect((await check()).status).toBe(500);
    expect(s.alerts).toHaveLength(1);
  });

  it("doesn't email again while the last alert is fresh, and still fails the run", async () => {
    s.allowed = false;
    s.failures = [{ error_message: OUT_OF_CREDIT }];
    expect(await check()).toMatchObject({ status: 500, body: { alerted: false } });
    expect(s.alerts).toEqual([]);
  });

  it("fails the run when the reading itself fails, which isn't a healthy engine", async () => {
    s.health = null;
    s.healthError = { message: "no function" };
    expect(await check()).toMatchObject({ status: 500, body: { ok: false, error: "no function" } });
    expect(s.alerts).toEqual([]);
  });
});
