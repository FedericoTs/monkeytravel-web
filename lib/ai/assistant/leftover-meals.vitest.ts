import { describe, expect, it } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import type { DayEdit } from "./edit-validation";
import { dropLeftoverMeals } from "./leftover-meals";

/**
 * Asked to take the food out of a trip, the model says it removed them all and now and then leaves one in. When the
 * reply says all and the change took most of a time of day's meals, the plan's other meals at that time go too.
 */

const stop = (id: string, name: string, start_time: string, type = "attraction", extra: Partial<Activity> = {}) =>
  ({ id, name, start_time, time_slot: "morning", duration_minutes: 60, type, ...extra }) as unknown as Activity;
// Three days in Lisbon, each with a café breakfast, lunch and dinner around two sights.
const days = [
  { day_number: 1, date: "2027-05-10", activities: [stop("a1", "Pastéis de Belém", "09:00", "cafe"), stop("a2", "Jerónimos Monastery", "10:00"), stop("a3", "Time Out Market", "13:00", "restaurant"), stop("a4", "Alfama walk", "15:00"), stop("a5", "Taberna da Rua das Flores", "19:30", "restaurant")] },
  { day_number: 2, date: "2027-05-11", activities: [stop("b1", "Fábrica Coffee Roasters", "09:00", "cafe"), stop("b2", "Castelo de São Jorge", "10:00"), stop("b3", "Cervejaria Ramiro", "12:30", "restaurant"), stop("b4", "LX Factory", "15:00"), stop("b5", "A Cevicheria", "19:30", "restaurant")] },
  { day_number: 3, date: "2027-05-12", activities: [stop("c1", "Manteigaria", "09:00", "cafe"), stop("c2", "Gulbenkian Museum", "10:00", "museum"), stop("c3", "O Velho Eurico", "13:00", "restaurant"), stop("c4", "Miradouro da Graça", "16:00"), stop("c5", "Prado", "20:00", "restaurant")] },
] as unknown as ItineraryDay[];
const saved = (n: number, ...ids: string[]) => days[n - 1].activities.filter((a) => ids.includes(a.id!));
const edit = (day_number: number, activities: Activity[]): DayEdit => ({ day_number, summary: "", activities });
const names = (e: DayEdit) => e.activities.map((a) => a.name);
const allOut = { reply: "I've removed all the restaurants and cafés from your trip.", asked: "remove all the restaurants and cafes" };

describe("dropLeftoverMeals", () => {
  it("takes out the café and the lunch a change said it removed with all the others", () => {
    const edits = [edit(1, saved(1, "a1", "a2", "a3", "a4")), edit(2, saved(2, "b2", "b4")), edit(3, saved(3, "c2", "c4"))];
    const out = dropLeftoverMeals(days, edits, allOut);
    expect(names(out[0])).toEqual(["Jerónimos Monastery", "Alfama walk"]);
    expect(out[1]).toBe(edits[1]);
    expect(out[2]).toBe(edits[2]);
  });

  it("takes out only the times of day it emptied: no breakfast and lunch keeps the dinners", () => {
    const edits = [edit(1, saved(1, "a2", "a3", "a4", "a5")), edit(2, saved(2, "b2", "b4", "b5")), edit(3, saved(3, "c1", "c2", "c4", "c5"))];
    const out = dropLeftoverMeals(days, edits, { reply: "Done: all the breakfasts and lunches are out.", asked: "No lunch and breakfast" });
    expect(names(out[0])).toEqual(["Jerónimos Monastery", "Alfama walk", "Taberna da Rua das Flores"]);
    expect(names(out[2])).toEqual(["Gulbenkian Museum", "Miradouro da Graça", "Prado"]);
  });

  it("reads the reply in Italian, Spanish and Portuguese", () => {
    const edits = [edit(1, saved(1, "a1", "a2", "a4")), edit(2, saved(2, "b2", "b4")), edit(3, saved(3, "c2", "c4"))];
    for (const reply of ["Ho tolto tutte le colazioni, i pranzi e le cene.", "He quitado todos los restaurantes y cafés.", "Removi todos os restaurantes e cafés."]) {
      expect(names(dropLeftoverMeals(days, edits, { reply, asked: "x" })[0])).toEqual(["Jerónimos Monastery", "Alfama walk"]);
    }
  });

  it("leaves the change as it is when the reply doesn't say all, or the traveller keeps some", () => {
    const edits = [edit(1, saved(1, "a1", "a2", "a4")), edit(2, saved(2, "b2", "b4")), edit(3, saved(3, "c2", "c4"))];
    expect(dropLeftoverMeals(days, edits, { reply: "I've removed the restaurants.", asked: "remove the restaurants" })).toEqual(edits);
    // "All set" and "All done" open a reply; they say nothing of the meals.
    expect(dropLeftoverMeals(days, edits, { reply: "All set: the lunches on days 2 and 3 are out, and the dinners too.", asked: "x" })).toEqual(edits);
    expect(dropLeftoverMeals(days, edits, { ...allOut, asked: "remove the restaurants except Pastéis de Belém" })).toEqual(edits);
    expect(dropLeftoverMeals(days, edits, { ...allOut, asked: "remove the cafés but keep the pastry place" })).toEqual(edits);
  });

  it("leaves a time of day the change put new meals in: it replaced them, one it missed stays", () => {
    const cheaper = stop("n1", "Tasca do Chico", "13:00", "restaurant");
    const edits = [edit(1, [...saved(1, "a1", "a2", "a4", "a5"), cheaper]), edit(2, saved(2, "b1", "b2", "b3", "b4", "b5")), edit(3, saved(3, "c1", "c2", "c4", "c5"))];
    const out = dropLeftoverMeals(days, edits, { reply: "I've swapped all the lunches for cheaper places.", asked: "cheaper lunches" });
    expect(names(out[1])).toContain("Cervejaria Ramiro");
  });

  it("leaves one meal taken out, a time of day it took less than most of, and a fixed plan", () => {
    const one = [edit(2, saved(2, "b1", "b2", "b4", "b5"))];
    expect(dropLeftoverMeals(days, one, { reply: "I've removed all the lunches you asked about.", asked: "remove lunch on day 2" })).toEqual(one);
    // Four days, lunch taken from two: half of them is not most.
    const day4 = { ...days[2], day_number: 4, date: "2027-05-13", activities: days[2].activities.map((a) => ({ ...a, id: `d${a.id}` })) } as ItineraryDay;
    const four = [...days, day4];
    const half = [edit(1, saved(1, "a1", "a2", "a4", "a5")), edit(2, saved(2, "b1", "b2", "b4", "b5")), edit(3, saved(3, "c1", "c2", "c3", "c4", "c5")), edit(4, day4.activities)];
    expect(dropLeftoverMeals(four, half, allOut)).toEqual(half);
    const booked = days.map((d) => ({ ...d, activities: d.activities.map((a) => (a.id === "a1" ? { ...a, locked: true } : a)) })) as ItineraryDay[];
    const edits = [edit(1, [{ ...saved(1, "a1")[0], locked: true } as Activity, ...saved(1, "a2", "a4")]), edit(2, saved(2, "b2", "b4")), edit(3, saved(3, "c2", "c4"))];
    expect(names(dropLeftoverMeals(booked, edits, allOut)[0])).toEqual(["Pastéis de Belém", "Jerónimos Monastery", "Alfama walk"]);
  });

  it("finds a meal the model wrote again without its id, by its name", () => {
    const rewritten = { ...saved(1, "a1")[0], id: undefined, start_time: "09:30" } as unknown as Activity;
    const edits = [edit(1, [rewritten, ...saved(1, "a2", "a4")]), edit(2, saved(2, "b2", "b4")), edit(3, saved(3, "c2", "c4"))];
    expect(names(dropLeftoverMeals(days, edits, allOut)[0])).toEqual(["Jerónimos Monastery", "Alfama walk"]);
  });
});
