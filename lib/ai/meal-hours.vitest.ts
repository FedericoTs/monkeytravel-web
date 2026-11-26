import { describe, expect, it } from "vitest";
import { atLocalDinnerHour, dinnerHours, eatsEarly } from "./meal-hours";

/**
 * When a dinner can start where a day ends. Restaurants in Spain open for dinner around 20:00 to 20:30, in Italy,
 * France, Portugal and Greece around 19:00 to 19:30: a dinner planned for 18:30 there finds the kitchen shut.
 */

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const span = (h: { from: number; by: number }) => `${clock(h.from)}-${clock(h.by)}`;

describe("dinnerHours", () => {
  it.each([
    ["Madrid", { lat: 40.4168, lng: -3.7038 }, "20:30-22:00"],
    ["Las Palmas (Canaries)", { lat: 28.1235, lng: -15.4363 }, "20:30-22:00"],
    ["Rome", { lat: 41.9028, lng: 12.4964 }, "19:30-21:00"],
    ["Paris", { lat: 48.8566, lng: 2.3522 }, "19:30-21:00"],
    ["Lisbon", { lat: 38.7223, lng: -9.1393 }, "19:30-21:00"],
    ["Funchal (Madeira)", { lat: 32.6669, lng: -16.9241 }, "19:30-21:00"],
    ["Athens", { lat: 37.9838, lng: 23.7275 }, "19:30-21:00"],
    ["Kyoto", { lat: 35.0116, lng: 135.7681 }, "18:30-21:00"],
    ["London", { lat: 51.5074, lng: -0.1278 }, "18:30-21:00"],
    ["New York", { lat: 40.7128, lng: -74.006 }, "18:30-21:00"],
  ])("%s", (_, at, hours) => {
    expect(span(dinnerHours(at))).toBe(hours);
  });

  it("gives the usual hours with no pin or one that can't be a place", () => {
    expect(span(dinnerHours(null))).toBe("18:30-21:00");
    expect(span(dinnerHours({ lat: 200, lng: -3.7 }))).toBe("18:30-21:00");
  });

  it("gives a family that eats early the usual hours, in Spain too", () => {
    expect(span(dinnerHours({ lat: 40.4168, lng: -3.7038 }, true))).toBe("18:30-21:00");
    expect(span(dinnerHours({ lat: 41.9028, lng: 12.4964 }, true))).toBe("18:30-21:00");
  });
});

describe("eatsEarly", () => {
  it("is a family with children under seven, or one that gave no ages", () => {
    expect(eatsEarly({ tripIntent: "family" })).toBe(true);
    expect(eatsEarly({ tripIntent: "family", childrenAges: ["under3"] })).toBe(true);
    expect(eatsEarly({ tripIntent: "family", childrenAges: ["3to6", "teen"] })).toBe(true);
  });

  it("isn't a family of older children, or a trip without children", () => {
    expect(eatsEarly({ tripIntent: "family", childrenAges: ["7to12"] })).toBe(false);
    expect(eatsEarly({ tripIntent: "family", childrenAges: ["teen"] })).toBe(false);
    expect(eatsEarly({ tripIntent: "couple" })).toBe(false);
    expect(eatsEarly({})).toBe(false);
  });
});

// Told dinner in Spain is from about 20:30, plans still ended days in Cádiz and Barcelona with dinner at 19:30.
describe("atLocalDinnerHour", () => {
  type Stop = { name: string; type: string; start_time: string; duration_minutes: number; coordinates?: { lat: number; lng: number } };
  const CADIZ = { lat: 36.5298, lng: -6.2927 };
  const ROME = { lat: 41.8986, lng: 12.4769 };
  const LONDON = { lat: 51.5074, lng: -0.1278 };
  const stop = (start_time: string, name: string, type: string, at = CADIZ): Stop => ({ name, type, start_time, duration_minutes: 90, coordinates: at });
  const day = (...activities: Stop[]) => ({ activities });
  const times = (out: { days: Array<{ activities: Stop[] }> }) => out.days.map((d) => d.activities.map((s) => `${s.start_time} ${s.name}`));

  it("moves a day's last dinner before the hour there to that hour: 20:30 in Spain, 19:30 in Italy", () => {
    const out = atLocalDinnerHour([
      day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("19:30", "La Pescadería", "restaurant")),
      day(stop("10:00", "Pantheon", "landmark", ROME), stop("18:30", "Armando al Pantheon", "restaurant", ROME)),
    ]);
    expect(out.moved).toBe(2);
    expect(times(out)).toEqual([
      ["10:00 Catedral de Cádiz", "20:30 La Pescadería"],
      ["10:00 Pantheon", "19:30 Armando al Pantheon"],
    ]);
  });

  it("leaves a dinner within half an hour of the hour, one at a usual hour elsewhere, a late lunch, a café, and one with no pin", () => {
    const days = [
      day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("20:00", "El Faro", "restaurant")),
      day(stop("10:00", "British Museum", "museum", LONDON), stop("18:00", "Dishoom", "restaurant", LONDON)),
      day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("16:30", "Mesón El Pícaro", "restaurant")),
      day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("18:00", "Café Royalty", "cafe")),
      // The placeholder pin sits in Germany, where 17:30 would be early too.
      day(stop("10:00", "Catedral de Cádiz", "landmark"), { ...stop("17:30", "Casa Manteca", "restaurant"), coordinates: { lat: 48, lng: 10 } }),
    ];
    const out = atLocalDinnerHour(days);
    expect(out).toEqual({ days, moved: 0 });
  });

  it("leaves a dinner with a stop after it, and the dinners of a family that eats early", () => {
    const show = [day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("19:30", "La Pescadería", "restaurant"), stop("21:30", "Flamenco", "entertainment"))];
    expect(atLocalDinnerHour(show)).toEqual({ days: show, moved: 0 });
    const family = [day(stop("10:00", "Catedral de Cádiz", "landmark"), stop("19:30", "La Pescadería", "restaurant"))];
    expect(atLocalDinnerHour(family, true)).toEqual({ days: family, moved: 0 });
  });
});
