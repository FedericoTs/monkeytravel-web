// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Who gets the trip editor at /trips/[id].
 *
 * Until 2026-09-25 the share-link redirect ran first, for everyone: once a
 * trip had a share_token its owner and collaborators were sent to the
 * read-only /shared view on every visit and could never edit it again (109
 * live trips). Members now always get the editor; only non-members follow the
 * share link, and only when RLS lets them see the token (public trips). The
 * real page runs against a fake Supabase that applies the same visibility.
 */

const TRIP = "trip-1";
const OWNER = "owner-1";
const TOKEN = "tok-abc";

class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new NotFound("not found");
  },
}));
vi.mock("./TripDetailClient", () => ({ default: () => null }));
vi.mock("@/components/explore/TripEngagementSection", () => ({ default: () => null }));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshTripItinerary: async (x: unknown) => x }));
vi.mock("@/lib/explore/flag", () => ({ isExploreUgcEnabled: () => false }));

type World = {
  user: string | null;
  collaborators: Record<string, string>; // user id -> role
  shareToken: string | null;
  visibility: "private" | "public";
  isHidden?: boolean;
};
let world: World;

const trip = () => ({
  id: TRIP,
  user_id: OWNER,
  title: "Lisbon Trip",
  start_date: "2026-10-01",
  end_date: "2026-10-03",
  itinerary: [],
  trip_meta: {},
  share_token: world.shareToken,
  visibility: world.visibility,
  is_hidden: world.isHidden ?? false,
});

// RLS on trips since 20260901090000: members see the row; anyone sees a
// public trip; nobody else sees it at all.
const canSee = () =>
  world.user === OWNER ||
  (world.user !== null && world.user in world.collaborators) ||
  world.visibility === "public";

function fakeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: world.user ? { id: world.user, email: "a@test.local" } : null } }) },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let head = false;
      const q = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          head = !!opts?.head;
          return q;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => {
          if (table === "trips") {
            if (!canSee()) return { data: null, error: null };
            if ("user_id" in filters && filters.user_id !== OWNER) return { data: null, error: null };
            return { data: trip(), error: null };
          }
          // trip_collaborators: the caller's own membership row, with the trip.
          const role = world.collaborators[String(filters.user_id)];
          return { data: role ? { role, trips: trip() } : null, error: null };
        },
        // .single() (the pre-2026-09-25 page) answers PGRST116 for no row.
        single: async () => {
          const r = await q.maybeSingle();
          return r.data ? r : { data: null, error: { code: "PGRST116" } };
        },
        // The collaborator count query is awaited on the builder itself.
        then: (resolve: (v: unknown) => void) =>
          resolve(head ? { count: Object.keys(world.collaborators).length, error: null } : { data: [], error: null }),
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));

async function visit(locale = "en") {
  const { default: TripDetailPage } = await import("./page");
  try {
    const el = (await TripDetailPage({ params: Promise.resolve({ id: TRIP, locale }) })) as {
      props: { userRole: string };
    };
    return { editor: el.props.userRole };
  } catch (e) {
    if (e instanceof Redirect) return { redirect: e.url };
    if (e instanceof NotFound) return { notFound: true };
    throw e;
  }
}

beforeEach(() => {
  world = { user: null, collaborators: {}, shareToken: TOKEN, visibility: "private" };
});

describe("members always get the editor, shared or not", () => {
  it("the owner of a shared trip gets the editor, not the read-only view", async () => {
    world.user = OWNER;
    expect(await visit()).toEqual({ editor: "owner" });
  });

  it("the owner of a published (public) trip gets the editor", async () => {
    world.user = OWNER;
    world.visibility = "public";
    expect(await visit("it")).toEqual({ editor: "owner" });
  });

  it("an invited editor of a shared trip gets the editor with their role", async () => {
    world.user = "mate-1";
    world.collaborators = { "mate-1": "editor" };
    expect(await visit()).toEqual({ editor: "editor" });
  });

  it("an invited voter gets the trip page with the voter role", async () => {
    world.user = "mate-2";
    world.collaborators = { "mate-2": "voter" };
    expect(await visit()).toEqual({ editor: "voter" });
  });
});

describe("non-members", () => {
  it("a signed-in stranger on a public trip follows the share link, keeping the locale", async () => {
    world.user = "stranger";
    world.visibility = "public";
    expect(await visit("es")).toEqual({ redirect: `/es/shared/${TOKEN}` });
  });

  it("a signed-out visitor on a public trip follows the share link", async () => {
    world.visibility = "public";
    expect(await visit()).toEqual({ redirect: `/shared/${TOKEN}` });
  });

  it("a signed-out visitor on a private trip is sent to sign in and back to this trip", async () => {
    // The language on the login page, the destination unprefixed: the login
    // page's router adds the language, so a prefixed one became /it/it/...
    expect(await visit("it")).toEqual({
      redirect: `/it/auth/login?redirect=${encodeURIComponent(`/trips/${TRIP}`)}`,
    });
    expect(await visit("en")).toEqual({
      redirect: `/auth/login?redirect=${encodeURIComponent(`/trips/${TRIP}`)}`,
    });
  });

  it("a signed-in stranger on a private trip gets a 404 (the token stays hidden)", async () => {
    world.user = "stranger";
    expect(await visit()).toEqual({ notFound: true });
  });

  it("a hidden public trip is not redirected to its share link", async () => {
    world.user = "stranger";
    world.visibility = "public";
    world.isHidden = true;
    expect(await visit()).toEqual({ notFound: true });
  });

  it("a public trip without a share link is a 404 for strangers", async () => {
    world.user = "stranger";
    world.visibility = "public";
    world.shareToken = null;
    expect(await visit()).toEqual({ notFound: true });
  });
});
