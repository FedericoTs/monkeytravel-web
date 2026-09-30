/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const inserted: Array<Record<string, unknown>> = [];
vi.mock("@/lib/api/rate-limit", () => ({
  createRateLimiter: () => ({ check: async () => ({ allowed: true, remaining: 1 }) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from "./route";

const TRIP = "3f2b6c1e-8a4d-4e2f-9b7a-1c2d3e4f5a6b";
const post = (body: unknown) =>
  POST(
    new NextRequest("https://monkeytravel.app/api/funnel-event", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: "mt_session_id=e2eprobe-test" },
    })
  );

beforeEach(() => {
  inserted.length = 0;
});

describe("client-fired funnel events", () => {
  it("records a trip card share with its format and method", async () => {
    const res = await post({ event_type: "trip_card_shared", trip_id: TRIP, format: "square", method: "native_share" });
    expect(res.status).toBe(204);
    expect(inserted).toEqual([
      {
        event_type: "trip_card_shared",
        trip_id: TRIP,
        session_id: "e2eprobe-test",
        user_id: "user-1",
        metadata: { format: "square", method: "native_share" },
      },
    ]);
  });

  it("still records plan-own clicks with their destination and referral code", async () => {
    const res = await post({ event_type: "plan_own_clicked", trip_id: TRIP, destination: "Lisbon", referral_code: "abc" });
    expect(res.status).toBe(204);
    expect(inserted[0]?.metadata).toEqual({ destination: "Lisbon", referral_code: "abc" });
  });

  it("rejects server-side events and card shares missing a trip or with an unknown format", async () => {
    expect((await post({ event_type: "share_link_visited", trip_id: TRIP })).status).toBe(400);
    expect((await post({ event_type: "trip_card_shared", format: "story", method: "download" })).status).toBe(400);
    expect((await post({ event_type: "trip_card_shared", trip_id: TRIP, format: "poster", method: "download" })).status).toBe(400);
    expect(inserted).toEqual([]);
  });
});
