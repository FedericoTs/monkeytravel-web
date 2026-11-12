/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { keepDepartureTime, planDeparture, withPlanDeparture } from "./travel-times";

const stop = (name: string, start_time: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${name}`,
  name,
  start_time,
  time_slot: Number(start_time.slice(0, 2)) < 12 ? "morning" : "afternoon",
  duration_minutes: 90,
  type: "attraction",
  ...extra,
});
const day = (n: number, ...activities: unknown[]) => ({ day_number: n, activities }) as unknown as ItineraryDay;
const trip = (last: unknown[]) => [day(1, stop("Castelo", "10:00")), day(2, ...last)];

describe("planDeparture: the plan's own way home", () => {
  it("is the last day's transport stop that names a way home, with how they travel", () => {
    expect(planDeparture(trip([stop("Chiado walk", "10:00"), stop("Flight home", "18:00", { type: "transport" })]))).toMatchObject({
      day: 2,
      leaves: "18:00",
      by: "flight",
    });
    expect(planDeparture(trip([stop("Comboio de regresso a casa", "16:30", { type: "transport" })]))).toMatchObject({ leaves: "16:30", by: "train" });
    expect(planDeparture(trip([stop("Ida para o aeroporto", "15:00", { type: "transport" })]))).toMatchObject({ leaves: "15:00", by: "flight" });
  });

  it("is none for a day trip's train, a stop that isn't transport, or a trip with no such stop", () => {
    expect(planDeparture(trip([stop("Train to Sintra", "09:00", { type: "transport" })]))).toBeNull();
    expect(planDeparture(trip([stop("Airport lounge", "17:00")]))).toBeNull();
    expect(planDeparture(trip([stop("Chiado walk", "10:00")]))).toBeNull();
    expect(planDeparture([])).toBeNull();
  });
});

describe("withPlanDeparture", () => {
  const days = trip([stop("Flight home", "18:00", { type: "transport" })]);

  it("adds the plan's way home to the times they told", () => {
    expect(withPlanDeparture([{ day: 1, arrives: "11:00" }], days)).toEqual([
      { day: 1, arrives: "11:00" },
      { day: 2, leaves: "18:00", by: "flight" },
    ]);
  });

  it("leaves it out when they told when they leave that day", () => {
    expect(withPlanDeparture([{ day: 2, leaves: "20:00", by: "flight" }], days)).toEqual([{ day: 2, leaves: "20:00", by: "flight" }]);
  });
});

describe("keepDepartureTime", () => {
  const days = trip([stop("Chiado walk", "10:00"), stop("Flight home", "18:00", { type: "transport" })]);
  const moved = [{ day_number: 2, activities: [stop("Chiado walk", "10:00"), stop("Flight home", "15:00", { type: "transport" }), stop("Dinner", "20:00")] }];

  it("puts the way home back at its time when the message gives none", () => {
    const [last] = keepDepartureTime(days, moved as never[], "add a dinner on the last day");
    expect((last as { activities: Array<{ name: string; start_time: string }> }).activities.map((a) => `${a.name} ${a.start_time}`)).toEqual([
      "Chiado walk 10:00",
      "Flight home 18:00",
      "Dinner 20:00",
    ]);
  });

  it("lets a time they give move it", () => {
    const [last] = keepDepartureTime(days, moved as never[], "our flight home is at 15:00 now");
    expect((last as { activities: Array<{ start_time: string }> }).activities[1].start_time).toBe("15:00");
  });
});
