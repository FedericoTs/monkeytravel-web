// @vitest-environment node
// A zone east of UTC: local midnight is the day before in UTC.
process.env.TZ = "Europe/Rome";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeQuery } from "@/tests/fake-supabase";

/**
 * Forking a public trip makes a private copy for the caller: dated from the
 * chosen start, without the source owner's claim and packing state.
 */

const source = {
  id: "src-1",
  user_id: "author-1",
  title: "Lisbon",
  description: "",
  visibility: "public",
  is_hidden: false,
  trip_meta: {
    destination: "Lisbon",
    claimed_at: "2026-09-01T10:00:00Z",
    claimed_from: "anon-session",
    packing_checked: ["passport"],
  },
  itinerary: [
    { day_number: 1, date: "2026-05-01", activities: [{ id: "a1", name: "Belém Tower" }] },
    { day_number: 2, date: "2026-05-02", activities: [{ id: "b1", name: "Sintra" }] },
    { day_number: 3, date: "2026-05-03", activities: [] },
  ],
};

let inserts: FakeQuery[];
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: "user-1" },
    errorResponse: null,
    supabase: fakeSupabase((q) => {
      if (q.op === "insert") {
        inserts.push(q);
        return { data: { id: "new-1" }, error: null };
      }
      return { data: source, error: null };
    }).client,
  }),
}));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: async () => undefined }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: async () => undefined }));
vi.mock("@/lib/notifications/scheduling", () => ({ scheduleTripNotifications: async () => undefined }));
vi.mock("@/lib/referral/completion", () => ({ completeReferralIfEligible: async () => undefined }));

const { POST } = await import("./route");

const fork = (body: Record<string, unknown>) =>
  POST(
    new NextRequest("http://localhost/api/trips/src-1/fork", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "src-1" }) } as never
  );

beforeEach(() => {
  inserts = [];
});

describe("POST fork", () => {
  it("dates the copy from the chosen start and leaves the owner's state behind", async () => {
    const res = await fork({ startDate: "2027-03-10" });
    expect(res.status).toBe(200);
    const row = inserts[0].value as {
      start_date: string;
      end_date: string;
      visibility: string;
      trip_meta: Record<string, unknown>;
      itinerary: Array<{ date: string }>;
    };
    expect(row.itinerary.map((d) => d.date)).toEqual(["2027-03-10", "2027-03-11", "2027-03-12"]);
    expect([row.start_date, row.end_date]).toEqual(["2027-03-10", "2027-03-12"]);
    expect(row.visibility).toBe("private");
    expect(row.trip_meta).toEqual({ destination: "Lisbon" });
  });

  it("refuses a start date that isn't YYYY-MM-DD", async () => {
    expect((await fork({ startDate: "March 10, 2027" })).status).toBe(400);
    expect(inserts).toHaveLength(0);
  });
});
