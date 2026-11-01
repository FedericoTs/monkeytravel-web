// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The weekly publish cap (3 for accounts under a week old, otherwise 10) is a
 * count of this week's public trips. A count the database refused publishes
 * nothing, rather than reading as zero.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";
const updates: Array<Record<string, unknown>> = [];
let weekCount: { count: number | null; error: { message: string } | null };

vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripByIdAdmin: vi.fn() }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));
vi.mock("@/lib/trips/share-token", () => ({
  readShareToken: async () => null,
  ensureShareToken: async () => ({ token: "tok-1", isNew: true }),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: () => {} };
});

const act = (id: string) => ({ id, name: id });
function fakeSupabase() {
  return {
    from: () => {
      let pending: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        update: (u: Record<string, unknown>) => {
          pending = u;
          updates.push(u);
          return q;
        },
        single: async () =>
          pending
            ? { data: { id: TRIP, share_token: "tok" }, error: null }
            : {
                data: {
                  id: TRIP,
                  user_id: OWNER,
                  visibility: "private",
                  share_token: null,
                  created_at: "2026-01-01T00:00:00Z",
                  itinerary: [{ activities: [act("a"), act("b"), act("c")] }],
                  start_date: "2026-11-01",
                  end_date: "2026-11-03",
                  trip_meta: {},
                },
                error: null,
              },
        then: (resolve: (v: unknown) => void) => resolve(weekCount),
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: OWNER, email: "owner@example.com", created_at: "2025-01-01T00:00:00Z" },
    supabase: fakeSupabase(),
    errorResponse: null,
  }),
}));

async function publish() {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/publish`, { method: "POST", body: JSON.stringify({}) }),
    { params: Promise.resolve({ id: TRIP }) }
  );
  return res.status;
}

beforeEach(() => {
  updates.length = 0;
  weekCount = { count: 0, error: null };
});

describe("the weekly publish cap", () => {
  it("publishes under the cap", async () => {
    weekCount = { count: 9, error: null };
    expect(await publish()).toBe(200);
    expect(updates).toHaveLength(1);
  });

  it("refuses at the cap", async () => {
    weekCount = { count: 10, error: null };
    expect(await publish()).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("publishes nothing when this week's count can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    weekCount = { count: null, error: { message: "canceling statement due to statement timeout" } };
    expect(await publish()).toBe(500);
    expect(updates).toHaveLength(0);
  });
});
