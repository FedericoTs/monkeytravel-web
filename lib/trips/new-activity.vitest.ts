// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { firstRealPoint, newActivity } from "./new-activity";

/**
 * An activity a planner adds to a day: when it starts, what it defaults to,
 * and where it goes on the map when it has no place of its own.
 */

const at = (lat: number, lng: number) => ({ lat, lng });
const act = (start_time: string, extra: Partial<Activity> = {}) => ({ id: start_time, name: start_time, start_time, ...extra }) as Activity;
const day = (...activities: Activity[]) => ({ day_number: 1, activities }) as unknown as ItineraryDay;
const OPTS = { destination: "Lisbon", nearPoint: undefined, currency: "EUR" };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("firstRealPoint", () => {
  it("is the first real point of the plan, past activities without one or at a placeholder", () => {
    const plan = [
      day(act("09:00"), act("10:00", { coordinates: at(0, 0) })),
      day(act("11:00", { coordinates: at(38.7, -9.1) }), act("12:00", { coordinates: at(41.9, 12.5) })),
    ];
    expect(firstRealPoint(plan)).toEqual(at(38.7, -9.1));
    expect(firstRealPoint([day(act("09:00"))])).toBeUndefined();
  });
});

describe("newActivity", () => {
  it("starts half an hour after the day's last activity ends, at 09:00 on an empty day, and 22:00 at the latest", () => {
    expect(newActivity(day(act("09:00", { duration_minutes: 60 })), {}, OPTS).start_time).toBe("10:30");
    expect(newActivity(day(act("12:00")), {}, OPTS).start_time).toBe("14:00");
    expect(newActivity(day(), {}, OPTS).start_time).toBe("09:00");
    expect(newActivity(day(act("21:00")), {}, OPTS).start_time).toBe("22:00");
  });

  it("starts when the planner said, when that is a clock time", () => {
    expect(newActivity(day(act("09:00")), { start_time: "15:00" }, OPTS)).toMatchObject({ start_time: "15:00", time_slot: "afternoon" });
    expect(newActivity(day(act("09:00", { duration_minutes: 60 })), { start_time: "25:00" }, OPTS).start_time).toBe("10:30");
    expect(newActivity(day(act("09:00", { duration_minutes: 60 })), { start_time: "" }, OPTS).start_time).toBe("10:30");
  });

  it("takes its part of the day from its start", () => {
    expect(newActivity(day(), {}, OPTS).time_slot).toBe("morning");
    expect(newActivity(day(act("12:00")), {}, OPTS).time_slot).toBe("afternoon");
    expect(newActivity(day(act("16:00")), {}, OPTS).time_slot).toBe("evening");
  });

  it("fills in what the planner did not give, at the destination and free so far in the trip's currency", () => {
    const added = newActivity(day(), {}, OPTS);
    expect(added).toMatchObject({
      name: "New Activity",
      type: "activity",
      description: "",
      location: "Lisbon",
      address: "",
      duration_minutes: 90,
      estimated_cost: { amount: 0, currency: "EUR", tier: "moderate" },
      tips: [],
      booking_required: false,
    });
    expect(added.id).toMatch(/^act_[0-9a-f]{12}$/);
  });

  it("keeps what the planner gave", () => {
    const given = {
      name: "Fado",
      type: "entertainment",
      description: "Live music",
      address: "Alfama",
      duration_minutes: 120,
      image_url: "https://img/fado.jpg",
      estimated_cost: { amount: 30, currency: "EUR", tier: "moderate" },
      coordinates: at(38.71, -9.13),
    } as Partial<Activity>;
    expect(newActivity(day(), given, OPTS)).toMatchObject(given);
  });

  it("without a place of its own, goes near the day's other activities, else near the given point, else nowhere", () => {
    const nearDay = newActivity(day(act("09:00", { coordinates: at(38.7, -9.1) })), {}, OPTS).coordinates!;
    expect(Math.abs(nearDay.lat - 38.7)).toBeLessThan(0.01);
    const nearPoint = newActivity(day(act("09:00")), {}, { ...OPTS, nearPoint: at(41.9, 12.5) }).coordinates!;
    expect(Math.abs(nearPoint.lat - 41.9)).toBeLessThan(0.02);
    expect(newActivity(day(act("09:00")), {}, OPTS).coordinates).toBeUndefined();
  });

  it("treats a place at 0,0 as none", () => {
    const placed = newActivity(day(act("09:00", { coordinates: at(38.7, -9.1) })), { coordinates: at(0, 0) }, OPTS).coordinates!;
    expect(Math.abs(placed.lat - 38.7)).toBeLessThan(0.01);
  });
});
