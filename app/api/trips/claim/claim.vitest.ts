/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
let rpcRow: { claimed: boolean; trip_id: string | null } = { claimed: true, trip_id: "trip-1" };

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // Outside a request scope after() throws; run the scheduled write inline.
  after: (task: () => unknown) => void task(),
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "user-1" }, errorResponse: null }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: [rpcRow], error: null }),
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

const claim = (session: string) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/trips/claim", {
      method: "POST",
      body: JSON.stringify({ claimToken: "t".repeat(32) }),
      headers: { "content-type": "application/json", cookie: `mt_session_id=${session}` },
    })
  );
const wizardRows = () => inserts.filter((i) => i.table === "wizard_step_events").map((i) => i.row);

beforeEach(() => {
  inserts.length = 0;
  rpcRow = { claimed: true, trip_id: "trip-1" };
});

describe("claiming an anonymous trip", () => {
  it("counts as the wizard save, next to the trip_claimed funnel row", async () => {
    const res = await claim("e2eprobe-claim");
    expect(res.status).toBe(200);
    expect(inserts.find((i) => i.table === "funnel_events")?.row).toMatchObject({ event_type: "trip_claimed", trip_id: "trip-1" });
    expect(wizardRows()).toEqual([{ session_id: "e2eprobe-claim", step: "saved", user_id: "user-1", locale: null }]);
  });

  it("writes no save when nothing was claimed", async () => {
    rpcRow = { claimed: false, trip_id: null };
    await claim("e2eprobe-claim");
    expect(wizardRows()).toEqual([]);
  });

  it("writes no wizard row for an untagged session outside production", async () => {
    await claim("5b1c2d3e-real-looking-session");
    expect(wizardRows()).toEqual([]);
  });
});
