/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import type { DayEdit } from "./edit-validation";
import { fitTravelTimes, keepDepartureTime, outsideTravelTimes, planDeparture, toldTravelTimes, withPlanDeparture } from "./travel-times";

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

describe("toldTravelTimes: the times the plan is held to", () => {
  const leaving = { day: 3, leaves: "08:00", by: "flight" };
  const settingOff = { day: 1, leaves: "10:00", by: "car" };

  it("are none when the traveller gave no clock time, whatever the model wrote", () => {
    expect(toldTravelTimes([leaving], "We are arriving late on the 26th and leaving early on the 3rd", 3)).toEqual([]);
    expect(toldTravelTimes([leaving], "Our flight home leaves at 8am on day 3", 3)).toEqual([leaving]);
    expect(toldTravelTimes([leaving], "el vuelo sale a las 8", 3)).toEqual([leaving]);
  });

  it("leave out setting off on the first day of a longer trip, and keep every other time", () => {
    const told = "Day 1 we drive from home and set off at 10am, with lunch on the way";
    expect(toldTravelTimes([settingOff, leaving], told, 3)).toEqual([leaving]);
    // Leaving and arriving the same first day is the ride there: kept.
    const ride = { day: 1, leaves: "10:00", arrives: "13:00", by: "car" };
    expect(toldTravelTimes([ride], told, 3)).toEqual([ride]);
    // Arriving on the first day is arriving.
    expect(toldTravelTimes([{ day: 1, arrives: "18:35", by: "flight" }], told, 3)).toEqual([{ day: 1, arrives: "18:35", by: "flight" }]);
    // On a one-day trip, leaving is the end of the day.
    expect(toldTravelTimes([settingOff], told, 1)).toEqual([settingOff]);
    // Leaving a later day is leaving.
    expect(toldTravelTimes([{ day: 2, leaves: "10:00", by: "train" }], told, 3)).toEqual([{ day: 2, leaves: "10:00", by: "train" }]);
  });
});

describe("fitTravelTimes: a changed day held to the times they gave", () => {
  const edit = (n: number, ...activities: unknown[]) => ({ day_number: n, summary: "", activities }) as unknown as DayEdit;
  const names = (e: { activities: Array<{ name: string; start_time: string; duration_minutes?: number }> }) =>
    e.activities.map((a) => `${a.name} ${a.start_time}${a.duration_minutes === 90 ? "" : ` (${a.duration_minutes})`}`);

  it("moves what starts before a flight lands to after it, in order, and keeps the travel at its time", () => {
    const day1 = edit(
      1,
      stop("Louvre", "10:00"),
      stop("Arrival at CDG", "14:00", { type: "transport" }),
      stop("Shopping at Galeries Lafayette", "12:00", { type: "shopping", duration_minutes: 60 }),
    );
    const { edits, fits } = fitTravelTimes([day1], [{ day: 1, arrives: "14:00", by: "flight" }]);
    expect(names(edits[0])).toEqual(["Arrival at CDG 14:00", "Louvre 15:30", "Shopping at Galeries Lafayette 17:00 (60)"]);
    expect(fits).toEqual([
      { day: 1, arrives: "14:00", from: "15:30", until: null, moved: ["Louvre", "Shopping at Galeries Lafayette"], shortened: [], left: [] },
    ]);
    expect(outsideTravelTimes(edits, [{ day: 1, arrives: "14:00", by: "flight" }])).toEqual([]);
  });

  it("frees them sooner after a train than after a flight", () => {
    const { edits } = fitTravelTimes([edit(1, stop("Duomo", "10:00"))], [{ day: 1, arrives: "14:00", by: "train" }]);
    expect(names(edits[0])).toEqual(["Duomo 14:20"]);
  });

  it("keeps a sight to the daytime: one that could only start after half past four comes out", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(1, stop("Louvre", "10:00"), stop("Tuileries Garden", "12:00", { type: "nature", duration_minutes: 60 }))],
      [{ day: 1, arrives: "14:00", by: "flight" }],
    );
    expect(names(edits[0])).toEqual(["Louvre 15:30"]);
    expect(fits[0]).toMatchObject({ moved: ["Louvre"], left: ["Tuileries Garden"] });
  });

  it("leaves out what has no daytime left after a late arrival, and names it", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(1, stop("Museum of Art", "10:00", { type: "museum", duration_minutes: 120 }), stop("Dinner at Bistro", "19:30", { type: "restaurant", duration_minutes: 60 }))],
      [{ day: 1, arrives: "22:30", by: "flight" }],
    );
    expect(edits[0].activities).toEqual([]);
    expect(fits[0]).toMatchObject({ moved: [], left: ["Museum of Art", "Dinner at Bistro"] });
  });

  it("moves a meal only within its hour and a half, and leaves it out otherwise", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(1, stop("Lunch at Trattoria", "12:00", { type: "restaurant", duration_minutes: 60 }), stop("Uffizi", "15:00"))],
      [{ day: 1, arrives: "13:00", by: "train" }],
    );
    expect(names(edits[0])).toEqual(["Lunch at Trattoria 13:20 (60)", "Uffizi 15:00"]);
    expect(fits[0].moved).toEqual(["Lunch at Trattoria"]);
    // A stop already after the arrival keeps its time, even when it leaves the meal no room within its hour and a half.
    const busy = fitTravelTimes(
      [edit(1, stop("Lunch at Trattoria", "12:00", { type: "restaurant", duration_minutes: 60 }), stop("Gelato stop", "13:30", { type: "food", duration_minutes: 30 }))],
      [{ day: 1, arrives: "13:00", by: "train" }],
    );
    expect(names(busy.edits[0])).toEqual(["Gelato stop 13:30 (30)"]);
    expect(busy.fits[0].left).toEqual(["Lunch at Trattoria"]);
    const late = fitTravelTimes([edit(1, stop("Lunch at Trattoria", "12:00", { type: "restaurant", duration_minutes: 60 }))], [{ day: 1, arrives: "14:00", by: "flight" }]);
    expect(late.edits[0].activities).toEqual([]);
    expect(late.fits[0].left).toEqual(["Lunch at Trattoria"]);
  });

  it("cuts a visit to end before they set off when an hour of it is left, and leaves out what can't keep one", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(5, stop("Breakfast near the hotel", "08:00", { type: "restaurant", duration_minutes: 45 }), stop("Grand Palace", "09:00", { duration_minutes: 150 }), stop("Lunch at Baan Khanitha", "12:30", { type: "restaurant", duration_minutes: 60 }))],
      [{ day: 5, leaves: "14:00", by: "flight" }],
    );
    expect(names(edits[0])).toEqual(["Breakfast near the hotel 08:00 (45)", "Grand Palace 09:00 (120)"]);
    expect(fits[0]).toEqual({ day: 5, leaves: "14:00", from: null, until: "11:00", moved: [], shortened: ["Grand Palace"], left: ["Lunch at Baan Khanitha"] });
  });

  it("leaves out a visit that would be cut below half its length", () => {
    const { edits, fits } = fitTravelTimes([edit(5, stop("Day at the spa", "09:00", { duration_minutes: 300 }))], [{ day: 5, leaves: "14:00", by: "flight" }]);
    expect(edits[0].activities).toEqual([]);
    expect(fits[0].left).toEqual(["Day at the spa"]);
    // Exactly half is still a visit.
    const half = fitTravelTimes([edit(5, stop("Day at the spa", "09:00", { duration_minutes: 240 }))], [{ day: 5, leaves: "14:00", by: "flight" }]);
    expect(names(half.edits[0])).toEqual(["Day at the spa 09:00 (120)"]);
  });

  it("on a day that goes from one place to another, moves what falls during the ride to after it", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(3, stop("Market breakfast", "08:30", { type: "food", duration_minutes: 45 }), stop("Cathedral", "11:00"), stop("Train to Porto", "10:00", { type: "transport", duration_minutes: 180 }))],
      [{ day: 3, leaves: "10:00", arrives: "13:00", by: "train" }],
    );
    expect(names(edits[0])).toEqual(["Market breakfast 08:30 (45)", "Train to Porto 10:00 (180)", "Cathedral 13:20"]);
    expect(fits[0]).toMatchObject({ journey: true, moved: ["Cathedral"], left: [] });
  });

  it("leaves a day that fits, and a day with no time, as they were, with nothing to say", () => {
    const fine = edit(1, stop("Louvre", "16:00"));
    const untimed = edit(2, stop("Orsay", "09:00"));
    const { edits, fits } = fitTravelTimes([fine, untimed], [{ day: 1, arrives: "14:00", by: "flight" }]);
    expect(edits[0]).toBe(fine);
    expect(edits[1]).toBe(untimed);
    expect(fits).toEqual([]);
  });
});

describe("fitTravelTimes: the edges of a departure", () => {
  const edit = (n: number, ...activities: unknown[]) => ({ day_number: n, summary: "", activities }) as unknown as DayEdit;
  const timed = (e: { activities: Array<{ name: string; start_time: string; duration_minutes?: number }> }) =>
    e.activities.map((a) => [a.name, a.start_time, a.duration_minutes]);

  it("cuts a visit to the five minutes", () => {
    const { edits } = fitTravelTimes([edit(5, stop("Grand Palace", "09:12", { duration_minutes: 150 }))], [{ day: 5, leaves: "14:00", by: "flight" }]);
    expect(timed(edits[0])).toEqual([["Grand Palace", "09:12", 105]]);
  });

  it("keeps a stop that ends within a quarter of an hour of setting off as it is", () => {
    const { edits, fits } = fitTravelTimes(
      [edit(5, stop("Coffee on the rooftop", "10:00", { type: "food", duration_minutes: 70 }), stop("Lunch at Baan Khanitha", "12:30", { type: "restaurant", duration_minutes: 60 }))],
      [{ day: 5, leaves: "14:00", by: "flight" }],
    );
    expect(timed(edits[0])).toEqual([["Coffee on the rooftop", "10:00", 70]]);
    expect(fits[0]).toMatchObject({ shortened: [], left: ["Lunch at Baan Khanitha"] });
  });
});

