// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The Explore byline a publish stores.
 *
 * The share prompt publishes with whatever name the trip page hands it, and
 * the page used to fall back to the email's local part: 62 of the 70 public
 * trips of real users showed it (for gmail, + "@gmail.com" is the address).
 * The route now refuses it whatever the client sends.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => true }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn() }));
vi.mock("@/lib/images/enrichTrip", () => ({ enrichTripByIdAdmin: vi.fn() }));
vi.mock("@/lib/explore/counters", () => ({ runTripCounter: vi.fn() }));
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
        then: (resolve: (v: unknown) => void) => resolve({ count: 0, error: null }),
      };
      return q;
    },
  };
}
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({
    user: { id: OWNER, email: "ana.lopez1985@gmail.com", created_at: "2025-01-01T00:00:00Z" },
    supabase: fakeSupabase(),
    errorResponse: null,
  }),
}));

async function publish(authorDisplayName: unknown) {
  const { POST } = await import("./route");
  const res = await POST(
    new NextRequest(`http://localhost/api/trips/${TRIP}/publish`, { method: "POST", body: JSON.stringify({ authorDisplayName }) }),
    { params: Promise.resolve({ id: TRIP }) }
  );
  return res.status;
}

beforeEach(() => {
  updates.length = 0;
});

describe("publish byline", () => {
  it("stores a real name", async () => {
    expect(await publish("Ana Lopez")).toBe(200);
    expect(updates[0].author_display_name).toBe("Ana Lopez");
  });

  it("never stores the email's local part", async () => {
    expect(await publish("ana.lopez1985")).toBe(200);
    expect(updates[0]).not.toHaveProperty("author_display_name");
  });

  it("never stores an address", async () => {
    expect(await publish("ana.lopez1985@gmail.com")).toBe(200);
    expect(updates[0]).not.toHaveProperty("author_display_name");
  });
});
