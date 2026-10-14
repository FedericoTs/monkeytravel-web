/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

/**
 * The spend alert reads sums, not rows: api_spend_by_unit for the month before
 * yesterday and for yesterday. It alerts on the estimate after Google's free
 * allowances, and the function leaves probe rows out without dropping the rows
 * whose request_params is NULL.
 */

const rpc = vi.fn();
const sendOpsAlert = vi.fn<(subject: string, lines: string[]) => Promise<boolean>>(async () => true);
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (fn: string, args: unknown) => rpc(fn, args),
    from: () => {
      throw new Error("read api_request_logs rows through PostgREST");
    },
  }),
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

const MONTH = { p_from: "2026-10-01T00:00:00.000Z", p_to: "2026-10-11T00:00:00.000Z" };
const DAY = { p_from: "2026-10-11T00:00:00.000Z", p_to: "2026-10-12T00:00:00.000Z" };
const group = (api_name: string, unit_usd: number, calls: number) => ({ api_name, unit_usd, calls, usd: unit_usd * calls });

function serve(month: unknown[], day: unknown[]) {
  rpc.mockImplementation(async (_fn: string, args: { p_from: string }) => ({
    data: args.p_from === DAY.p_from ? day : month,
    error: null,
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T06:20:00Z"));
  rpc.mockReset();
  sendOpsAlert.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("spend alert", () => {
  it("sums in the database: the month before yesterday, then yesterday", async () => {
    serve([], []);
    const { status, body } = await run();
    expect(status).toBe(200);
    expect(rpc.mock.calls).toEqual([
      ["api_spend_by_unit", MONTH],
      ["api_spend_by_unit", DAY],
    ]);
    expect(body).toMatchObject({ ok: true, day: "2026-10-11", listUsd: 0, estimatedUsd: 0, alerted: false });
  });

  it("stays quiet when the list price passes the limit but the estimate does not", async () => {
    // Search and details still inside their monthly allowance, photos past it.
    serve(
      [group("google_places_search", 0.032, 1447), group("google_places_details", 0.005, 2024), group("google_places_photo", 0.007, 5207)],
      [
        group("google_places_search", 0.032, 700),
        group("google_places_details", 0.005, 380),
        group("google_places_photo", 0.007, 668),
        group("gemini", 0.0171, 100),
      ]
    );
    const { body } = await run();
    expect(body).toMatchObject({ listUsd: 30.69, estimatedUsd: 6.39, over: false, alerted: false });
    expect(sendOpsAlert).not.toHaveBeenCalled();
  });

  it("alerts on the estimate, listing each API's calls, list price and estimate", async () => {
    serve(
      [group("google_places_search", 0.032, 6000), group("google_places_photo", 0.007, 200)],
      [group("google_places_search", 0.032, 700), group("google_places_photo", 0.007, 100)]
    );
    const { body } = await run();
    expect(body).toMatchObject({ listUsd: 23.1, estimatedUsd: 22.4, over: true, alerted: true });
    const [subject, lines] = sendOpsAlert.mock.calls[0];
    expect(subject).toBe("Paid APIs cost an estimated $22.40 on 2026-10-11 (limit $20)");
    const text = lines.join("\n");
    expect(text).toMatch(/google_places_search\s+700\s+\$22\.40\s+\$22\.40/);
    expect(text).toMatch(/google_places_photo\s+100\s+\$0\.70\s+\$0\.00/);
    expect(text).toMatch(/total\s+\$23\.10\s+\$22\.40/);
    expect(text).toContain("The Google Cloud bill is the source of truth.");
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
