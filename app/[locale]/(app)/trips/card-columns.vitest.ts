// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { TRIP_CARD_COLUMNS, TRIP_COLUMNS } from "@/lib/trips/columns";

/**
 * My Trips serializes the selected trip rows into the page for the cards.
 * Selecting whole rows shipped every trip's itinerary to the browser unread,
 * so the page selects only what the cards read (TripsPageClient's Trip type).
 */

const ME = "me-1";
const token = `h.${Buffer.from(JSON.stringify({ sub: ME })).toString("base64url")}.sig`;
const selected: Record<string, string> = {};
const tripFilters: string[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getSession: async () => ({ data: { session: { access_token: token } } }),
      getUser: async () => ({ data: { user: { id: ME, email: "me@test.local" } } }),
    },
    from(table: string) {
      const q = {
        select: (columns: string) => {
          selected[table] = columns;
          return q;
        },
        eq: () => q,
        neq: () => q,
        or: (filter: string) => {
          if (table === "trips") tripFilters.push(filter);
          return q;
        },
        order: () => q,
        single: async () => ({ data: { display_name: "Me", lifetime_referral_conversions: 0 }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return q;
    },
  })),
}));
let visitorZone: string | null = null;
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers(visitorZone ? { "x-vercel-ip-timezone": visitorZone } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/components/trips/TripsPageClient", () => ({ default: () => null }));
vi.mock("@/lib/blog/api", () => ({ getAllFrontmatter: () => [] }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

const columns = (list: string) => list.split(",").map((c) => c.trim()).filter(Boolean);

// Every field TripsPageClient's Trip type declares.
const CARD_FIELDS = ["id", "title", "description", "start_date", "end_date", "status", "cover_image_url", "created_at", "is_archived"];

describe("My Trips selects only what the cards read", () => {
  it("asks for the card columns, without the itinerary or trip_meta", async () => {
    const { default: TripsPage } = await import("./page");
    await TripsPage({ params: Promise.resolve({ locale: "en" }) });

    expect(selected.trips).toBe(TRIP_CARD_COLUMNS);
    // Archived trips too: the page lists them under their own heading.
    expect(tripFilters).toEqual([]);
    expect(columns(selected.trips).sort()).toEqual([...CARD_FIELDS].sort());
    expect(columns(selected.trips)).not.toContain("itinerary");
    expect(columns(selected.trips)).not.toContain("trip_meta");
  });

  it("selects only columns the signed-in role is granted", () => {
    const granted = new Set(columns(TRIP_COLUMNS));
    for (const c of columns(TRIP_CARD_COLUMNS)) expect(granted).toContain(c);
  });
});

describe("My Trips tells the cards the visitor's day", () => {
  afterEach(() => {
    visitorZone = null;
    vi.useRealTimers();
  });

  const serverToday = async () => {
    const { default: TripsPage } = await import("./page");
    return (await TripsPage({ params: Promise.resolve({ locale: "en" }) })).props.serverToday;
  };

  it("from where the request came from", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
    visitorZone = "America/Chicago";
    expect(await serverToday()).toBe("2026-11-05");
    visitorZone = "Asia/Tokyo";
    expect(await serverToday()).toBe("2026-11-06");
  });

  it("in UTC when that's missing or isn't a time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
    expect(await serverToday()).toBe("2026-11-06");
    visitorZone = "Not/AZone";
    expect(await serverToday()).toBe("2026-11-06");
  });
});
