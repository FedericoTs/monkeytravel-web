// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Stale itinerary saves (20260924125000).
 *
 * The trip page saved the whole itinerary from its own copy with no check, so
 * an owner and an editor (or two tabs) silently overwrote each other. A save
 * now carries baseItineraryVersion; the write only lands if the stored
 * version is still that one, and otherwise answers 409 with the current
 * itinerary so the tab can choose. A fake Supabase stands in for PostgREST.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

const refreshItineraryPhotos = vi.fn(async (x: unknown) => x);
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshItineraryPhotos: (x: unknown) => refreshItineraryPhotos(x) }));
vi.mock("@/lib/notifications/scheduling", () => ({ scheduleTripNotifications: vi.fn() }));

type Stored = { itinerary: unknown[]; itinerary_version: number };
let stored: Stored;
let caller = OWNER;
let role: string | null = null;
let rlsRefuses = false;
let hideOnReread = false;
const writes: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
const reads: string[] = [];

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: role ? { role } : null, error: null }) };
        return q;
      }
      return {
        select: (cols: string) => {
          reads.push(cols);
          const q = {
            eq: () => q,
            single: async () => ({ data: { id: TRIP, user_id: OWNER }, error: null }),
            maybeSingle: async () => (hideOnReread ? { data: null, error: null } : { data: { ...stored }, error: null }),
          };
          return q;
        },
        update: (values: Record<string, unknown>) => {
          const call = { values, filters: [] as Array<[string, unknown]> };
          writes.push(call);
          const q = {
            eq: (c: string, v: unknown) => {
              call.filters.push([c, v]);
              return q;
            },
            select: () => q,
            single: async () => {
              const base = call.filters.find(([c]) => c === "itinerary_version");
              if (rlsRefuses || (base && base[1] !== stored.itinerary_version)) {
                return { data: null, error: { code: "PGRST116", message: "0 rows" } };
              }
              if ("itinerary" in values) {
                stored = { itinerary: values.itinerary as unknown[], itinerary_version: stored.itinerary_version + 1 };
              }
              return { data: { id: TRIP, user_id: OWNER, ...values, itinerary_version: stored.itinerary_version }, error: null };
            },
          };
          return q;
        },
      };
    },
  };
}

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    getAuthenticatedUser: async () => ({ user: { id: caller }, supabase: fakeSupabase(), errorResponse: null }),
  };
});

import { PATCH } from "./route";

const theirs = [{ day_number: 1, activities: [{ id: "a1", name: "Their edit" }] }];
const mine = [{ day_number: 1, activities: [{ id: "a1", name: "My edit" }] }];

async function patch(body: Record<string, unknown>) {
  const res = await PATCH(
    new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: TRIP }) } as never
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = { itinerary: theirs, itinerary_version: 4 };
  caller = OWNER;
  role = null;
  rlsRefuses = false;
  hideOnReread = false;
  writes.length = 0;
  reads.length = 0;
});

describe("a save that carries the version it was based on", () => {
  it("lands when nothing changed in between, and returns the new version", async () => {
    const r = await patch({ itinerary: mine, baseItineraryVersion: 4 });
    expect(r.status).toBe(200);
    expect(writes[0].filters).toEqual([["id", TRIP], ["itinerary_version", 4]]);
    expect(r.body.trip.itinerary_version).toBe(5);
  });

  it("works for an invited editor too", async () => {
    caller = "editor-1";
    role = "editor";
    expect((await patch({ itinerary: mine, baseItineraryVersion: 4 })).status).toBe(200);
  });

  it("is refused with 409 and the CURRENT itinerary when someone saved first", async () => {
    const r = await patch({ itinerary: mine, baseItineraryVersion: 3 });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "ITINERARY_CONFLICT", itinerary: theirs, itineraryVersion: 4 });
    // Nothing was overwritten.
    expect(stored.itinerary).toEqual(theirs);
    // The current copy goes through the same photo refresh as GET.
    expect(refreshItineraryPhotos).toHaveBeenCalled();
  });

  it("is still a 403 when the write was refused for another reason (same version)", async () => {
    caller = "editor-1";
    role = "editor";
    rlsRefuses = true;
    expect((await patch({ itinerary: mine, baseItineraryVersion: 4 })).status).toBe(403);
  });

  it("is a 403 when the trip is no longer visible on the re-read", async () => {
    rlsRefuses = true;
    hideOnReread = true;
    expect((await patch({ itinerary: mine, baseItineraryVersion: 4 })).status).toBe(403);
  });

  it.each([["4"], [-1], [1.5]])("rejects a malformed base (%s) without writing", async (base) => {
    expect((await patch({ itinerary: mine, baseItineraryVersion: base })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

describe("photos enriched after the page loaded", () => {
  it("a save from that page keeps the stored place photo instead of its stale fallback", async () => {
    stored = { itinerary: [{ day_number: 1, activities: [{ id: "a1", name: "Their edit", image_url: "/api/places/photo?ref=x" }] }], itinerary_version: 4 };
    const stale = [{ day_number: 1, activities: [{ id: "a1", name: "Their edit", image_url: "https://images.example/curated.jpg", start_time: "10:00" }] }];
    const r = await patch({ itinerary: stale, baseItineraryVersion: 4 });
    expect(r.status).toBe(200);
    const written = writes[0].values.itinerary as Array<{ activities: Array<{ image_url: string; start_time: string }> }>;
    expect(written[0].activities[0]).toMatchObject({ image_url: "/api/places/photo?ref=x", start_time: "10:00" });
  });
});

describe("saves without a version", () => {
  it("an itinerary from a tab opened before this shipped: last-write-wins as before", async () => {
    const r = await patch({ itinerary: mine });
    expect(r.status).toBe(200);
    expect(writes[0].filters).toEqual([["id", TRIP]]);
  });

  it("a title-only save never gets a version filter", async () => {
    expect((await patch({ title: "New title", baseItineraryVersion: 4 })).status).toBe(200);
    expect(writes[0].filters).toEqual([["id", TRIP]]);
  });
});

describe("not members", () => {
  it("a voter is refused before any read of the itinerary", async () => {
    caller = "voter-1";
    role = "voter";
    expect((await patch({ itinerary: mine, baseItineraryVersion: 4 })).status).toBe(403);
    expect(reads.filter((c) => c.includes("itinerary"))).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });
});
