// @vitest-environment node
import { describe, expect, it } from "vitest";
import { estimateTravelTime } from "./travel-estimation";

/** A point `meters` north of the origin (Earth radius 6,371 km). */
const METERS_PER_DEGREE = (2 * Math.PI * 6371000) / 360;
const ORIGIN = { lat: 0, lng: 0 };
const north = (meters: number) => ({ lat: meters / METERS_PER_DEGREE, lng: 0 });

describe("estimateTravelTime", () => {
  it("walks a short leg: the path a little longer than the line, crossings added", () => {
    const leg = estimateTravelTime(ORIGIN, north(500));
    expect(leg).toMatchObject({ mode: "WALKING", distanceMeters: 575, distanceText: "575 m", isEstimate: true });
    // 575 m at 4.8 km/h is 431 s, plus 15 s for each of 3 crossings.
    expect(leg.durationSeconds).toBe(476);
    expect(leg.durationText).toBe("8 min");
  });

  it("drives a longer leg: the road longer still, traffic lights added", () => {
    const leg = estimateTravelTime(ORIGIN, north(3100));
    expect(leg).toMatchObject({ mode: "DRIVING", distanceMeters: 4185, distanceText: "4.2 km" });
    // 4,185 m at 22 km/h is 685 s, plus 30 s for each of 8 stops.
    expect(leg.durationSeconds).toBe(925);
    expect(leg.durationText).toBe("15 min");
  });

  it("follows a preferred mode over the distance rule", () => {
    expect(estimateTravelTime(ORIGIN, north(500), "DRIVING").mode).toBe("DRIVING");
    expect(estimateTravelTime(ORIGIN, north(3000), "WALKING").mode).toBe("WALKING");
  });

  it("states long durations in hours", () => {
    expect(estimateTravelTime(ORIGIN, north(50000)).durationText).toMatch(/^\d+ hr( \d+ min)?$/);
  });
});
