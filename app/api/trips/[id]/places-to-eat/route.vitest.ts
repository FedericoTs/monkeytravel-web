/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The owner's first open of a kept trip looks its places to eat up, once: for
 * the trip's diet, else the owner's profile's, else none, and only while the
 * check is due. The page gets the changes stored, to make on its own copy, and
 * what to say of them.
 */

const CHANGES = [{ day: 1, id: "a1", name: "Dinner at Arkhe", to: { id: "act_new", name: "Plant Base", type: "restaurant" } }];
const RESULT = { checked: 3, closed: 1, missing: 0, replaced: 1, dropped: 0, kept: 0, unanswered: 0, costUsd: 0.0004, changes: CHANGES };
const NOTE = { checkedAt: "2026-11-06T18:00:00.000Z", checked: 3, changed: 1 };

let trip: Record<string, unknown>;
let preferences: unknown;
let authError: Response | null;
let allowed: boolean;
let access: { allowed: boolean };
const log = vi.fn();
const check = vi.fn();
const capture = vi.fn(async (_user: string, _event: string, _props: Record<string, unknown>) => {});

const db = {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => (table === "users" ? { data: { preferences }, error: null } : { data: null, error: null }),
    };
    return q;
  },
};

vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () =>
    authError ? { user: null, supabase: null, errorResponse: authError } : { user: { id: "owner-1" }, supabase: db, errorResponse: null },
  verifyTripOwnership: async () => ({ trip, errorResponse: null }),
}));
vi.mock("@/lib/api/rate-limit", () => ({ createRateLimiter: () => ({ check: async () => ({ allowed, remaining: 0 }) }) }));
vi.mock("@/lib/places/check-kept-trip", () => ({ checkKeptTripPlacesToEat: (...args: unknown[]) => check(...args) }));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => access,
  blockedCall: async () => new Response(null, { status: 503 }),
  logApiCall: (...args: unknown[]) => log(...args),
}));
vi.mock("@/lib/posthog/server", () => ({ captureServerEvent: (...args: [string, string, Record<string, unknown>]) => capture(...args) }));

import { POST } from "./route";

const run = () =>
  POST(new NextRequest("https://monkeytravel.app/api/trips/trip-1/places-to-eat", { method: "POST" }), {
    params: Promise.resolve({ id: "trip-1" }),
  });

beforeEach(() => {
  check.mockReset().mockResolvedValue({ status: "checked", changes: CHANGES, fromVersion: 4, itineraryVersion: 5, result: RESULT, note: NOTE });
  capture.mockClear();
  authError = null;
  allowed = true;
  access = { allowed: true };
  log.mockClear();
  preferences = {};
  trip = {
    id: "trip-1",
    user_id: "owner-1",
    title: "Lisbon Trip",
    itinerary: [{ day_number: 1, activities: [] }],
    itinerary_version: 4,
    trip_meta: { destination: "Lisbon, Portugal", dietary: ["vegan"] },
    budget: { tier: "balanced" },
    end_date: "2099-01-10",
  };
});

describe("places-to-eat on a kept trip's first open", () => {
  it("looks a due trip's places up for its diet, and answers the changes stored", async () => {
    const res = await run();

    expect(await res.json()).toEqual({ status: "checked", changes: CHANGES, fromVersion: 4, itineraryVersion: 5, note: NOTE });
    expect(check).toHaveBeenCalledWith(
      db,
      {
        id: "trip-1",
        user_id: "owner-1",
        title: "Lisbon Trip",
        itinerary: trip.itinerary,
        itinerary_version: 4,
        trip_meta: trip.trip_meta,
        budget: trip.budget,
      },
      ["vegan"]
    );
  });

  it("takes the owner's profile's diet when the planner asked for none", async () => {
    trip.trip_meta = { destination: "Lisbon, Portugal" };
    preferences = { dietaryPreferences: ["halal"] };

    await run();

    expect(check.mock.calls[0][2]).toEqual(["halal"]);
  });

  it("looks a trip with no diet up too", async () => {
    trip.trip_meta = { destination: "Lisbon, Portugal" };

    await run();

    expect(check.mock.calls[0][2]).toEqual([]);
    expect(capture.mock.calls[0][2]).toMatchObject({ has_diet: false });
  });

  it("looks nothing up for a trip already checked, or over", async () => {
    for (const change of [
      () => (trip.trip_meta = { dietary: ["vegan"], places_to_eat_checked_at: "2026-11-04T10:00:00.000Z" }),
      () => (trip.end_date = "2020-01-10"),
    ]) {
      const saved = { ...trip };
      change();
      const res = await run();
      expect(await res.json()).toEqual({ status: "none" });
      trip = saved;
    }
    expect(check).not.toHaveBeenCalled();
  });

  it("records what the check found and did", async () => {
    await run();

    expect(capture).toHaveBeenCalledWith("owner-1", "places_to_eat_checked", {
      trip_id: "trip-1",
      stored: true,
      has_diet: true,
      checked: 3,
      closed: 1,
      missing: 0,
      replaced: 1,
      dropped: 0,
      kept: 0,
      unanswered: 0,
      cost_usd: 0.0004,
    });
  });

  it("answers none when nothing was stored, and says so in the record", async () => {
    check.mockResolvedValueOnce({ status: "none", result: { ...RESULT, unanswered: 3 } });

    const res = await run();

    expect(await res.json()).toEqual({ status: "none" });
    expect(capture.mock.calls[0][2]).toMatchObject({ stored: false, unanswered: 3 });
  });

  it("waits with Gemini's kill switch or daily limit saying no, and stays due", async () => {
    access = { allowed: false };
    expect((await run()).status).toBe(503);
    expect(check).not.toHaveBeenCalled();
  });

  it("logs what the model cost, for the spend alert", async () => {
    await run();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      apiName: "gemini",
      endpoint: "/api/trips/[id]/places-to-eat",
      costUsd: RESULT.costUsd,
      exactCost: true,
      userId: "owner-1",
    });
  });

  it("logs no call when the check didn't need the model", async () => {
    check.mockResolvedValue({ status: "checked", changes: [], fromVersion: 4, itineraryVersion: 4, result: { ...RESULT, costUsd: 0 } });
    await run();
    expect(log).not.toHaveBeenCalled();
  });

  it("turns away a caller past the limit, and one not signed in", async () => {
    allowed = false;
    expect((await run()).status).toBe(429);

    allowed = true;
    authError = new Response(null, { status: 401 });
    expect((await run()).status).toBe(401);

    expect(check).not.toHaveBeenCalled();
  });
});
