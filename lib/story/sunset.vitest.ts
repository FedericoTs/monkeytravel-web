// @vitest-environment node
import { describe, expect, it } from "vitest";
import { firstSunset } from "./sunset";

/**
 * The story's sunset clue: when the sun sets on the trip's first evening, where its first pinned stop is, in
 * the place's own time.
 */

const lisbon = { lat: 38.7098, lng: -9.1326 };
const day = (...points: Array<{ lat: number; lng: number } | null>) => ({ activities: points.map((coordinates) => ({ name: "Stop", coordinates })) });

describe("the first evening's sunset", () => {
  it("is told in the place's own time, for the trip's own date", () => {
    // Lisbon, 9 January: a little after half past five. In June it sets after nine.
    expect(firstSunset({ start_date: "2027-01-09", itinerary: [day(lisbon)] })).toMatch(/^17:3\d$/);
    expect(firstSunset({ start_date: "2027-06-21", itinerary: [day(lisbon)] })).toMatch(/^21:0\d$/);
    // Tokyo keeps Tokyo's clock.
    expect(firstSunset({ start_date: "2027-01-09", itinerary: [day({ lat: 35.6762, lng: 139.6503 })] })).toMatch(/^16:4\d$/);
  });

  it("is read from the first stop that has a real pin, on whichever day it is", () => {
    const trip = { start_date: "2027-01-09", itinerary: [day(null, { lat: 0, lng: 0 }), day(lisbon)] };
    expect(firstSunset(trip)).toMatch(/^17:3\d$/);
  });

  it("takes a date that carries a time", () => {
    expect(firstSunset({ start_date: "2027-01-09T00:00:00Z", itinerary: [day(lisbon)] })).toMatch(/^17:3\d$/);
  });

  it("is none without a date, without a pin, or for what is no plan", () => {
    expect(firstSunset({ start_date: null, itinerary: [day(lisbon)] })).toBeNull();
    expect(firstSunset({ start_date: "2027-01-09", itinerary: [day(null)] })).toBeNull();
    expect(firstSunset({ start_date: "2027-01-09", itinerary: null })).toBeNull();
    expect(firstSunset({ start_date: "soon", itinerary: [day(lisbon)] })).toBeNull();
  });
});
