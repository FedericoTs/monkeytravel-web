/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * The spend alert runs every hour, so it reads sums, not rows: the daily sums for
 * the month so far, and api_spend_by_unit for the last 24 hours. It alerts on the
 * estimate after Google's free allowances, and the function leaves probe rows out
 * without dropping the rows whose request_params is NULL.
 */

const rpc = vi.fn();
const sendOpsAlert = vi.fn<(subject: string, lines: string[]) => Promise<boolean>>(async () => true);
const s = vi.hoisted(() => ({
  limits: [] as Array<Record<string, unknown>>,
  limitsError: null as { message: string } | null,
  month: [] as Array<Record<string, unknown>>,
  monthError: null as { message: string } | null,
  tables: [] as string[],
  monthFilters: [] as unknown[],
  monthColumns: "" as string | undefined,
  limitFilters: [] as unknown[],
  throttled: false,
  throttleKeys: [] as unknown[],
}));
vi.mock("@supabase/supabase-js", async () => {
  const { fakeSupabase } = await import("@/tests/fake-supabase");
  const db = fakeSupabase((q) => {
    s.tables.push(q.table);
    if (q.table === "api_config") {
      s.limitFilters = q.filters;
      return { data: s.limitsError ? null : s.limits, error: s.limitsError };
    }
    s.monthFilters = q.filters;
    s.monthColumns = q.columns;
    return { data: s.monthError ? null : s.month, error: s.monthError };
  });
  return {
    createClient: () => ({
      rpc: (fn: string, args: unknown) => rpc(fn, args),
      from: db.client.from,
    }),
  };
});
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: (namespace: string, limit: number, windowMs: number) => ({
    check: async (_request: unknown, key: string) => {
      s.throttleKeys.push([namespace, limit, windowMs, key]);
      return { allowed: !s.throttled, remaining: 0 };
    },
  }),
}));
const readCreditEstimate = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock("@/lib/ops/gemini-credit", () => ({
  readCreditEstimate: () => readCreditEstimate(),
}));
vi.mock("@/lib/ops/alert", () => ({
  sendOpsAlert: (subject: string, lines: string[]) => sendOpsAlert(subject, lines),
}));

vi.stubEnv("CRON_SECRET", "cron-secret");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
vi.stubEnv("DAILY_SPEND_ALERT_USD", "");

const { GET } = await import("./route");
async function run() {
  const res = await GET(
    new NextRequest("https://monkeytravel.app/api/cron/spend-alert", { headers: { authorization: "Bearer cron-secret" } })
  );
  return { status: res.status, body: await res.json() };
}

const WINDOW = { p_from: "2026-10-11T06:20:00.000Z", p_to: "2026-10-12T06:20:00.000Z" };
const group = (api_name: string, unit_usd: number, calls: number) => ({ api_name, unit_usd, calls, usd: unit_usd * calls });

const TODAY = { p_from: "2026-10-12T00:00:00.000Z", p_to: WINDOW.p_to };

function serve(month: Array<ReturnType<typeof group>>, last24h: unknown[], today: unknown[] = []) {
  s.month = month;
  rpc.mockImplementation(async (_fn: string, args: { p_from: string }) => ({
    data: args.p_from === WINDOW.p_from ? last24h : today,
    error: null,
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T06:20:00Z"));
  rpc.mockReset();
  sendOpsAlert.mockClear();
  readCreditEstimate.mockReset();
  readCreditEstimate.mockResolvedValue(null);
  s.limits = [];
  s.limitsError = null;
  s.month = [];
  s.monthError = null;
  s.tables = [];
  s.monthFilters = [];
  s.limitFilters = [];
  s.throttled = false;
  s.throttleKeys = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.stubEnv("DAILY_SPEND_ALERT_USD", "");
});

describe("the Gemini credit", () => {
  const credit = {
    reading: { usd: 50, at: "2026-11-05T15:00:00.000Z" },
    spentUsd: 41.8,
    usd: 8.2,
    perDayUsd: 1.4,
    lasts: "about 5 days",
    low: true,
  };

  it("emails when it's running low: how much, how long, and what to do", async () => {
    serve([], []);
    readCreditEstimate.mockResolvedValue(credit);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body.creditAlerted).toBe(true);
    expect(sendOpsAlert).toHaveBeenCalledTimes(1);
    const [subject, lines] = sendOpsAlert.mock.calls[0];
    expect(subject).toContain("Gemini credit");
    expect(subject).toContain("$8.20");
    const text = lines.join("\n");
    expect(text).toContain("about 5 days");
    expect(text).toContain("$50.00");
    expect(text).toContain("2026-11-05");
    expect(text).toContain("$41.80");
    expect(text).toContain("https://aistudio.google.com/billing");
    expect(text).toContain("Costs tab");
  });

  it("leaves the days out when it can't tell", async () => {
    serve([], []);
    readCreditEstimate.mockResolvedValue({ ...credit, usd: 0, lasts: null });
    await run();
    expect(sendOpsAlert.mock.calls[0][1].join("\n")).not.toContain("pace");
  });

  it("stays quiet with plenty left, and with no balance typed", async () => {
    serve([], []);
    readCreditEstimate.mockResolvedValue({ ...credit, usd: 40, lasts: "about 28 days", low: false });
    expect((await run()).body.creditAlerted).toBe(false);
    readCreditEstimate.mockResolvedValue(null);
    expect((await run()).body.creditAlerted).toBe(false);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("sends both emails on a day that needs both", async () => {
    serve([], [group("gemini", 0.5, 41)]);
    readCreditEstimate.mockResolvedValue(credit);
    await run();
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
  });

  it("looks only on the morning run, so it emails once a day", async () => {
    vi.setSystemTime(new Date("2026-10-12T07:20:00Z"));
    serve([], []);
    readCreditEstimate.mockResolvedValue(credit);
    const { body } = await run();
    expect(readCreditEstimate).not.toHaveBeenCalled();
    expect(body.creditAlerted).toBe(false);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });
});

describe("spend alert", () => {
  it("reads sums, not rows: the month's daily sums, then the last 24 hours", async () => {
    serve([], []);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(rpc.mock.calls).toEqual([
      ["api_spend_by_unit", WINDOW],
      ["api_spend_by_unit", TODAY],
    ]);
    expect(s.tables).toEqual(["api_cost_daily", "api_config"]);
    expect(s.monthColumns).toBe("api_name, unit_usd, calls, usd:logged_usd");
    expect(s.monthFilters).toEqual([
      ["eq", "probe", false],
      ["gte", "day", "2026-10-01"],
      ["lt", "day", "2026-10-11"],
    ]);
    expect(body).toMatchObject({ ok: true, from: WINDOW.p_from, to: WINDOW.p_to, listUsd: 0, estimatedUsd: 0, alerted: false });
  });

  it("stays quiet when the list price passes the limit but the estimate does not", async () => {
    // Search still inside its monthly allowance, photos past theirs.
    serve(
      [group("google_places_search", 0.032, 1000), group("google_places_photo", 0.007, 1000)],
      [group("google_places_search", 0.032, 700), group("google_places_photo", 0.007, 100), group("gemini", 0.0171, 100)]
    );
    const { body } = await run();
    expect(body).toMatchObject({ listUsd: 24.81, estimatedUsd: 2.41, over: false, alerted: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("counts the month's calls against the allowance", async () => {
    serve([group("google_places_photo", 0.007, 1000)], [group("google_places_photo", 0.007, 100)]);
    const { body } = await run();
    expect(body).toMatchObject({ listUsd: 0.7, estimatedUsd: 0.7 });
  });

  it("alerts on the estimate, listing each API's calls, list price and estimate", async () => {
    serve(
      [group("google_places_search", 0.032, 6000), group("google_places_photo", 0.007, 200)],
      [group("google_places_search", 0.032, 700), group("google_places_photo", 0.007, 100)]
    );
    const { body } = await run();
    expect(body).toMatchObject({ listUsd: 23.1, estimatedUsd: 22.4, over: true, alerted: true });
    const [subject, lines] = sendOpsAlert.mock.calls[0];
    expect(subject).toBe("Paid APIs cost an estimated $22.40 in the last 24 hours (limit $6)");
    const text = lines.join("\n");
    expect(text).toMatch(/google_places_search\s+700\s+\$22\.40\s+\$22\.40/);
    expect(text).toMatch(/google_places_photo\s+100\s+\$0\.70\s+\$0\.00/);
    expect(text).toMatch(/total\s+\$23\.10\s+\$22\.40/);
    expect(text).toContain("The Google Cloud bill is the source of truth.");
    expect(text).toContain("/admin");
  });

  it("alerts once a day, however many hours it stays over", async () => {
    serve([], [group("gemini", 0.5, 41)]);
    await run();
    expect(s.throttleKeys).toEqual([["spend-alert", 1, 24 * 60 * 60 * 1000, "spend"]]);
    s.throttled = true;
    sendOpsAlert.mockClear();
    const { body } = await run();
    expect(body).toMatchObject({ over: true, alerted: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("doesn't use up the day's alert while under the limit", async () => {
    serve([], [group("gemini", 0.5, 1)]);
    await run();
    expect(s.throttleKeys).toEqual([]);
  });

  it("takes the limit from the setting", async () => {
    vi.stubEnv("DAILY_SPEND_ALERT_USD", "30");
    serve([], [group("gemini", 0.5, 41)]);
    const { body } = await run();
    expect(body).toMatchObject({ limitUsd: 30, estimatedUsd: 20.5, over: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("starts each month's allowance fresh, with no false alarm on the 1st", async () => {
    vi.setSystemTime(new Date("2026-11-01T10:20:00Z"));
    // All of October's calls are in the daily sums; none of them are in November's allowance.
    serve([], [group("google_places_search", 0.032, 700)]);
    const { body } = await run();
    expect(s.monthFilters).toEqual([
      ["eq", "probe", false],
      ["gte", "day", "2026-11-01"],
      ["lt", "day", "2026-10-31"],
    ]);
    expect(body).toMatchObject({ estimatedUsd: 0, over: false });
  });

  it("answers 500 when the daily sums can't be read", async () => {
    serve([], []);
    s.monthError = { message: "read failed" };
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("answers 500 while the function is missing, as before the migration is applied", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.api_spend_by_unit(p_from, p_to) in the schema cache" },
    });
    const { status, body } = await run();
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });
});

describe("the daily limits", () => {
  const limit = (api_name: string, daily_limit: number) => ({ api_name, daily_limit });

  it("emails when an API has used 90% of today's limit, saying what stops", async () => {
    s.limits = [limit("google_places_details", 400), limit("google_places_search", 400)];
    serve([], [], [group("google_places_details", 0.005, 300), group("google_places_details", 0.017, 60), group("google_places_search", 0.032, 359)]);
    const { body } = await run();
    expect(body).toMatchObject({ near: [{ api: "google_places_details", calls: 360, limit: 400 }], limitAlerted: true });
    const [subject, lines] = sendOpsAlert.mock.calls[0];
    expect(subject).toContain("google_places_details");
    const text = lines.join("\n");
    expect(text).toContain("360 of 400");
    expect(text).not.toContain("google_places_search");
    expect(text).toContain("api_config");
    expect(text).toContain("midnight UTC");
  });

  it("emails once a day about it, separately from the spend email", async () => {
    s.limits = [limit("gemini", 10)];
    serve([], [group("gemini", 0.5, 41)], [group("gemini", 0.5, 41)]);
    await run();
    expect(sendOpsAlert).toHaveBeenCalledTimes(2);
    expect(s.throttleKeys).toEqual([
      ["spend-alert", 1, 24 * 60 * 60 * 1000, "spend"],
      ["spend-alert", 1, 24 * 60 * 60 * 1000, "limit"],
    ]);
    s.throttled = true;
    sendOpsAlert.mockClear();
    const { body } = await run();
    expect(body).toMatchObject({ limitAlerted: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("stays quiet below 90%, and doesn't use up the day's email", async () => {
    s.limits = [limit("gemini", 100)];
    serve([], [], [group("gemini", 0.01, 89)]);
    const { body } = await run();
    expect(body).toMatchObject({ near: [], limitAlerted: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
    expect(s.throttleKeys).toEqual([]);
  });

  it("only reads APIs that have a limit", async () => {
    serve([], [], [group("gemini", 0.01, 5000)]);
    expect((await run()).body.near).toEqual([]);
    expect(s.limitFilters).toEqual([["not", "daily_limit", ["is", null]]]);
  });

  it("answers 500 when today's calls can't be read", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_from: string }) =>
      args.p_from === TODAY.p_from ? { data: null, error: { message: "read failed" } } : { data: [], error: null }
    );
    const { status } = await run();
    expect(status).toBe(500);
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("answers 500 when the limits can't be read", async () => {
    serve([], []);
    s.limitsError = { message: "read failed" };
    const { status } = await run();
    expect(status).toBe(500);
  });
});

describe("api_spend_by_unit", () => {
  const migration = () =>
    readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261014120000_api_spend_by_unit.sql"), "utf8").replace(
      /\r/g,
      ""
    );

  it("leaves out probe rows without dropping the rows whose request_params is NULL", () => {
    // A bare `not request_params ? 'probe'` is NULL for those rows, so it drops them.
    const sql = migration();
    expect(sql).toContain("and not coalesce(l.request_params ? 'probe', false)");
    expect(sql.match(/\? 'probe'/g)).toHaveLength(1);
  });

  it("returns one jsonb value, which PostgREST's row cap cannot cut short", () => {
    const sql = migration();
    expect(sql).toMatch(/returns jsonb\n/);
    expect(sql).not.toMatch(/returns (table|setof)/);
  });

  it("runs for the service role only", () => {
    const sql = migration();
    expect(sql).toContain("security definer\nset search_path = public\n");
    expect(sql).toContain(
      "revoke execute on function public.api_spend_by_unit(timestamptz, timestamptz) from public, anon, authenticated;"
    );
    expect(sql).toContain("grant execute on function public.api_spend_by_unit(timestamptz, timestamptz) to service_role;");
  });
});
