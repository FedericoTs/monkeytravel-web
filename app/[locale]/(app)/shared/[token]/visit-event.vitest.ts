// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A recipient opening a share link is counted in PostHog as crew_link_visited,
 * under trip_id like every other trip event, so the share loop joins the rest.
 * The link's token never goes with it: whoever holds it can open the trip. The
 * page is rendered on the server here and every capture is searched for it.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";

// A row as select("*") returns it, share token included.
const ROW = {
  id: "trip-1",
  user_id: "owner-1",
  title: "Lisbon Trip",
  description: "Three days of trams and tiles",
  status: "planning",
  start_date: "2026-10-09",
  end_date: "2026-10-11",
  itinerary: [],
  trip_meta: { destination: "Lisbon", timezone: "Europe/Lisbon" },
  visibility: "shared",
  is_hidden: false,
  public_slug: null,
  share_token: TOKEN,
  deleted_at: null,
};

const request = { headers: {} as Record<string, string>, cookies: {} as Record<string, string> };
// The row the page reads, changed by a test for a trip of another kind.
let row: Record<string, unknown> = ROW;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.headers),
  cookies: async () => ({ get: (name: string) => (name in request.cookies ? { value: request.cookies[name] } : undefined) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = { select: () => q, eq: () => q, is: () => q, single: async () => ({ data: { ...row }, error: null }) };
    return { from: () => q };
  },
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => null, createClient: async () => ({}) }));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshTripItinerary: async (days: unknown) => days }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("./SharedTripView", () => ({ default: function SharedTripView() { return null; } }));
vi.mock("@/components/explore/TripEngagementSection", () => ({ default: function TripEngagementSection() { return null; } }));
vi.mock("@/lib/analytics/funnel-events", () => ({ logSharedTripVisit: vi.fn(async () => {}), madeThisShareLink: vi.fn(async () => false) }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn(async () => {}) }));

const { default: SharedTripPage } = await import("./page");
const { captureServerEvent } = await import("@/lib/posthog/server");
const { logSharedTripVisit, madeThisShareLink } = await import("@/lib/analytics/funnel-events");

async function visit() {
  await SharedTripPage({ params: Promise.resolve({ locale: "en", token: TOKEN }), searchParams: Promise.resolve({}) });
  // The capture runs after the render, without holding it up.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(captureServerEvent).mockClear();
  vi.mocked(logSharedTripVisit).mockClear();
  vi.mocked(madeThisShareLink).mockReset().mockResolvedValue(false);
  row = ROW;
  request.headers = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "sec-fetch-dest": "document" };
  request.cookies = { mt_anon_voter: "voter-cookie-1" };
});

describe("a recipient's visit, in PostHog", () => {
  it("is counted under the trip's id", async () => {
    await visit();
    expect(captureServerEvent).toHaveBeenCalledExactlyOnceWith("voter-cookie-1", "crew_link_visited", {
      trip_id: "trip-1",
      visitor_scope: "cookie",
      crew_ask: false,
    });
  });

  it("never carries the link's token, for a visitor without a cookie either", async () => {
    for (const cookies of [{ mt_anon_voter: "voter-cookie-1" }, {}] as Array<Record<string, string>>) {
      request.cookies = cookies;
      await visit();
    }
    expect(captureServerEvent).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(vi.mocked(captureServerEvent).mock.calls)).not.toContain(TOKEN);
  });
});

// Most links come from planners with no account: their trip has no owner, only the claim their browser holds.
describe("a visit to a trip a signed-out planner shared", () => {
  const SIGNED_OUT_SHARE = { ...ROW, user_id: null, claim_token: "a-claim", visibility: "private" };

  it("is counted in both places when a friend opens it", async () => {
    row = SIGNED_OUT_SHARE;
    await visit();
    expect(madeThisShareLink).toHaveBeenCalledExactlyOnceWith("trip-1");
    expect(logSharedTripVisit).toHaveBeenCalledExactlyOnceWith("trip-1", { crewAsk: false, day: null });
    expect(captureServerEvent).toHaveBeenCalledExactlyOnceWith("voter-cookie-1", "crew_link_visited", {
      trip_id: "trip-1",
      visitor_scope: "cookie",
      crew_ask: false,
    });
  });

  it("is not a visit when the browser that made the link opens it", async () => {
    row = SIGNED_OUT_SHARE;
    vi.mocked(madeThisShareLink).mockResolvedValue(true);
    await visit();
    expect(logSharedTripVisit).not.toHaveBeenCalled();
    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("leaves the demo trips, which nobody shared, uncounted, without a read", async () => {
    row = { ...ROW, user_id: null, claim_token: null };
    await visit();
    expect(madeThisShareLink).not.toHaveBeenCalled();
    expect(logSharedTripVisit).not.toHaveBeenCalled();
    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("asks nothing more of an owned trip: its owner is told apart by their account", async () => {
    await visit();
    expect(madeThisShareLink).not.toHaveBeenCalled();
    expect(logSharedTripVisit).toHaveBeenCalledExactlyOnceWith("trip-1", { crewAsk: false, day: null });
  });

  it("doesn't count a crawler on a signed-out planner's trip, and doesn't read for it", async () => {
    row = SIGNED_OUT_SHARE;
    request.headers = { "user-agent": "facebookexternalhit/1.1" };
    await visit();
    expect(madeThisShareLink).not.toHaveBeenCalled();
    expect(logSharedTripVisit).not.toHaveBeenCalled();
  });
});
