// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ItineraryDay } from "@/types";

/**
 * The owner fits in what someone going wants not to miss: the picks the plan
 * doesn't hold go in where they fit, each saying whose pick it is, onto the
 * plan as it is stored by then; the page gets the plan it was written onto
 * (for Undo) and the version to adopt. Runs the real route and the real
 * placement (withMustDos), with the model's answer, the stored row and the
 * checks around them faked. The places are invented for the test.
 */

const TRIP = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";

const s = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.com" } as null | { id: string; email: string },
  owner: true,
  guest: null as null | Record<string, unknown>,
  answer: { added: [] } as unknown,
  asked: [] as string[][],
  row: null as null | { itinerary: unknown[]; itinerary_version: number },
  outcome: "written" as "written" | "busy" | "missing",
  placed: [] as Array<Record<string, unknown>>,
  counted: [] as string[],
  events: [] as Array<{ event: string; props: Record<string, unknown> }>,
  limited: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: s.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "trip_participants") throw new Error(`unexpected table ${table}`);
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => ((filters[col] = v), chain),
        maybeSingle: async () => ({
          data: s.guest && filters.id === s.guest.id && filters.trip_id === TRIP ? s.guest : null,
          error: null,
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (c1: string, v1: unknown) => ({
            eq: async (c2: string, v2: unknown) => (s.placed.push({ ...patch, [c1]: v1, [c2]: v2 }), { error: null }),
          }),
        }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/api/auth", () => ({
  verifyTripOwnership: async (_db: unknown, id: string) =>
    s.owner
      ? { trip: { id, user_id: "owner-1", title: "Barcelona", trip_meta: { destination: "Barcelona, Spain", locale: "en" }, itinerary: STORED, itinerary_version: 7 } }
      : { trip: null, errorResponse: new Response(JSON.stringify({ error: "Trip not found" }), { status: 404 }) },
}));
vi.mock("@/lib/ai/must-dos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai/must-dos")>();
  return {
    ...real,
    askForMustDos: async (_destination: string, _days: unknown, missing: string[]) => {
      s.asked.push(missing);
      return { answer: s.answer, costUsd: 0.004 };
    },
  };
});
vi.mock("@/lib/trips/itinerary-cas", () => ({
  casUpdateItinerary: async (
    _db: unknown,
    input: { change: (row: { itinerary: unknown[]; itinerary_version: number }) => { itinerary: unknown[] } | null }
  ) => {
    if (s.outcome !== "written") return { status: s.outcome };
    const changed = input.change(s.row!);
    if (!changed) return { status: "skipped" };
    const fromVersion = s.row!.itinerary_version;
    s.row = { itinerary: changed.itinerary, itinerary_version: fromVersion + 1 };
    return { status: "written", itinerary: changed.itinerary, fromVersion, itineraryVersion: fromVersion + 1 };
  },
}));
vi.mock("@/lib/api-gateway", () => ({
  checkApiAccess: async () => ({ allowed: true }),
  blockedCall: () => new Response(null, { status: 503 }),
  logApiCall: async () => {},
}));
vi.mock("@/lib/usage-limits", () => ({
  checkUsageLimit: async () => (s.limited ? { allowed: false, message: "limit" } : { allowed: true, used: 0, remaining: 5, limit: 5 }),
  incrementUsage: async (_user: string, what: string) => void s.counted.push(what),
}));
vi.mock("@/lib/posthog/server", () => ({
  captureServerEvent: (_id: string, event: string, props: Record<string, unknown>) => void s.events.push({ event, props }),
}));

const STORED: ItineraryDay[] = [
  { day_number: 1, date: "2027-04-10", activities: [{ id: "a1", name: "Ocean Pier Walk", type: "attraction", start_time: "10:00", duration_minutes: 90 }] },
  {
    day_number: 2,
    date: "2027-04-11",
    activities: [
      { id: "a2", name: "Hillside Botanical Garden", type: "attraction", start_time: "10:00", duration_minutes: 120 },
      { id: "a3", name: "Old Port Fish House", type: "restaurant", start_time: "13:00", duration_minutes: 60 },
    ],
  },
  { day_number: 3, date: "2027-04-12", activities: [{ id: "a4", name: "Lighthouse Point", type: "attraction", start_time: "10:00", duration_minutes: 90 }] },
] as unknown as ItineraryDay[];

const CHURROS = {
  must_do: 1,
  day_number: 2,
  activity: {
    name: "Granja La Cremosa",
    type: "food",
    start_time: "16:30",
    duration_minutes: 45,
    description: "Thick hot chocolate and churros.",
    location: "Old Town",
    coordinates: { lat: 41.3827, lng: 2.1745 },
  },
};

const { DELETE, POST } = await import("./route");

const fit = (participantId = GUEST, tripId = TRIP) =>
  POST(new NextRequest(`https://monkeytravel.app/api/trips/${tripId}/participants/${participantId}/fit`, { method: "POST" }), {
    params: Promise.resolve({ id: tripId, participantId }),
  });

const payload = async (res: Response) => {
  const body = await res.json();
  return body.data ?? body;
};
const stops = () => (s.row!.itinerary as ItineraryDay[]).flatMap((d) => d.activities);

beforeEach(() => {
  s.user = { id: "owner-1", email: "owner@example.com" };
  s.owner = true;
  s.guest = { id: GUEST, display_name: "Bo", picks: ["Granja La Cremosa churros", "Hillside Botanical Garden"], source: "share", left_at: null };
  s.answer = { added: [CHURROS], left_out: [] };
  s.asked = [];
  s.row = { itinerary: structuredClone(STORED), itinerary_version: 7 };
  s.outcome = "written";
  s.placed = [];
  s.counted = [];
  s.events = [];
  s.limited = false;
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe("fitting in someone's must-dos", () => {
  it("asks only for the picks the plan doesn't hold, and puts them in, saying whose pick it is", async () => {
    const res = await fit();
    expect(res.status).toBe(200);
    expect(s.asked).toEqual([["Granja La Cremosa churros"]]);
    const placed = stops().find((a) => a.name === "Granja La Cremosa");
    expect(placed).toMatchObject({ start_time: "16:30", picked_by: "Bo" });
    expect(typeof placed?.id).toBe("string");
    // The stops that were there are as they were, and not marked.
    expect(stops().filter((a) => (a as { picked_by?: string }).picked_by)).toHaveLength(1);
    expect(stops().find((a) => a.id === "a3")).toEqual(STORED[1].activities[1]);
  });

  it("answers with the plan it wrote onto, for Undo, and both versions", async () => {
    const res = await fit();
    const body = await payload(res);
    expect(body).toMatchObject({ added: ["Granja La Cremosa churros"], notFitted: [], fromVersion: 7, itineraryVersion: 8 });
    expect(body.previousItinerary).toEqual(STORED);
    expect(body.itinerary).toEqual(s.row!.itinerary);
  });

  it("notes the picks as fitted, counts the use and the event", async () => {
    await fit();
    expect(s.placed).toHaveLength(1);
    expect(s.placed[0]).toMatchObject({ id: GUEST, trip_id: TRIP });
    expect(typeof s.placed[0].picks_placed_at).toBe("string");
    expect(s.counted).toEqual(["aiRegenerations"]);
    expect(s.events).toEqual([{ event: "participant_picks_fitted", props: { trip_id: TRIP, asked: 1, added: 1 } }]);
  });

  it("asks nothing and writes nothing when the plan holds them all", async () => {
    s.guest!.picks = ["Hillside Botanical Garden", "lighthouse point"];
    const res = await fit();
    expect(res.status).toBe(200);
    expect(await payload(res)).toMatchObject({ added: [], notFitted: [], itinerary: null });
    expect(s.asked).toEqual([]);
    expect(s.row!.itinerary_version).toBe(7);
    expect(s.counted).toEqual([]);
    expect(s.placed).toHaveLength(1);
  });

  it("writes nothing when no place was found, and says which", async () => {
    s.answer = { added: [], left_out: [{ must_do: 1, why: "too far" }] };
    const res = await fit();
    expect(res.status).toBe(200);
    expect(await payload(res)).toMatchObject({ added: [], notFitted: ["Granja La Cremosa churros"], itinerary: null });
    expect(s.row!.itinerary_version).toBe(7);
    expect(s.placed).toHaveLength(1);
  });

  it("says when the question couldn't be asked, rather than that it didn't fit", async () => {
    s.answer = {};
    const res = await fit();
    expect(res.status).toBe(503);
    expect(s.row!.itinerary_version).toBe(7);
    expect(s.placed).toEqual([]);
  });

  it("leaves the name off a stop put in for someone who gave none", async () => {
    s.guest!.display_name = null;
    await fit();
    const placed = stops().find((a) => a.name === "Granja La Cremosa");
    expect(placed).toBeTruthy();
    expect(placed).not.toHaveProperty("picked_by");
  });

  it("is the owner's: anyone else gets the owner check's answer", async () => {
    s.owner = false;
    expect((await fit()).status).toBe(404);
    expect(s.asked).toEqual([]);
  });

  it("needs a signed-in owner and real ids", async () => {
    expect((await fit("picks")).status).toBe(400);
    expect((await fit(GUEST, "not-a-trip")).status).toBe(400);
    s.user = null;
    expect((await fit()).status).toBe(401);
    expect(s.asked).toEqual([]);
  });

  it("has nothing to fit for someone not on this trip, who left, or who added none", async () => {
    expect((await fit("33333333-3333-4333-8333-333333333333")).status).toBe(404);
    s.guest!.left_at = "2027-01-01T00:00:00Z";
    expect((await fit()).status).toBe(404);
    s.guest!.left_at = null;
    s.guest!.picks = null;
    expect((await fit()).status).toBe(404);
    s.guest!.picks = ["Granja La Cremosa churros"];
    s.guest!.source = "public";
    expect((await fit()).status).toBe(404);
    expect(s.asked).toEqual([]);
  });

  it("stops at the monthly limit before asking", async () => {
    s.limited = true;
    expect((await fit()).status).toBe(429);
    expect(s.asked).toEqual([]);
  });

  it("tells the page when the plan was being saved at that moment", async () => {
    s.outcome = "busy";
    const res = await fit();
    expect(res.status).toBe(409);
    expect(s.placed).toEqual([]);
  });

  it("puts them onto the plan as stored by then, keeping a stop added meanwhile", async () => {
    s.row!.itinerary = structuredClone(STORED);
    (s.row!.itinerary as ItineraryDay[])[0].activities.push({ id: "a9", name: "Added meanwhile", type: "attraction", start_time: "15:00", duration_minutes: 60 } as never);
    s.row!.itinerary_version = 9;
    const body = await payload(await fit());
    expect(stops().map((a) => a.name)).toContain("Added meanwhile");
    expect(stops().map((a) => a.name)).toContain("Granja La Cremosa");
    expect(body).toMatchObject({ fromVersion: 9, itineraryVersion: 10 });
    expect(body.previousItinerary[0].activities.map((a: { name: string }) => a.name)).toContain("Added meanwhile");
  });
});

describe("after an Undo", () => {
  const reset = (participantId = GUEST) =>
    DELETE(new NextRequest(`https://monkeytravel.app/api/trips/${TRIP}/participants/${participantId}/fit`, { method: "DELETE" }), {
      params: Promise.resolve({ id: TRIP, participantId }),
    });

  it("counts the picks as not fitted again, so they are offered again", async () => {
    const res = await reset();
    expect(res.status).toBe(200);
    expect(s.placed).toEqual([{ picks_placed_at: null, id: GUEST, trip_id: TRIP }]);
  });

  it("is the owner's too", async () => {
    s.owner = false;
    expect((await reset()).status).toBe(404);
    s.owner = true;
    s.user = null;
    expect((await reset()).status).toBe(401);
    expect((await reset("picks")).status).toBe(400);
    expect(s.placed).toEqual([]);
  });
});
