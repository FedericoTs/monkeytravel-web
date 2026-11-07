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

vi.mock("next/headers", () => ({
  headers: async () => new Headers(request.headers),
  cookies: async () => ({ get: (name: string) => (name in request.cookies ? { value: request.cookies[name] } : undefined) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q = { select: () => q, eq: () => q, is: () => q, single: async () => ({ data: { ...ROW }, error: null }) };
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
vi.mock("@/lib/analytics/funnel-events", () => ({ logSharedTripVisit: vi.fn(async () => {}) }));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: vi.fn(async () => {}) }));

const { default: SharedTripPage } = await import("./page");
const { captureServerEvent } = await import("@/lib/posthog/server");

async function visit() {
  await SharedTripPage({ params: Promise.resolve({ locale: "en", token: TOKEN }), searchParams: Promise.resolve({}) });
  // The capture runs after the render, without holding it up.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.mocked(captureServerEvent).mockClear();
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
