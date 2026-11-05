// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ItineraryDay } from "@/types";

/**
 * A regenerated day is written onto the row as it is then, not as it was read
 * before the seconds of generating: anything saved meanwhile stays, and the page
 * learns the version it can adopt. Runs the real route, with the model, the
 * compare-and-set write and the checks around them faked.
 */

const s = vi.hoisted(() => ({
  newDay: null as unknown,
  row: null as null | { itinerary: unknown[]; itinerary_version: number },
  outcome: "written" as "written" | "skipped" | "busy" | "missing",
  from: null as unknown,
  counted: [] as string[],
}));

vi.mock("@/lib/ai/regenerate-day", () => ({ regenerateSingleDay: async () => s.newDay }));
vi.mock("@/lib/trips/itinerary-cas", () => ({
  casUpdateItinerary: async (
    _db: unknown,
    input: { from: unknown; change: (row: { itinerary: unknown[] }) => { itinerary: unknown[] } | null }
  ) => {
    s.from = input.from;
    if (s.outcome === "busy" || s.outcome === "missing") return { status: s.outcome };
    const changed = input.change(s.row!);
    if (!changed) return { status: "skipped" };
    const fromVersion = s.row!.itinerary_version;
    s.row!.itinerary = changed.itinerary;
    s.row!.itinerary_version += 1;
    return { status: "written", itinerary: changed.itinerary, fromVersion, itineraryVersion: s.row!.itinerary_version };
  },
}));
vi.mock("@/lib/api/auth", () => ({
  getAuthenticatedUser: async () => ({ user: { id: "u1", email: "planner@example.com" }, supabase: {} }),
  verifyTripOwnership: async () => ({
    trip: {
      id: "t1",
      user_id: "u1",
      title: "Rome",
      itinerary: READ_BEFORE_GENERATING,
      budget: null,
      tags: [],
      trip_meta: {},
      itinerary_version: 4,
    },
  }),
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  blockedCall: () => new Response(null, { status: 503 }),
  logApiCall: async () => {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => ({ allowed: true, used: 0, remaining: 5, limit: 5 }),
  incrementUsage: async (_user: string, what: string) => void s.counted.push(what),
}));
vi.mock("@/lib/ai/observability", () => ({ recordAiOutcome: async () => {} }));
vi.mock("@/lib/ai/user-context", () => ({ readLocaleCookie: async () => null }));
vi.mock("@/lib/images/activity", () => ({ fetchActivityImages: async (activities: unknown[]) => activities }));
vi.mock("@/lib/places/places-to-eat", () => ({ placesToEatCheck: () => null }));

const READ_BEFORE_GENERATING = [
  { day_number: 1, date: "2027-05-10", activities: [{ id: "a1", name: "Colosseum" }] },
  { day_number: 2, date: "2027-05-11", activities: [{ id: "a2", name: "Pantheon" }] },
];

const { POST } = await import("./route");

const regenerate = () =>
  POST(
    new NextRequest("https://monkeytravel.app/api/ai/regenerate-day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId: "t1", dayNumber: 2 }),
    })
  );

const written = () => s.row!.itinerary as ItineraryDay[];

beforeEach(() => {
  s.newDay = {
    day_number: 9,
    date: "1999-01-01",
    theme: "Trastevere",
    activities: [{ id: "new-1", name: "Gianicolo", type: "attraction" }],
  };
  s.row = { itinerary: structuredClone(READ_BEFORE_GENERATING), itinerary_version: 4 };
  s.outcome = "written";
  s.from = null;
  s.counted.length = 0;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe("regenerating a day", () => {
  it("writes on the version it read, and tells the page both versions", async () => {
    const res = await regenerate();
    expect(res.status).toBe(200);
    expect(s.from).toMatchObject({ itinerary_version: 4 });
    const body = await res.json();
    const payload = body.data ?? body;
    expect(payload).toMatchObject({ fromVersion: 4, itineraryVersion: 5 });
    expect(payload.day.activities[0].name).toBe("Gianicolo");
  });

  it("keeps the stored day's place in the trip, whatever the model wrote", async () => {
    await regenerate();
    expect(written()[1]).toMatchObject({ day_number: 2, date: "2027-05-11", theme: "Trastevere" });
  });

  it("keeps a date moved while it was generating, and the other days as stored then", async () => {
    s.row!.itinerary = [
      { day_number: 1, date: "2027-06-10", activities: [{ id: "a1", name: "Added meanwhile" }] },
      { day_number: 2, date: "2027-06-11", activities: [{ id: "a2", name: "Pantheon" }] },
    ];
    await regenerate();
    expect(written()[1].date).toBe("2027-06-11");
    expect(written()[0].activities[0].name).toBe("Added meanwhile");
  });

  it("keeps a day's fixed plans, from the row being written", async () => {
    s.row!.itinerary = [
      { day_number: 1, date: "2027-05-10", activities: [] },
      {
        day_number: 2,
        date: "2027-05-11",
        activities: [{ id: "fixed", name: "Wedding", locked: true, start_time: "15:00", type: "event" }],
      },
    ];
    await regenerate();
    expect(written()[1].activities.map((a) => a.name)).toContain("Wedding");
    expect(written()[1].activities.map((a) => a.name)).toContain("Gianicolo");
  });

  it("answers 409 when the day was removed while it was generating, and spends nothing", async () => {
    s.row!.itinerary = [{ day_number: 1, date: "2027-05-10", activities: [] }];
    const res = await regenerate();
    expect(res.status).toBe(409);
    expect(s.counted).toEqual([]);
  });

  it("answers 409 when the trip kept changing, and spends nothing", async () => {
    s.outcome = "busy";
    const res = await regenerate();
    expect(res.status).toBe(409);
    expect(s.counted).toEqual([]);
  });

  it("answers 404 when the trip went away, and spends nothing", async () => {
    s.outcome = "missing";
    expect((await regenerate()).status).toBe(404);
    expect(s.counted).toEqual([]);
  });

  it("counts one regeneration once it is written", async () => {
    await regenerate();
    expect(s.counted).toEqual(["aiRegenerations"]);
  });
});
