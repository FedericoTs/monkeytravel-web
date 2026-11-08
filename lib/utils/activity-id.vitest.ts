import { describe, it, expect } from "vitest";
import type { ItineraryDay, Activity } from "@/types";
import {
  calculateTravelMinutes,
  ensureActivityIds,
  ensureActivityIdsStable,
  moveActivityToDay,
  recalculateActivityTimes,
  stableActivityId,
} from "./activity-id";

describe("ensureActivityIdsStable", () => {
  const stored = () =>
    [
      { day_number: 1, date: "2027-01-01", activities: [{ name: "Alpha" }, { id: "act_kept", name: "Bravo" }, { name: "Alpha" }] },
      { day_number: 2, date: "2027-01-02", activities: [{ name: "Alpha" }] },
    ] as unknown as ItineraryDay[];

  it("mints the same ids for the same stored copy, every time (page mounts, restores, refetches)", () => {
    expect(JSON.stringify(ensureActivityIdsStable(stored(), "trip-1"))).toBe(JSON.stringify(ensureActivityIdsStable(stored(), "trip-1")));
  });

  it("keeps stored ids, and gives each place its own id", () => {
    const out = ensureActivityIdsStable(stored(), "trip-1");
    const all = out.flatMap((d) => d.activities.map((a) => a.id));
    expect(all[1]).toBe("act_kept");
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(id).toMatch(/^act_[0-9a-z]{4,12}$/);
    expect(stableActivityId("trip-2", 0, 0, "Alpha")).not.toBe(stableActivityId("trip-1", 0, 0, "Alpha"));
  });

  it("the random variant still differs per call (why the page no longer uses it on a stored copy)", () => {
    expect(JSON.stringify(ensureActivityIds(stored()))).not.toBe(JSON.stringify(ensureActivityIds(stored())));
  });

  it("passes days and activities that are not plain objects through untouched (it runs on trip inserts)", () => {
    const odd = [
      { day_number: 1, date: "2027-01-01" },
      null,
      { day_number: 3, activities: "not-an-array" },
      { day_number: 4, activities: [7, null, { name: "Real" }] },
    ] as unknown as ItineraryDay[];
    for (const out of [ensureActivityIds(odd), ensureActivityIdsStable(odd, "t")]) {
      expect(out[0]).toEqual(odd[0]);
      expect(out[1]).toBeNull();
      expect(out[2]).toEqual(odd[2]);
      const acts = (out[3] as unknown as { activities: unknown[] }).activities;
      expect(acts[0]).toBe(7);
      expect(acts[1]).toBeNull();
      expect((acts[2] as { id: string }).id).toMatch(/^act_/);
    }
  });
});

const act = (id: string, start: string): Activity =>
  ({ id, name: id, type: "attraction", start_time: start, duration_minutes: 60 }) as unknown as Activity;

const day = (day_number: number, ...activities: Activity[]): ItineraryDay =>
  ({ day_number, date: `2026-10-0${day_number}`, activities }) as ItineraryDay;

const base = (): ItineraryDay[] => [
  day(1, act("a1", "09:00"), act("a2", "12:00"), act("a3", "18:00")),
  day(2, act("b1", "10:00"), act("b2", "15:00")),
  day(3),
];

const ids = (it: ItineraryDay[]) => it.map((d) => d.activities.map((a) => a.id));

describe("moveActivityToDay", () => {
  it("appends to the target day by default (legacy behaviour)", () => {
    expect(ids(moveActivityToDay(base(), "a1", 1))).toEqual([["a2", "a3"], ["b1", "b2", "a1"], []]);
  });

  it("inserts at an explicit index, clamped to the list", () => {
    expect(ids(moveActivityToDay(base(), "a1", 1, 0))[1]).toEqual(["a1", "b1", "b2"]);
    expect(ids(moveActivityToDay(base(), "a1", 1, 1))[1]).toEqual(["b1", "a1", "b2"]);
    expect(ids(moveActivityToDay(base(), "a1", 1, 99))[1]).toEqual(["b1", "b2", "a1"]);
  });

  it("'auto' keeps the activity in the same part of the day by start time", () => {
    // 12:00 lands between 10:00 and 15:00
    expect(ids(moveActivityToDay(base(), "a2", 1, "auto"))[1]).toEqual(["b1", "a2", "b2"]);
    // 09:00 lands before 10:00
    expect(ids(moveActivityToDay(base(), "a1", 1, "auto"))[1]).toEqual(["a1", "b1", "b2"]);
    // 18:00 lands last
    expect(ids(moveActivityToDay(base(), "a3", 1, "auto"))[1]).toEqual(["b1", "b2", "a3"]);
    // empty day: only slot
    expect(ids(moveActivityToDay(base(), "a2", 2, "auto"))[2]).toEqual(["a2"]);
  });

  it("is a no-op for the same day, an unknown activity, or an invalid day", () => {
    const it = base();
    expect(moveActivityToDay(it, "a1", 0)).toBe(it);
    expect(moveActivityToDay(it, "ghost", 1)).toBe(it);
    expect(moveActivityToDay(it, "a1", 7)).toBe(it);
    expect(moveActivityToDay(it, "a1", -1)).toBe(it);
  });

  it("does not mutate its input", () => {
    const it = base();
    const snapshot = JSON.stringify(it);
    moveActivityToDay(it, "a1", 2, "auto");
    expect(JSON.stringify(it)).toBe(snapshot);
  });
});

// Stops with a known location in Kyoto, and stops the coordinate fallback put
// on its placeholder point in Bavaria (lib/trip/placeholder-point.ts) because
// it didn't know the city.
const BAMBOO_GROVE = { lat: 35.016954, lng: 135.671542 };
const TENRYU_JI = { lat: 35.015978, lng: 135.67789 };
const NARA = { lat: 34.689, lng: 135.8398 };
const ON_PLACEHOLDER = { lat: 48.0124765, lng: 10.0019811 };
const ALSO_ON_PLACEHOLDER = { lat: 48.01552, lng: 10.0075297 };

const at = (name: string, coordinates: { lat: number; lng: number } | undefined, start = "23:00", duration = 90): Activity =>
  ({ id: name, name, type: "attraction", start_time: start, duration_minutes: duration, coordinates }) as unknown as Activity;

describe("calculateTravelMinutes", () => {
  it("measures between two known places, near or out of town", () => {
    expect(calculateTravelMinutes(at("Bamboo Grove", BAMBOO_GROVE), at("Tenryu-ji", TENRYU_JI))).toBe(10);
    expect(calculateTravelMinutes(at("Bamboo Grove", BAMBOO_GROVE), at("Nara", NARA))).toBe(155);
  });

  it("has no travel time when either place has no known location", () => {
    const kyoto = at("Bamboo Grove", BAMBOO_GROVE);
    expect(calculateTravelMinutes(kyoto, at("Kiyomizu-dera", ON_PLACEHOLDER))).toBeNull();
    expect(calculateTravelMinutes(at("Kiyomizu-dera", ON_PLACEHOLDER), kyoto)).toBeNull();
    expect(calculateTravelMinutes(at("Gion", { lat: 0, lng: 0 }), kyoto)).toBeNull();
    expect(calculateTravelMinutes(kyoto, at("Gion", undefined))).toBeNull();
  });
});

describe("recalculateActivityTimes", () => {
  it("times a day holding stops with no known location from their durations, never stacking them at 23:00", () => {
    const days = [
      day(
        1,
        at("Arashiyama Bamboo Grove", BAMBOO_GROVE, "09:00", 75),
        at("Kiyomizu-dera", ON_PLACEHOLDER),
        at("Sannenzaka and Ninenzaka", ALSO_ON_PLACEHOLDER),
      ),
    ];
    // 09:00 + 75 min + the 30 min allowed for an unknown journey, then +90 +30.
    expect(recalculateActivityTimes(days, 0)[0].activities.map((a) => a.start_time)).toEqual(["09:00", "10:45", "12:45"]);
  });

  it("still times a day trip out of town by its distance", () => {
    const days = [day(1, at("Arashiyama Bamboo Grove", BAMBOO_GROVE, "09:00", 75), at("Nara Park", NARA, "11:00", 120))];
    // 09:00 + 75 min + 155 min on the road + 5 min to settle in.
    expect(recalculateActivityTimes(days, 0)[0].activities.map((a) => a.start_time)).toEqual(["09:00", "12:55"]);
  });
});
