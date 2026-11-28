// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * The daily reminders run: only the cron gets in, it runs on today's UTC date, the kept plans are read here by their
 * tokens through the service role, and a run that couldn't read its rows or plans fails loudly rather than reading as
 * a quiet day.
 */

const s = vi.hoisted(() => ({
  refused: false,
  days: [] as string[],
  fails: false,
  tokens: ["T".repeat(22)] as string[],
  plansRead: [] as unknown[],
  planError: null as unknown,
  log: [] as FakeQuery[],
}));

vi.mock("@/lib/api/cron-auth", () => ({
  refuseUnlessCron: () => (s.refused ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : null),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const db = fakeSupabase((q) =>
      q.table === "kept_plans" ? { data: [{ token: s.tokens[0] }], error: s.planError } : { data: null, error: null },
    );
    s.log = db.log;
    return db.client;
  },
}));
vi.mock("@/lib/plans/plan-reminders", () => ({
  KEPT_PLAN_FIELDS: "token, start_date:plan->>startDate",
  sendDuePlanReminders: async (_admin: unknown, today: string, plansFor: (tokens: string[]) => Promise<unknown[]>) => {
    s.days.push(today);
    if (s.fails) throw new Error("plan reminders not read: down");
    s.plansRead = await plansFor(s.tokens);
    return { sent: 2, failed: 0, removed: 1 };
  },
}));

const { GET } = await import("./route");
const call = () => GET(new NextRequest("https://monkeytravel.app/api/cron/plan-reminders"));

beforeEach(() => {
  s.refused = false;
  s.days = [];
  s.fails = false;
  s.plansRead = [];
  s.planError = null;
  s.log = [];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T07:20:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/cron/plan-reminders", () => {
  it("runs today's reminders and says what it did", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 2, failed: 0, removed: 1 });
    expect(s.days).toEqual(["2026-12-01"]);
  });

  it("reads the reminders' kept plans by their tokens, and only their fields", async () => {
    await call();
    const read = s.log.find((q) => q.table === "kept_plans");
    expect(read).toMatchObject({ op: "select", columns: "token, start_date:plan->>startDate" });
    expect(read?.filters).toEqual([["in", "token", s.tokens]]);
    expect(s.plansRead).toEqual([{ token: s.tokens[0] }]);
  });

  it("refuses anything but the cron, before running", async () => {
    s.refused = true;
    expect((await call()).status).toBe(401);
    expect(s.days).toEqual([]);
  });

  it("fails loudly when the run couldn't read its rows or their plans", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.fails = true;
    let res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Run failed" });
    s.fails = false;
    s.planError = { message: "down" };
    res = await call();
    expect(res.status).toBe(500);
  });
});
