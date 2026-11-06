// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import type { PlacesToEatCheck, PlacesToEatResult } from "./places-to-eat";

vi.mock("./places-to-eat", () => ({ placesToEatCheck: vi.fn() }));

import { placesToEatCheck } from "./places-to-eat";
import { checkKeptTripPlacesToEat, type KeptTripForCheck } from "./check-kept-trip";

/**
 * A kept trip's places to eat are looked up on its owner's first open. What
 * changed is stored with the check's stamp on top of the version read, and an
 * edit saved meanwhile stays.
 */

const meal = (id: string, name: string) => ({ id, name, type: "restaurant" }) as Activity;
const PLANT_BASE = meal("act_new", "Plant Base");

type Row = { user_id: string; itinerary: unknown; itinerary_version: number; trip_meta: unknown };

/** The trips table, with the trigger's rule: the version moves only when the itinerary changes. */
function fakeDb(start: Row, opts: { editMeanwhile?: (row: Row) => Row } = {}) {
  let row = structuredClone(start);
  let edit = opts.editMeanwhile;
  const writes: Record<string, unknown>[] = [];
  const db = {
    from: () => ({
      update: (values: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq: (c: string, v: unknown) => ((filters[c] = v), q),
          select: async () => {
            if (edit) {
              row = edit(row);
              edit = undefined;
            }
            if (filters.itinerary_version !== row.itinerary_version || filters.user_id !== row.user_id) return { data: [], error: null };
            writes.push(values);
            const moved = JSON.stringify(values.itinerary) !== JSON.stringify(row.itinerary);
            row = { ...row, ...(values as Partial<Row>), itinerary_version: row.itinerary_version + (moved ? 1 : 0) };
            return { data: [{ itinerary_version: row.itinerary_version }], error: null };
          },
        };
        return q;
      },
      select: () => {
        const q = { eq: () => q, maybeSingle: async () => ({ data: structuredClone(row), error: null }) };
        return q;
      },
    }),
  };
  return { db: db as never, writes, current: () => row };
}

const result = (more: Partial<PlacesToEatResult> = {}): PlacesToEatResult => ({
  checked: 2, closed: 1, missing: 0, replaced: 1, dropped: 0, kept: 0, unanswered: 0, costUsd: 0.0004,
  changes: [{ day: 1, id: "a1", name: "Dinner at Arkhe", to: PLANT_BASE }],
  ...more,
});

let finish: ReturnType<typeof vi.fn<PlacesToEatCheck["finish"]>>;
let trip: KeptTripForCheck;
const itinerary = (): ItineraryDay[] =>
  [{ day_number: 1, activities: [meal("a0", "Lunch at Ao 26"), meal("a1", "Dinner at Arkhe")] }] as unknown as ItineraryDay[];

beforeEach(() => {
  finish = vi.fn<PlacesToEatCheck["finish"]>(async () => result());
  vi.mocked(placesToEatCheck).mockReset().mockReturnValue({ finish });
  trip = {
    id: "trip-1",
    user_id: "owner-1",
    title: "Lisbon Trip",
    itinerary: itinerary(),
    itinerary_version: 4,
    trip_meta: { destination: "Lisbon, Portugal", travel_style: "backpacker", locale: "it", packing_checked: ["passport"] },
    budget: { total: 900, currency: "EUR", tier: "budget" },
  };
});

const rowOf = (t: KeptTripForCheck): Row => ({ user_id: t.user_id, itinerary: t.itinerary, itinerary_version: 4, trip_meta: t.trip_meta });

describe("checkKeptTripPlacesToEat", () => {
  it("looks the trip's places up as its plan was made, on a copy", async () => {
    const { db } = fakeDb(rowOf(trip));

    await checkKeptTripPlacesToEat(db, trip, ["vegan"]);

    expect(placesToEatCheck).toHaveBeenCalledWith({
      destination: "Lisbon, Portugal",
      dietary: ["vegan"],
      withoutDiet: true,
      budgetTier: "budget",
      travelStyle: "backpacker",
      language: "it",
      userId: "owner-1",
    });
    expect(finish.mock.calls[0][0]).toEqual(trip.itinerary);
    expect(finish.mock.calls[0][0]).not.toBe(trip.itinerary);
  });

  it("stores the changes and the stamp on the version it read, keeping the rest of trip_meta", async () => {
    const { db, current } = fakeDb(rowOf(trip));

    const out = await checkKeptTripPlacesToEat(db, trip, ["vegan"]);

    expect(out).toMatchObject({ status: "checked", changes: result().changes, fromVersion: 4, itineraryVersion: 5 });
    const stored = current();
    expect((stored.itinerary as ItineraryDay[])[0].activities.map((a) => a.name)).toEqual(["Lunch at Ao 26", "Plant Base"]);
    expect(stored.trip_meta).toMatchObject({ packing_checked: ["passport"], places_to_eat_checked_at: expect.any(String) });
  });

  it("stores and answers what the trip page says of the check", async () => {
    finish.mockResolvedValueOnce(result({ checked: 8, unanswered: 2, replaced: 2, dropped: 1 }));
    const { db, current } = fakeDb(rowOf(trip));

    const out = await checkKeptTripPlacesToEat(db, trip, []);

    const stored = current().trip_meta as Record<string, unknown>;
    expect(stored.places_to_eat_result).toEqual({ checked: 6, changed: 3 });
    expect(out).toMatchObject({ status: "checked", note: { checkedAt: stored.places_to_eat_checked_at, checked: 6, changed: 3 } });
  });

  it("checks a trip with no diet, and writes no diet on it", async () => {
    const { db, current } = fakeDb(rowOf(trip));

    await checkKeptTripPlacesToEat(db, trip, []);

    expect(placesToEatCheck).toHaveBeenCalledWith(expect.objectContaining({ dietary: [], withoutDiet: true }));
    expect(current().trip_meta).not.toHaveProperty("dietary");
    expect(current().trip_meta).toHaveProperty("places_to_eat_checked_at");
  });

  it("stamps a trip whose places are all open, without moving its version", async () => {
    finish.mockResolvedValueOnce(result({ closed: 0, replaced: 0, changes: [] }));
    const { db, current } = fakeDb(rowOf(trip));

    const out = await checkKeptTripPlacesToEat(db, trip, ["vegan"]);

    expect(out).toMatchObject({ status: "checked", changes: [], fromVersion: 4, itineraryVersion: 4 });
    expect(current().itinerary).toEqual(trip.itinerary);
    expect(current().trip_meta).toHaveProperty("places_to_eat_checked_at");
  });

  it("keeps an edit saved meanwhile, and makes no change to a place edited meanwhile", async () => {
    finish.mockResolvedValueOnce(
      result({ changes: [...result().changes, { day: 1, id: "a0", name: "Lunch at Ao 26", to: null }] })
    );
    const { db, current } = fakeDb(rowOf(trip), {
      editMeanwhile: (row) => ({
        ...row,
        itinerary: [{ day_number: 1, activities: [meal("a0", "Lunch at Ao 26 (Chiado)"), meal("a1", "Dinner at Arkhe")] }],
        itinerary_version: 5,
        trip_meta: { ...(row.trip_meta as object), packing_checked: ["passport", "charger"] },
      }),
    });

    const out = await checkKeptTripPlacesToEat(db, trip, ["vegan"]);

    expect(out).toMatchObject({ status: "checked", fromVersion: 5, itineraryVersion: 6 });
    expect((current().itinerary as ItineraryDay[])[0].activities.map((a) => a.name)).toEqual(["Lunch at Ao 26 (Chiado)", "Plant Base"]);
    expect(current().trip_meta).toMatchObject({ packing_checked: ["passport", "charger"] });
  });

  it("records the owner's profile diet on a trip that had none, so its later AI edits keep to it", async () => {
    const { db, current } = fakeDb(rowOf(trip));

    await checkKeptTripPlacesToEat(db, trip, ["halal"]);

    expect(current().trip_meta).toMatchObject({ dietary: ["halal"], places_to_eat_checked_at: expect.any(String) });
  });

  it("leaves a trip's own diet as the planner had it", async () => {
    trip = { ...trip, trip_meta: { ...(trip.trip_meta as object), dietary: ["vegan", "gluten-free"] } };
    const { db, current } = fakeDb(rowOf(trip));

    await checkKeptTripPlacesToEat(db, trip, ["halal"]);

    expect((current().trip_meta as { dietary: unknown }).dietary).toEqual(["vegan", "gluten-free"]);
  });

  it("stores nothing when Google answered none of its searches, so the next open looks again", async () => {
    finish.mockResolvedValueOnce(result({ checked: 2, unanswered: 2, closed: 0, replaced: 0, changes: [] }));
    const { db, writes } = fakeDb(rowOf(trip));

    expect(await checkKeptTripPlacesToEat(db, trip, ["vegan"])).toMatchObject({ status: "none" });
    expect(writes).toEqual([]);
  });

  it("stores nothing when the check is off", async () => {
    vi.mocked(placesToEatCheck).mockReturnValueOnce(null);
    const { db, writes } = fakeDb(rowOf(trip));

    expect(await checkKeptTripPlacesToEat(db, trip, ["vegan"])).toEqual({ status: "none" });
    expect(writes).toEqual([]);
    expect(finish).not.toHaveBeenCalled();
  });

  it("takes a trip with no tier, style or locale as balanced and classic, with no language set", async () => {
    const { db } = fakeDb(rowOf(trip));
    trip = { ...trip, trip_meta: { destination: "Lisbon, Portugal" }, budget: null };

    await checkKeptTripPlacesToEat(db, trip, ["halal"]);

    expect(placesToEatCheck).toHaveBeenCalledWith(
      expect.objectContaining({ budgetTier: "balanced", travelStyle: "classic", language: undefined, dietary: ["halal"] })
    );
  });
});
