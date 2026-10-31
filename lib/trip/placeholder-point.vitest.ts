import { describe, it, expect } from "vitest";
import type { Activity, ItineraryDay } from "@/types";
import { isRealPoint, PLACEHOLDER_POINT } from "./placeholder-point";
import { hasCoordinates } from "@/lib/trips/has-coordinates";
import { extractActivityCoordinates, getCoordinatesForNewActivity } from "@/lib/utils/geo";
import { generateTouristAttractionSchema } from "@/lib/seo/structured-data";

// Where an activity the model gave no coordinates ends up, spread a little.
const placeholder = { lat: PLACEHOLDER_POINT.lat + 0.004, lng: PLACEHOLDER_POINT.lng - 0.006 };
const jaipur = [
  { lat: 26.9239, lng: 75.8267 },
  { lat: 26.9855, lng: 75.8513 },
];

const activity = (name: string, coordinates?: { lat: number; lng: number }) => ({ name, coordinates }) as Activity;
const day = (activities: Activity[]) => ({ day_number: 1, date: "2027-03-10", theme: "", activities }) as ItineraryDay;

describe("isRealPoint", () => {
  it("is a point on the globe", () => {
    expect(isRealPoint(jaipur[0])).toBe(true);
    expect(isRealPoint({ lat: 51.4779, lng: 0 })).toBe(true);
  });

  it("is not the placeholder, 0,0, a missing point or one off the globe", () => {
    expect(isRealPoint(placeholder)).toBe(false);
    expect(isRealPoint({ lat: 0, lng: 0 })).toBe(false);
    expect(isRealPoint(undefined)).toBe(false);
    expect(isRealPoint(null)).toBe(false);
    expect(isRealPoint({ lat: 26.9 })).toBe(false);
    expect(isRealPoint({ lat: Number.NaN, lng: 75.8 })).toBe(false);
    expect(isRealPoint({ lat: 120, lng: 75.8 })).toBe(false);
  });
});

describe("activities at the placeholder point", () => {
  const days = [day([activity("Hawa Mahal", jaipur[0]), activity("Lunch at Handi", placeholder), activity("Amber Fort", jaipur[1])])];

  it("don't put a trip on the map by themselves", () => {
    expect(hasCoordinates([day([activity("Lunch at Handi", placeholder)])])).toBe(false);
    expect(hasCoordinates(days)).toBe(true);
  });

  it("are left out of the trip's points", () => {
    expect(extractActivityCoordinates(days)).toEqual(jaipur);
  });

  it("don't pull an activity added to the day towards Europe", () => {
    const point = getCoordinatesForNewActivity(days[0].activities)!;
    expect(point.lat).toBeGreaterThan(26.8);
    expect(point.lat).toBeLessThan(27.1);
    expect(point.lng).toBeGreaterThan(75.7);
    expect(point.lng).toBeLessThan(76);
  });

  it("get no coordinates in search data", () => {
    expect(generateTouristAttractionSchema({ name: "Lunch at Handi", coordinates: placeholder }).geo).toBeUndefined();
    expect(generateTouristAttractionSchema({ name: "Hawa Mahal", coordinates: jaipur[0] }).geo).toMatchObject({ latitude: 26.9239 });
  });
});
