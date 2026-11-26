/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eqOf, fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Asking for a kept plan's link by email: a bad token or address is refused
 * before anything is spent, the limits come before the read and the send, only
 * a plan that hasn't expired goes out, and the answer says nothing about the
 * address. A ticked "remind me" keeps the address for the reminders, only for a
 * trip with chosen dates that can still be reminded of.
 */

const TOKEN = "T".repeat(22);
const PLAN = { start_date: "2099-11-12", end_date: "2099-11-14", name: "Lisbon", destination: "Lisbon, Portugal" };
const calls = { limit: [] as unknown[][], send: [] as unknown[][], keep: [] as unknown[][] };
let allowed: boolean;
let keptId: string | null;
let outcome: string;
let row: Record<string, unknown> | null;
let readFails: boolean;
let log: FakeQuery[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = fakeSupabase(() => (readFails ? { data: null, error: { message: "timeout" } } : { data: row, error: null }));
    log = fake.log;
    return fake.client;
  },
}));
vi.mock("@/lib/plans/kept-plan-email", () => ({
  mayEmailKeptPlan: async (...args: unknown[]) => {
    calls.limit.push(args.slice(1));
    return allowed;
  },
  sendKeptPlanEmail: async (...args: unknown[]) => {
    calls.send.push(args);
    return outcome;
  },
}));
vi.mock("@/lib/plans/plan-reminders", () => ({
  keepPlanReminder: async (...args: unknown[]) => {
    calls.keep.push(args.slice(1));
    return keptId;
  },
}));

const { POST } = await import("./route");

const post = (token: string, body: unknown) =>
  POST(
    new NextRequest(`https://monkeytravel.app/api/plans/${token}/email`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ token }) },
  );

beforeEach(() => {
  calls.limit = [];
  calls.send = [];
  calls.keep = [];
  keptId = "rem-1";
  log = [];
  allowed = true;
  outcome = "sent";
  row = PLAN;
  readFails = false;
});

describe("POST /api/plans/<token>/email", () => {
  it("sends this plan to the address given, in the page's language", async () => {
    const res = await post(TOKEN, { email: "  Ana@Example.com ", locale: "it" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, reminder: false });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.limit).toEqual([[TOKEN, "ana@example.com"]]);
    expect(calls.send).toEqual([[PLAN, { token: TOKEN, email: "ana@example.com", locale: "it", reminder: null }]]);
    expect(calls.keep).toEqual([]);
  });

  it("only reads a plan that hasn't expired, by its token", async () => {
    await post(TOKEN, { email: "ana@example.com" });
    expect(log[0].table).toBe("kept_plans");
    expect(eqOf(log[0], "token")).toBe(TOKEN);
    expect(log[0].filters.some(([op, col]) => op === "gt" && col === "expires_at")).toBe(true);
  });

  it("sends with no language when none is usable", async () => {
    const localeOf = (i: number) => (calls.send[i][1] as { locale: unknown }).locale;
    await post(TOKEN, { email: "ana@example.com", locale: 7 });
    expect(localeOf(0)).toBeNull();
    await post(TOKEN, { email: "ana@example.com" });
    expect(localeOf(1)).toBeNull();
    await post(TOKEN, { email: "ana@example.com", locale: "x".repeat(40) });
    expect(localeOf(2)).toBe("x".repeat(8));
  });

  it("refuses a token that can't be one, before reading anything", async () => {
    const res = await post("short", { email: "ana@example.com" });
    expect(res.status).toBe(404);
    expect(calls.limit).toEqual([]);
    expect(log).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it("refuses a body that isn't JSON, and an address that isn't one, without spending an allowance", async () => {
    for (const body of ["{not json", "null", {}, { email: "" }, { email: "nope" }, { email: 7 }, { email: "a b@c.d" }]) {
      const res = await post(TOKEN, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(calls.limit).toEqual([]);
    expect(log).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it("stops at the limits, before the read and the send", async () => {
    allowed = false;
    const res = await post(TOKEN, { email: "ana@example.com" });
    expect(res.status).toBe(429);
    expect(log).toEqual([]);
    expect(calls.send).toEqual([]);
  });

  it("answers 404 when no plan is kept under the token, and sends nothing", async () => {
    row = null;
    expect((await post(TOKEN, { email: "ana@example.com" })).status).toBe(404);
    expect(calls.send).toEqual([]);
  });

  it("doesn't read a failed read as no plan", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readFails = true;
    expect((await post(TOKEN, { email: "ana@example.com" })).status).toBe(500);
    expect(calls.send).toEqual([]);
    vi.restoreAllMocks();
  });

  it("says when the send failed", async () => {
    for (const failure of ["failed", "error"]) {
      outcome = failure;
      expect((await post(TOKEN, { email: "ana@example.com" })).status, failure).toBe(500);
    }
  });

  it("answers the same for a first send, a repeat and an address that bounced", async () => {
    for (const quiet of ["sent", "skipped_duplicate", "skipped_suppressed"]) {
      outcome = quiet;
      const res = await post(TOKEN, { email: "ana@example.com" });
      expect(res.status, quiet).toBe(200);
      expect(await res.json(), quiet).toEqual({ sent: true, reminder: false });
    }
  });
});

describe("POST /api/plans/<token>/email with the reminder box ticked", () => {
  const today = (day: string) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day}T12:00:00Z`));
  };
  afterEach(() => vi.useRealTimers());

  it("keeps the address for the week's and the day before's reminders, and says so", async () => {
    today("2099-11-01");
    const res = await post(TOKEN, { email: "Ana@Example.com", locale: "it", remind: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true, reminder: true });
    expect(calls.keep).toEqual([
      [{ token: TOKEN, email: "ana@example.com", locale: "it", start: "2099-11-12", end: "2099-11-14" }],
    ]);
    expect(calls.send).toEqual([
      [PLAN, { token: TOKEN, email: "ana@example.com", locale: "it", reminder: { id: "rem-1", kind: "week" } }],
    ]);
  });

  it("keeps it for the day before's only when the trip is 2 to 7 days away", async () => {
    today("2099-11-05");
    await post(TOKEN, { email: "ana@example.com", remind: true });
    expect((calls.send[0][1] as { reminder: unknown }).reminder).toEqual({ id: "rem-1", kind: "day" });
  });

  it("asks for nothing for dates nobody chose, a trip tomorrow, or anything but a tick", async () => {
    today("2099-11-01");
    row = { ...PLAN, flexible: "true" };
    await post(TOKEN, { email: "ana@example.com", remind: true });
    row = PLAN;
    today("2099-11-11");
    await post(TOKEN, { email: "ana@example.com", remind: true });
    today("2099-11-01");
    await post(TOKEN, { email: "ana@example.com", remind: "true" });
    await post(TOKEN, { email: "ana@example.com", remind: 1 });
    expect(calls.keep).toEqual([]);
    expect(calls.send.map((call) => (call[1] as { reminder: unknown }).reminder)).toEqual([null, null, null, null]);
  });

  it("still sends the plan, without the reminders' lines, when the tick couldn't be kept", async () => {
    today("2099-11-01");
    keptId = null;
    const res = await post(TOKEN, { email: "ana@example.com", remind: true });
    expect(await res.json()).toEqual({ sent: true, reminder: false });
    expect((calls.send[0][1] as { reminder: unknown }).reminder).toBeNull();
  });

  it("reads whether the plan's dates were chosen", async () => {
    today("2099-11-01");
    await post(TOKEN, { email: "ana@example.com", remind: true });
    expect(log[0].columns).toContain("flexible:plan->>flexibleDates");
  });
});
