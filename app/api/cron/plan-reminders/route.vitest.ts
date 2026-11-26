// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The daily reminders run: only the cron gets in, it runs on today's UTC date, and a run that couldn't read its rows
 * fails loudly rather than reading as a quiet day.
 */

const s = vi.hoisted(() => ({
  refused: false,
  days: [] as string[],
  fails: false,
}));

vi.mock("@/lib/api/cron-auth", () => ({
  refuseUnlessCron: () => (s.refused ? NextResponse.json({ error: "Unauthorized" }, { status: 401 }) : null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/plans/plan-reminders", () => ({
  sendDuePlanReminders: async (_admin: unknown, today: string) => {
    s.days.push(today);
    if (s.fails) throw new Error("plan reminders not read: down");
    return { sent: 2, failed: 0, removed: 1 };
  },
}));

const { GET } = await import("./route");
const call = () => GET(new NextRequest("https://monkeytravel.app/api/cron/plan-reminders"));

beforeEach(() => {
  s.refused = false;
  s.days = [];
  s.fails = false;
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

  it("refuses anything but the cron, before running", async () => {
    s.refused = true;
    expect((await call()).status).toBe(401);
    expect(s.days).toEqual([]);
  });

  it("fails loudly when the run couldn't read its rows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    s.fails = true;
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Run failed" });
  });
});
