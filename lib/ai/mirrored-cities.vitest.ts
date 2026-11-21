import { describe, expect, it } from "vitest";
import type { GeneratedItinerary } from "@/types";
import { unmirroredCities } from "./mirrored-cities";

/** A city's plan: one day per list of [name, lat, lng] stops. */
const city = (...days: Array<Array<[string, number, number]>>): GeneratedItinerary =>
  ({
    destination: { name: "x", country: "", description: "" },
    days: days.map((stops, d) => ({
      day_number: d + 1,
      date: "2027-05-01",
      theme: "t",
      activities: stops.map(([name, lat, lng]) => ({ name, type: "attraction", start_time: "10:00", coordinates: { lat, lng } })),
    })),
  }) as unknown as GeneratedItinerary;

const pins = (r: GeneratedItinerary) => r.days.flatMap((d) => d.activities.map((a) => [a.name, a.coordinates?.lat, a.coordinates?.lng]));

const sedona = city([["Cathedral Rock", 34.82, -111.793], ["Chapel of the Holy Cross", 34.8325, -111.7667]], [["Bell Rock", 34.8, -111.765]]);
// Flagstaff, Arizona, with every longitude's minus left out: in China.
const flagstaff = city([["Lowell Observatory", 35.2029, 111.6646], ["Museum of Northern Arizona", 35.2347, 111.6655]], [["Walnut Canyon", 35.172, 111.509]]);
const FLAGSTAFF = { lat: 35.1983, lng: -111.6513 };
const SEDONA = { lat: 34.8697, lng: -111.761 };

describe("unmirroredCities", () => {
  // A city written at its longitude's mirror got a day-long flight from the city before it, which took its first day,
  // and the trip closed with a flight back.
  it("puts back the city whose stops came back on the far side of the world, beside the rest of the route", () => {
    const { results, turned } = unmirroredCities([sedona, flagstaff], [null, FLAGSTAFF]);
    expect(turned).toEqual([1]);
    expect(pins(results[1])).toEqual([
      ["Lowell Observatory", 35.2029, -111.6646],
      ["Museum of Northern Arizona", 35.2347, -111.6655],
      ["Walnut Canyon", 35.172, -111.509],
    ]);
    expect(results[0]).toBe(sedona);
  });

  it("tells which of two cities is turned by where the cities table puts them", () => {
    // Sedona's own point says its stops are right, so Flagstaff's are the turned ones.
    expect(unmirroredCities([sedona, flagstaff], [SEDONA, null]).turned).toEqual([1]);
    expect(unmirroredCities([sedona, flagstaff], [SEDONA, FLAGSTAFF]).turned).toEqual([1]);
    // A namesake on the same side of the world says as much: the table may not hold a small town itself.
    expect(unmirroredCities([sedona, flagstaff], [null, { lat: 39.0, lng: -95.0 }]).turned).toEqual([1]);
    // With no point for either, either could be the turned one: both stay.
    const unsure = unmirroredCities([sedona, flagstaff], [null, null]);
    expect(unsure.turned).toEqual([]);
    expect(unsure.results).toEqual([sedona, flagstaff]);
    // The cities table puts Flagstaff where its stops are: then Sedona's are the turned ones.
    expect(unmirroredCities([sedona, flagstaff], [null, { lat: 35.2, lng: 111.66 }]).turned).toEqual([0]);
  });

  it("puts back the one city of a longer route that sits apart from the others, with no point needed", () => {
    // Cusco written at 72° east, in Asia.
    const lima = city([["Plaza Mayor", -12.0464, -77.0428]]);
    const cusco = city([["Qorikancha", -13.5202, 71.9756]]);
    const arequipa = city([["Plaza de Armas", -16.3989, -71.537]]);
    const { results, turned } = unmirroredCities([lima, cusco, arequipa], [null, null, null]);
    expect(turned).toEqual([1]);
    expect(pins(results[1])).toEqual([["Qorikancha", -13.5202, -71.9756]]);
  });

  it("turns a latitude written north of the equator back south", () => {
    const montevideo = city([["Plaza Independencia", -34.9068, -56.1996]]);
    const buenosAires = city([["Plaza de Mayo", 34.6083, -58.3712], ["La Boca", 34.6345, -58.3631]]);
    const { results, turned } = unmirroredCities([montevideo, buenosAires], [null, { lat: -34.6037, lng: -58.3816 }]);
    expect(turned).toEqual([1]);
    expect(pins(results[1])).toEqual([["Plaza de Mayo", -34.6083, -58.3712], ["La Boca", -34.6345, -58.3631]]);
  });

  it("leaves a stop of a turned city that was already written right", () => {
    const mixed = city([["Lowell Observatory", 35.2029, 111.6646], ["Museum of Northern Arizona", 35.2347, 111.6655], ["Walnut Canyon", 35.172, -111.509]]);
    const { results } = unmirroredCities([sedona, mixed], [null, FLAGSTAFF]);
    expect(pins(results[1])).toEqual([
      ["Lowell Observatory", 35.2029, -111.6646],
      ["Museum of Northern Arizona", 35.2347, -111.6655],
      ["Walnut Canyon", 35.172, -111.509],
    ]);
  });

  it("leaves a route whose cities are far apart for real", () => {
    // New York turned would be in Uzbekistan, nowhere near London or Paris.
    const london = city([["British Museum", 51.5194, -0.127]]);
    const paris = city([["Louvre", 48.8606, 2.3376]]);
    const newYork = city([["Central Park", 40.7829, -73.9654]]);
    expect(unmirroredCities([london, paris, newYork], [null, null, null]).turned).toEqual([]);
    // Two cities far apart with no mirror between them.
    const tokyo = city([["Senso-ji", 35.7148, 139.7967]]);
    expect(unmirroredCities([newYork, tokyo], [null, null]).turned).toEqual([]);
  });

  it("measures only real pins, and leaves a single city alone", () => {
    // The placeholder and 0,0 say nothing about where a stop is.
    const placeholders = city([["Somewhere", 48.0, 10.0], ["Nowhere", 0, 0]]);
    expect(unmirroredCities([sedona, placeholders], [null, null]).turned).toEqual([]);
    const withPlaceholder = city([["Lowell Observatory", 35.2029, 111.6646], ["Somewhere", 48.0, 10.0]]);
    const { results, turned } = unmirroredCities([sedona, withPlaceholder], [null, FLAGSTAFF]);
    expect(turned).toEqual([1]);
    expect(pins(results[1])).toEqual([["Lowell Observatory", 35.2029, -111.6646], ["Somewhere", 48.0, 10.0]]);
    expect(unmirroredCities([flagstaff], [FLAGSTAFF]).turned).toEqual([]);
  });

  it("turns a city only when it is far from every other city and lands beside one of them", () => {
    // Two cities 1,500 km apart, mirrors of each other's longitude: too near each other to be a slip.
    const west = city([["A", 40, -9]]);
    const east = city([["B", 40, 9]]);
    expect(unmirroredCities([west, east], [null, { lat: 40, lng: -9 }]).turned).toEqual([]);
    // Turned, the city lands 900 km from the other: not beside it.
    const far = city([["C", 34.82, 121.7]]);
    expect(unmirroredCities([sedona, far], [null, { lat: 34.82, lng: -121.7 }]).turned).toEqual([]);
  });
});
