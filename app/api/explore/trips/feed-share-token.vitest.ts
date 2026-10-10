// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The Explore feed is public: its cards link to the public trip page by slug,
 * and nothing it returns carries a share token, which opens the trip's private
 * group page (joining, votes, shared expenses). anon and authenticated may not
 * select the column, so the query must neither read nor filter on it.
 */

const TOKEN = "11111111-2222-4333-8444-555555555555";
const SLUG = "lisbon-trip-abc123";

// A stored row, share token included: whatever the route selects, the
// response may not carry it.
const ROW = {
  id: "trip-1",
  parent_trip_id: null,
  title: "Lisbon Trip",
  description: "Three days of trams and tiles",
  start_date: "2026-10-09",
  end_date: "2026-10-11",
  tags: ["food"],
  cover_image_url: null,
  shared_at: "2026-10-01T00:00:00Z",
  public_slug: SLUG,
  user_id: "owner-1",
  trending_score: 120,
  view_count: 3,
  template_copy_count: 0,
  trip_meta: { destination: "Lisbon", country_code: "PT" },
  like_count: 2,
  save_count: 1,
  fork_count: 0,
  author_display_name: "Ana",
  author_note: null,
  is_editors_pick: false,
  travel_style: "classic",
  share_token: TOKEN,
};

let ugcOn = true;
// The code ships before the migration: both worlds must hold.
let grantApplied = true;
const selects: string[] = [];
const filters: unknown[][] = [];

vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => ugcOn }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: [{ id: "owner-1", username: "ana", privacy_settings: {} }] }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      let refused = false;
      const record = (name: string) => (...args: unknown[]) => {
        filters.push([name, ...args]);
        if (grantApplied && args.some((a) => typeof a === "string" && a.includes("share_token"))) refused = true;
        return q;
      };
      const q = {
        select: (cols: string) => {
          selects.push(cols);
          if (grantApplied && (cols === "*" || cols.includes("share_token"))) refused = true;
          return q;
        },
        eq: record("eq"),
        not: record("not"),
        or: record("or"),
        contains: record("contains"),
        order: () => q,
        limit: () => q,
        // The column grant refuses share_token to anon and authenticated.
        then: (resolve: (v: unknown) => void) =>
          resolve(
            refused
              ? { data: null, error: { code: "42501", message: "permission denied for table trips" } }
              : { data: [{ ...ROW }], error: null },
          ),
      };
      return q;
    },
  }),
}));

const { GET } = await import("./route");

async function feed() {
  const res = await GET(new NextRequest("https://monkeytravel.app/api/explore/trips"));
  const raw = (await res.json()) as Record<string, unknown> & { data?: Record<string, unknown> };
  return { status: res.status, body: (raw.data ?? raw) as { trips: Array<Record<string, unknown>> } };
}

beforeEach(() => {
  selects.length = 0;
  filters.length = 0;
});

describe.each([
  [true, true],
  [false, true],
  [true, false],
])("the Explore feed (UGC columns %s, column grant applied %s)", (on, applied) => {
  beforeEach(() => {
    ugcOn = on;
    grantApplied = applied;
  });

  it("answers without a share token anywhere in the response", async () => {
    const { status, body } = await feed();
    expect(status).toBe(200);
    expect(body.trips).toHaveLength(1);
    expect(body.trips[0]).not.toHaveProperty("shareToken");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("links each card to the public page by slug", async () => {
    const { body } = await feed();
    expect(body.trips[0].publicSlug).toBe(SLUG);
  });

  it("neither selects nor filters on the share token, and lists only trips with a public page", async () => {
    await feed();
    expect(selects).toHaveLength(1);
    expect(selects[0]).not.toContain("share_token");
    expect(JSON.stringify(filters)).not.toContain("share_token");
    expect(filters).toContainEqual(["not", "public_slug", "is", null]);
  });
});
