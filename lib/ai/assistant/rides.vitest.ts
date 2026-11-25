import { describe, expect, it } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import type { DayEdit } from "./edit-validation";
import { keepRides } from "./rides";

/**
 * A trip through several cities reaches each new one with a ride (lib/ai/transfer-legs.ts). A change that rewrites
 * the day for something else ("no restaurants", every day at once) can leave the ride out, and the plan then has the
 * traveller in the next city with no way of getting there: keepRides puts the plan's ride back.
 */

const stop = (id: string, name: string, start_time: string, type = "attraction", duration_minutes = 90) =>
  ({ id, name, start_time, time_slot: "morning", duration_minutes, type }) as unknown as Activity;
const ride = {
  id: "r1",
  name: "Train to Porto",
  type: "transport",
  transport_mode: "train",
  start_time: "08:30",
  time_slot: "morning",
  duration_minutes: 180,
  location: "Lisbon",
} as unknown as Activity;
const days = [
  { day_number: 1, date: "2027-04-01", city: "Lisbon", activities: [stop("a1", "Belém Tower", "10:00"), stop("a2", "Time Out Market", "13:00", "restaurant"), stop("a3", "Alfama walk", "15:00")] },
  {
    day_number: 2,
    date: "2027-04-02",
    city: "Porto",
    // A taxi of the model's own to the station: the plan's ride is the card it made between the cities.
    activities: [stop("t1", "Taxi to Santa Apolónia", "07:45", "transport", 20), ride, stop("b1", "Livraria Lello", "12:30", "attraction", 60), stop("b2", "Café Santiago", "13:45", "restaurant"), stop("b3", "Ribeira", "15:30")],
  },
  { day_number: 3, date: "2027-04-03", city: "Porto", activities: [stop("c1", "Serralves", "10:00"), stop("c2", "Dinner at Cantinho", "19:30", "restaurant")] },
] as unknown as ItineraryDay[];
const edit = (day_number: number, activities: Activity[], city?: string): DayEdit => ({ day_number, summary: "", activities, city });
// The model's answer to "no restaurants please": every day without its meals, and day 2 without its ride too.
const noMeals = [
  edit(1, [stop("a1", "Belém Tower", "10:00"), stop("a3", "Alfama walk", "15:00")]),
  edit(2, [stop("b1", "Livraria Lello", "12:30", "attraction", 60), stop("b3", "Ribeira", "15:30")]),
  edit(3, [stop("c1", "Serralves", "10:00")]),
];
const names = (e: DayEdit | undefined) => (e?.activities ?? []).map((a) => `${a.start_time} ${a.name}`);

describe("keepRides", () => {
  it("puts the plan's ride back on the day that reaches the next city, at its time", () => {
    const out = keepRides(days, noMeals, "no restaurants please");
    expect(names(out[1])).toEqual(["08:30 Train to Porto", "12:30 Livraria Lello", "15:30 Ribeira"]);
    expect(out[1].activities[0]).toMatchObject({ id: "r1", transport_mode: "train", duration_minutes: 180 });
    expect(out[0]).toBe(noMeals[0]);
    expect(out[2]).toBe(noMeals[2]);
  });

  it("moves a stop the change put during the ride to after it arrives", () => {
    const early = [edit(2, [stop("b1", "Livraria Lello", "09:00", "attraction", 60), stop("b3", "Ribeira", "15:30")])];
    expect(names(keepRides(days, early, "no restaurants please")[0])).toEqual(["08:30 Train to Porto", "12:00 Livraria Lello", "15:30 Ribeira"]);
  });

  it("keeps the change's own ride when it wrote one", () => {
    const own = [edit(2, [{ ...stop("x", "Train to Porto", "10:00", "transport", 180) }, stop("b3", "Ribeira", "15:30")])];
    expect(keepRides(days, own, "leave later on day 2")).toEqual(own);
  });

  it.each([
    "we'd rather drive to Porto",
    "remove the train to Porto",
    "niente treno, andiamo in macchina",
    "quita el vuelo del día 2",
    "we arrive in Porto at noon",
  ])("leaves the ride out when the traveller talks about getting there: %s", (told) => {
    expect(keepRides(days, noMeals, told)).toEqual(noMeals);
  });

  it("goes with the hop to the day it moved to", () => {
    // A day more in Lisbon: day 2 stays there, so day 3 is the day they reach Porto.
    const later = [edit(2, [stop("s1", "Cascais", "10:00", "attraction", 240)], "Lisbon"), edit(3, [stop("c1", "Serralves", "13:00")])];
    const out = keepRides(days, later, "spend day 2 in Lisbon too, a day out to Cascais");
    expect(names(out[0])).toEqual(["10:00 Cascais"]);
    expect(names(out[1])).toEqual(["08:30 Train to Porto", "13:00 Serralves"]);
  });

  it("gives a day that stays in its city none of the plan's rides", () => {
    const wayBack = { ...ride, id: "r2", name: "Train to Lisbon", start_time: "17:00", location: "Porto" } as Activity;
    const longer = [...days, { day_number: 4, date: "2027-04-04", city: "Porto", activities: [stop("d1", "Bolhão", "10:00"), wayBack] }] as ItineraryDay[];
    const day3 = [edit(3, [stop("c1", "Serralves", "10:00")])];
    expect(keepRides(longer, day3, "no restaurants please")).toEqual(day3);
  });

  it("makes up no ride for a hop the plan doesn't have", () => {
    const reversed = [edit(1, [stop("c1", "Serralves", "10:00")], "Porto"), edit(2, [stop("a1", "Belém Tower", "10:00")], "Lisbon")];
    expect(keepRides(days, reversed, "start in Porto, then Lisbon")).toEqual(reversed);
  });

  it("changes nothing on a trip to one place", () => {
    const oneCity = days.map(({ city: _city, ...d }) => d) as ItineraryDay[];
    expect(keepRides(oneCity, noMeals, "no restaurants please")).toEqual(noMeals);
  });
});
