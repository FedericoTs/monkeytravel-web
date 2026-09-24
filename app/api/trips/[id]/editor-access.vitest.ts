// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Who may PATCH a trip.
 *
 * Until 2026-09-24 this was owner-only while the trip page showed invited
 * editors an "Edit trip" button, so an editor's Save answered 404 "Trip not
 * found" (seen in production that morning). Editors may now save the trip's
 * content. Dates, status and the reminders mute stay with the owner, and the
 * reminder cascade is always re-planned for the OWNER: given anyone else's id,
 * enqueue_trip_notifications finds no trip and wipes the owner's schedule.
 * The real verifyTripAccess runs against a fake Supabase.
 */

const OWNER = "owner-1";
const TRIP = "trip-1";

const scheduleTripNotifications = vi.fn();
vi.mock("@/lib/notifications/scheduling", () => ({
  scheduleTripNotifications: (...a: unknown[]) => scheduleTripNotifications(...a),
}));
vi.mock("@/lib/places/refreshItineraryPhotos", () => ({ refreshItineraryPhotos: async (x: unknown) => x }));

type World = {
  caller: string;
  role: string | null; // the caller's trip_collaborators.role, null if none
  tripVisible: boolean; // whether RLS lets the caller see the trip at all
  updateError?: { code: string; message?: string } | null;
};
let world: World;
const updates: Array<{ values: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "trip_collaborators") {
        const q = {
          select: () => q,
          eq: () => q,
          single: async () => ({ data: world.role ? { role: world.role } : null, error: null }),
        };
        return q;
      }
      if (table === "trips") {
        return {
          select: () => {
            const q = {
              eq: () => q,
              single: async () =>
                world.tripVisible
                  ? { data: { id: TRIP, user_id: OWNER }, error: null }
                  : { data: null, error: { code: "PGRST116" } },
            };
            return q;
          },
          update: (values: Record<string, unknown>) => {
            const call = { values, filters: [] as Array<[string, unknown]> };
            updates.push(call);
            const q = {
              eq: (col: string, val: unknown) => {
                call.filters.push([col, val]);
                return q;
              },
              select: () => q,
              single: async () =>
                world.updateError
                  ? { data: null, error: world.updateError }
                  : { data: { id: TRIP, user_id: OWNER, ...values }, error: null },
            };
            return q;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return {
    ...actual,
    getAuthenticatedUser: async () => ({
      user: { id: world.caller },
      supabase: fakeSupabase(),
      errorResponse: null,
    }),
  };
});

import { PATCH } from "./route";

async function patch(body: Record<string, unknown>) {
  const req = new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return PATCH(req, { params: Promise.resolve({ id: TRIP }) } as never);
}

const itinerary = [{ day_number: 1, activities: [{ id: "a1", name: "Museum" }] }];

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  world = { caller: "editor-1", role: "editor", tripVisible: true, updateError: null };
});

describe("an invited editor", () => {
  it("can save the itinerary (the Save that 404'd)", async () => {
    const res = await patch({ itinerary });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].values.itinerary).toBeDefined();
    // Filtered by id only: RLS decides owner-or-editor, not a user_id match.
    expect(updates[0].filters).toEqual([["id", TRIP]]);
  });

  it("can change the trip's content fields", async () => {
    const res = await patch({ title: "T", description: "D", tags: ["x"], budget: { total: 1 }, cover_image_url: "https://x/y.jpg" });
    expect(res.status).toBe(200);
    expect(updates[0].values).toMatchObject({ title: "T", description: "D", tags: ["x"], cover_image_url: "https://x/y.jpg" });
  });

  it.each([
    ["status", { status: "confirmed" }],
    ["start_date", { start_date: "2027-01-01" }],
    ["end_date", { end_date: "2027-01-05" }],
    ["reminders_muted", { reminders_muted: true }],
  ])("is refused %s with a 403, and nothing is written or re-planned", async (_f, body) => {
    const res = await patch({ itinerary, ...body });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
    expect(scheduleTripNotifications).not.toHaveBeenCalled();
  });

  it("gets a 403, not a 500, when the policy refuses the write mid-request", async () => {
    world.updateError = { code: "PGRST116", message: "0 rows" };
    const res = await patch({ itinerary });
    expect(res.status).toBe(403);
  });
});

describe("everyone else who is not the owner", () => {
  it.each(["voter", "viewer"])("a %s gets 403", async (role) => {
    world.role = role;
    const res = await patch({ itinerary });
    expect(res.status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("a non-member who can see the trip (public) gets 403", async () => {
    world.role = null;
    expect((await patch({ itinerary })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("a trip the caller cannot see gets 404", async () => {
    world.role = null;
    world.tripVisible = false;
    expect((await patch({ itinerary })).status).toBe(404);
  });
});

describe("the owner", () => {
  beforeEach(() => {
    world.caller = OWNER;
    world.role = null;
  });

  it("still saves the itinerary and status", async () => {
    expect((await patch({ itinerary })).status).toBe(200);
    expect((await patch({ status: "confirmed" })).status).toBe(200);
    expect(updates[1].values.status).toBe("confirmed");
  });

  it("re-plans reminders for the owner when the dates move", async () => {
    const res = await patch({ start_date: "2027-01-01", end_date: "2027-01-05" });
    expect(res.status).toBe(200);
    expect(scheduleTripNotifications).toHaveBeenCalledTimes(1);
    expect(scheduleTripNotifications).toHaveBeenCalledWith({ tripId: TRIP, userId: OWNER });
  });
});
