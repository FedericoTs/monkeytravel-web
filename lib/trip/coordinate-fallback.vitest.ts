import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { isPlaceholderPoint } from "./placeholder-point";
import { validateAndFixCoordinates } from "./coordinate-fallback";

const activity = (name: string, coordinates?: unknown) => ({ name, coordinates }) as unknown as Activity;
const day = (...activities: Activity[]) => ({ day_number: 1, activities }) as unknown as ItineraryDay;
const PARIS = { lat: 48.8566, lng: 2.3522 };
/** Where the one activity of a one-day trip to `destination` was put. */
const placed = (coordinates: unknown, destination = "Paris") =>
  validateAndFixCoordinates([day(activity("Somewhere", coordinates))], destination)[0].activities[0].coordinates!;
const near = (p: { lat: number; lng: number }, q: { lat: number; lng: number }, within: number) =>
  Math.abs(p.lat - q.lat) < within && Math.abs(p.lng - q.lng) < within;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("validateAndFixCoordinates", () => {
  it("keeps an activity's own coordinates when they are a real point", () => {
    const own = activity("Louvre", { lat: 48.86, lng: 2.33 });
    expect(validateAndFixCoordinates([day(own)], "Paris")[0].activities[0]).toBe(own);
  });

  it("puts an activity without a usable point near the destination's centre", () => {
    for (const bad of [undefined, null, { lat: "48", lng: 2 }, { lat: NaN, lng: 2 }, { lat: 91, lng: 2 }, { lat: 48, lng: -181 }]) {
      expect(near(placed(bad), PARIS, 0.011), JSON.stringify(bad)).toBe(true);
    }
  });

  it("knows a destination by its name or its first word", () => {
    expect(near(placed(null, "PARIS"), PARIS, 0.011)).toBe(true);
    expect(near(placed(null, "Paris, France"), PARIS, 0.011)).toBe(true);
    expect(near(placed(null, "Cape Town"), { lat: -33.9249, lng: 18.4241 }, 0.011)).toBe(true);
  });

  it("puts one for a destination it doesn't know on the placeholder point", () => {
    const p = placed(null, "Ouagadougou");
    expect(isPlaceholderPoint(p.lat, p.lng)).toBe(true);
  });

  it("spreads the activities of a day so their pins don't stack", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const [fixed] = validateAndFixCoordinates([day(activity("a"), activity("b"), activity("c"))], "Paris");
    fixed.activities.forEach((a, i) => {
      expect(a.coordinates!.lat).toBeCloseTo(PARIS.lat + i * 0.003, 9);
      expect(a.coordinates!.lng).toBeCloseTo(PARIS.lng + i * 0.003, 9);
    });
  });

  it("leaves the days it is given as they were", () => {
    const original = [day(activity("a"), activity("b", { lat: 1, lng: 2 }))];
    const copy = structuredClone(original);
    validateAndFixCoordinates(original, "Paris");
    expect(original).toEqual(copy);
  });
});
