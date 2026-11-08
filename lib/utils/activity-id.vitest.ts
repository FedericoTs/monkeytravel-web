import { describe, it, expect } from "vitest";
import type { ItineraryDay, Activity } from "@/types";
import {
  calculateTravelMinutes,
  ensureActivityIds,
  ensureActivityIdsStable,
  fitMovedStop,
  moveActivityToDay,
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

describe("fitMovedStop", () => {
  const times = (d: ItineraryDay) => d.activities.map((a) => `${a.start_time} ${a.name}`);
  // Stops with no location: an unknown journey counts as 30 minutes.
  const stop = (name: string, start: string, duration: number, extra: Partial<Activity> = {}) =>
    ({ ...at(name, undefined, start, duration), ...extra }) as Activity;
  const order = (...stops: Activity[]) => [day(1, ...stops)];
  const A = () => stop("A", "09:00", 60);
  const B = () => stop("B", "10:30", 60);
  const C = () => stop("C", "12:00", 60);
  const D = () => stop("D", "18:00", 90);

  it("keeps a stop's own time when it arrives from another day, and every other time it can", () => {
    // Kiyomizu-dera lands in its time order, at 14:30, right after lunch ends and the walk over.
    const plan = order(stop("Bamboo Grove", "08:30", 60), stop("Shoraian", "12:30", 90), stop("Kiyomizu-dera", "14:30", 90), stop("Kinkaku-ji", "15:30", 75), stop("Dinner", "19:00", 90));
    expect(times(fitMovedStop(plan, 0, "Kiyomizu-dera", "keep")[0])).toEqual([
      "08:30 Bamboo Grove",
      "12:30 Shoraian",
      "14:30 Kiyomizu-dera",
      // Pushed to after Kiyomizu-dera; dinner already had room, so it stays.
      "16:30 Kinkaku-ji",
      "19:00 Dinner",
    ]);
  });

  it("starts a stop that arrives during the one before it once that one is over", () => {
    const plan = order(stop("Shoraian", "12:30", 90), stop("Kiyomizu-dera", "12:45", 90));
    expect(times(fitMovedStop(plan, 0, "Kiyomizu-dera", "keep")[0])).toEqual(["12:30 Shoraian", "14:30 Kiyomizu-dera"]);
  });

  it("gives a stop dragged into the list the slot after the one before it, and pushes only what it must", () => {
    expect(times(fitMovedStop(order(A(), D(), B(), C()), 0, "D", "slot")[0])).toEqual(["09:00 A", "10:30 D", "12:30 B", "14:00 C"]);
  });

  it("starts a stop dragged to the top when the day started", () => {
    expect(times(fitMovedStop(order(D(), A(), B(), C()), 0, "D", "slot")[0])).toEqual(["09:00 D", "11:00 A", "12:30 B", "14:00 C"]);
  });

  it("never pulls a stop earlier", () => {
    // C is moved to the end, after D: A and B keep their times, nothing closes the gap.
    expect(times(fitMovedStop(order(A(), B(), D(), C()), 0, "C", "slot")[0])).toEqual(["09:00 A", "10:30 B", "18:00 D", "20:00 C"]);
  });

  it("never moves a booked stop or a fixed plan, and times the rest around them", () => {
    const train = stop("Shinkansen", "10:30", 60, { booking_required: true });
    const wedding = stop("Wedding", "11:00", 60, { locked: true } as Partial<Activity>);
    // D now runs 10:30 to 12:00, over each of them: they keep their times, and C goes after them.
    expect(times(fitMovedStop(order(A(), D(), train, C()), 0, "D", "slot")[0])).toEqual(["09:00 A", "10:30 D", "10:30 Shinkansen", "12:00 C"]);
    expect(times(fitMovedStop(order(A(), D(), wedding, C()), 0, "D", "slot")[0])).toEqual(["09:00 A", "10:30 D", "11:00 Wedding", "12:30 C"]);
    // A fixed stop that was moved keeps its own time too.
    expect(times(fitMovedStop(order(A(), train), 0, "Shinkansen", "slot")[0])).toEqual(["09:00 A", "10:30 Shinkansen"]);
  });

  it("measures the journey when both places are known, and allows 30 minutes when one isn't", () => {
    const days = [day(1, at("Arashiyama Bamboo Grove", BAMBOO_GROVE, "09:00", 75), at("Nara Park", NARA, "11:00", 120), at("Kiyomizu-dera", ON_PLACEHOLDER, "23:00", 90))];
    // 09:00 + 75 min + 155 min on the road + 5 min to settle in; then +120 + 30.
    expect(times(fitMovedStop(days, 0, "Nara Park", "slot")[0])).toEqual(["09:00 Arashiyama Bamboo Grove", "12:55 Nara Park", "23:00 Kiyomizu-dera"]);
    expect(times(fitMovedStop(days, 0, "Kiyomizu-dera", "slot")[0])).toEqual(["09:00 Arashiyama Bamboo Grove", "11:00 Nara Park", "13:30 Kiyomizu-dera"]);
  });

  it("never shows a time past the end of the day", () => {
    const late = order(stop("Night market", "23:00", 120), stop("Bar", "21:00", 60));
    expect(times(fitMovedStop(late, 0, "Bar", "slot")[0])).toEqual(["23:00 Night market", "23:59 Bar"]);
  });

  it("names the part of the day a re-timed stop falls in", () => {
    const [moved] = fitMovedStop(order(A(), D()), 0, "D", "slot")[0].activities.slice(1);
    expect(moved).toMatchObject({ start_time: "10:30", time_slot: "morning" });
  });

  it("leaves the other days, and a stop it doesn't hold, as they are", () => {
    const plan = [day(1, A(), B()), day(2, D(), C())];
    const out = fitMovedStop(plan, 1, "D", "slot");
    expect(out[0]).toBe(plan[0]);
    expect(fitMovedStop(plan, 1, "nowhere", "slot")).toBe(plan);
  });
});
