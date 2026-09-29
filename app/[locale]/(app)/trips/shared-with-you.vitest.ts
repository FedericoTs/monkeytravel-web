// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * My Trips lists the trips other people invited this user to.
 *
 * Until 2026-09-25 they appeared nowhere: after accepting an invite, the only
 * way back to the trip was the original link or a notification.
 */

const ME = "me-1";
const collabFilters: Array<[string, string, unknown]> = [];
let collabRows: Array<{ role: string; trips: Record<string, unknown> | null }>;

const tripRow = (id: string, start: string, deleted: string | null = null) => ({
  id,
  title: `Trip ${id}`,
  start_date: start,
  end_date: start,
  cover_image_url: null,
  deleted_at: deleted,
});

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: ME, email: "me@test.local" } } }) },
    from(table: string) {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          if (table === "trip_collaborators") collabFilters.push(["eq", c, v]);
          return q;
        },
        neq: (c: string, v: unknown) => {
          if (table === "trip_collaborators") collabFilters.push(["neq", c, v]);
          return q;
        },
        or: () => q,
        order: () => q,
        single: async () => ({ data: { display_name: "Me", lifetime_referral_conversions: 0 }, error: null }),
        then: (resolve: (v: unknown) => void) =>
          resolve(
            table === "trip_collaborators"
              ? { data: collabRows, error: null }
              : { data: [{ id: "mine-1", title: "My own trip" }], error: null }
          ),
      };
      return q;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("@/components/trips/TripsPageClient", () => ({ default: () => null }));
vi.mock("@/lib/blog/api", () => ({ getAllFrontmatter: () => [] }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));

async function renderProps() {
  const { default: TripsPage } = await import("./page");
  const el = (await TripsPage({ params: Promise.resolve({ locale: "en" }) })) as {
    props: { trips: unknown[]; sharedTrips: Array<Record<string, unknown>> };
  };
  return el.props;
}

beforeEach(() => {
  collabFilters.length = 0;
  collabRows = [];
});

describe("Shared with you", () => {
  it("asks only for this user's memberships that are not ownership", async () => {
    await renderProps();
    expect(collabFilters).toEqual([
      ["eq", "user_id", ME],
      ["neq", "role", "owner"],
    ]);
  });

  it("lists invited trips with the role, newest start first, without deleted ones", async () => {
    collabRows = [
      { role: "voter", trips: tripRow("a", "2026-10-01") },
      { role: "editor", trips: tripRow("b", "2026-12-01") },
      { role: "editor", trips: tripRow("gone", "2026-11-01", "2026-09-01T00:00:00Z") },
      { role: "viewer", trips: null }, // a trip RLS no longer shows
    ];
    const { trips, sharedTrips } = await renderProps();
    expect(trips).toHaveLength(1); // the user's own trips are untouched
    expect(sharedTrips.map((t) => [t.id, t.role])).toEqual([
      ["b", "editor"],
      ["a", "voter"],
    ]);
    expect(sharedTrips[0]).toEqual({
      id: "b",
      title: "Trip b",
      start_date: "2026-12-01",
      end_date: "2026-12-01",
      cover_image_url: undefined,
      role: "editor",
    });
  });

  it("an empty list when the user was invited nowhere", async () => {
    const { sharedTrips } = await renderProps();
    expect(sharedTrips).toEqual([]);
  });
});
