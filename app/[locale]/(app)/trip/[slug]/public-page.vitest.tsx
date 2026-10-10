// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement } from "react";

/**
 * The public trip page is open to anyone, so the share token, which is the
 * share link's access to the group, must not reach anything it renders: the
 * view's props, the JSON-LD or the metadata. The page is rendered on the
 * server here and every string in the result is searched for the token.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";

// A row as select("*") returns it, share token included: whatever the page
// selects, nothing it renders may carry the token.
const ROW = {
  id: "trip-1",
  user_id: "owner-1",
  title: "Lisbon Trip",
  description: "Three days of trams and tiles",
  status: "planning",
  start_date: "2026-10-09",
  end_date: "2026-10-11",
  tags: ["food"],
  budget: { total: 500, currency: "EUR" },
  itinerary: [
    {
      day_number: 1,
      date: "2026-10-09",
      theme: "Alfama",
      activities: [{ id: "a1", name: "Tram 28", type: "attraction", start_time: "09:00", duration_minutes: 60, description: "", location: "Alfama" }],
    },
  ],
  trip_meta: { destination: "Lisbon", locale: "en", timezone: "Europe/Lisbon" },
  packing_list: [],
  cover_image_url: null,
  shared_at: "2026-10-01T00:00:00Z",
  visibility: "public",
  is_hidden: false,
  public_slug: SLUG,
  like_count: 1,
  save_count: 0,
  fork_count: 0,
  deleted_at: null,
  share_token: TOKEN,
};

const selects: Record<string, string[]> = {};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = {
        select: (cols: string) => {
          (selects[table] ??= []).push(cols);
          return q;
        },
        eq: () => q,
        is: () => q,
        maybeSingle: async () =>
          table === "trips"
            ? { data: { ...ROW }, error: null }
            : { data: { username: "traveller", display_name: "Traveller", avatar_url: null, bio: null, privacy_settings: {} }, error: null },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ signedInUserId: async () => null }));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshTripItinerary: async (days: unknown) => days }));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => {},
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("../../shared/[token]/SharedTripView", () => ({ default: function SharedTripView() { return null; } }));
vi.mock("@/components/explore/TripEngagementSection", () => ({ default: function TripEngagementSection() { return null; } }));

const { default: PublicTripPage, generateMetadata } = await import("./page");
const params = Promise.resolve({ locale: "en", slug: SLUG });

/** Every string reachable from a rendered tree: element props, nested elements, objects, arrays. */
function strings(node: unknown, seen = new Set<unknown>()): string[] {
  if (typeof node === "string") return [node];
  if (node === null || typeof node !== "object" || seen.has(node)) return [];
  seen.add(node);
  if (isValidElement(node)) return strings(node.props, seen);
  return Object.values(node as Record<string, unknown>).flatMap((value) => strings(value, seen));
}

function findView(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) return node.map(findView).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (typeof node.type === "function" && node.type.name === "SharedTripView") return props;
  return findView(props.children);
}

beforeEach(() => {
  for (const key of Object.keys(selects)) delete selects[key];
});

describe("the public trip page holds no share token", () => {
  it("reads only public-safe trip columns", async () => {
    await PublicTripPage({ params });
    expect(selects.trips).toHaveLength(1);
    expect(selects.trips[0]).not.toBe("*");
    expect(selects.trips[0].split(",").map((c) => c.trim())).not.toContain("share_token");
  });

  it("renders the view read-only, sharing and saving by the public slug", async () => {
    const view = findView(await PublicTripPage({ params }));
    expect(view).not.toBeNull();
    expect(view).not.toHaveProperty("shareToken");
    expect(view!.publicPage).toEqual({ slug: SLUG, url: `https://monkeytravel.app/trip/${SLUG}` });
  });

  it("puts the token nowhere in what it renders", async () => {
    const found = strings(await PublicTripPage({ params })).filter((s) => s.includes(TOKEN));
    expect(found).toEqual([]);
  });

  it("puts the token nowhere in its metadata", async () => {
    const metadata = await generateMetadata({ params });
    expect(JSON.stringify(metadata)).not.toContain(TOKEN);
  });
});
