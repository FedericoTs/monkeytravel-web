import { describe, expect, it } from "vitest";
import { sharedDays } from "./plan-days";

const stop = (name: string, type: string, more: Record<string, unknown> = {}) => ({ name, type, ...more });

describe("sharedDays", () => {
  it("names each day's first three sights in plan order, past its meals, rides and hotel", () => {
    const itinerary = [
      {
        day_number: 1,
        activities: [
          stop("Café de Flore", "cafe"),
          stop("Louvre", "museum"),
          stop("Le Grand Véfour", "restaurant"),
          stop("Metro to the Tuileries", "transport"),
          stop("Tuileries Garden", "park"),
          stop("Musée de l'Orangerie", "museum"),
          stop("Place de la Concorde", "landmark"),
          stop("Hôtel Regina", "accommodation"),
        ],
      },
      { day_number: 2, activities: [stop("Eiffel Tower", "landmark"), stop("Seine cruise", "tour")] },
    ];
    expect(sharedDays(itinerary)).toEqual({
      days: [
        { n: 1, places: ["Louvre", "Tuileries Garden", "Musée de l'Orangerie"] },
        { n: 2, places: ["Eiffel Tower", "Seine cruise"] },
      ],
      more: 0,
    });
  });

  it("keeps a day's first stops when it has no sight, and leaves out a day with nothing named", () => {
    const itinerary = [
      { day_number: 1, activities: [stop("Train to Sintra", "transport"), stop("Tascantiga", "restaurant")] },
      { day_number: 2, activities: [stop("", "landmark"), { type: "museum" }] },
      { day_number: 3, activities: [stop("Lisbon to Porto", "transport", { transport_mode: "train" }), stop("Hotel", "hotel")] },
      { day_number: 4 },
      { day_number: 5, activities: [stop("Pena Palace", "landmark")] },
    ];
    expect(sharedDays(itinerary).days).toEqual([
      { n: 1, places: ["Train to Sintra", "Tascantiga"] },
      { n: 5, places: ["Pena Palace"] },
    ]);
  });

  it("writes out seven days and counts the rest", () => {
    const itinerary = Array.from({ length: 10 }, (_, i) => ({ day_number: i + 1, activities: [stop(`Sight ${i + 1}`, "attraction")] }));
    const shared = sharedDays(itinerary);
    expect(shared.days.map((day) => day.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(shared.more).toBe(3);
    expect(sharedDays(itinerary.slice(0, 7)).more).toBe(0);
  });

  it("says each day's city only on a trip through more than one", () => {
    const route = [
      { day_number: 1, city: "Lisbon", activities: [stop("Belém Tower", "landmark")] },
      { day_number: 2, city: " Sintra ", activities: [stop("Pena Palace", "landmark")] },
    ];
    expect(sharedDays(route).days).toEqual([
      { n: 1, city: "Lisbon", places: ["Belém Tower"] },
      { n: 2, city: "Sintra", places: ["Pena Palace"] },
    ]);
    const oneCity = route.map((day) => ({ ...day, city: "Lisbon" }));
    expect(sharedDays(oneCity).days).toEqual([
      { n: 1, places: ["Belém Tower"] },
      { n: 2, places: ["Pena Palace"] },
    ]);
  });

  it("numbers a day by its place in the plan when it has no number, and reads anything as no day", () => {
    expect(sharedDays([{ activities: [stop("Alfama", "attraction")] }, null, "x", { activities: "none" }]).days).toEqual([
      { n: 1, places: ["Alfama"] },
    ]);
    expect(sharedDays([])).toEqual({ days: [], more: 0 });
  });
});
