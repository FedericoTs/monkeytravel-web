/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import type { ItineraryDay } from "@/types";
import { activityNotFoundReason, findActivityByName } from "./find-activity";

const day = (n: number, names: string[]) =>
  ({ day_number: n, activities: names.map((name) => ({ name })) }) as unknown as ItineraryDay;

const bali = [
  day(1, ["Uluwatu Temple & Kecak Dance", "Jimbaran Seafood Dinner"]),
  day(2, ["Tanah Lot Temple", "Tegallalang Rice Terraces"]),
];

describe("findActivityByName", () => {
  it("finds a name typed with a typo", () => {
    const found = findActivityByName(bali, "uluwantu temple");
    expect(found?.activity.name).toBe("Uluwatu Temple & Kecak Dance");
    expect(found?.dayIndex).toBe(0);
  });

  it("finds partial names and ignores accents and punctuation", () => {
    expect(findActivityByName(bali, "rice terraces")?.activity.name).toBe("Tegallalang Rice Terraces");
    const malaga = [day(1, ["Málaga Cathedral", "St. Peter's Market"])];
    expect(findActivityByName(malaga, "malaga cathedral")?.activity.name).toBe("Málaga Cathedral");
    expect(findActivityByName(malaga, "st peters market")?.activity.name).toBe("St. Peter's Market");
  });

  it("searches only the day the user named, and does not guess at unrelated names", () => {
    expect(findActivityByName(bali, "tanah lot", 1)).toBeNull();
    expect(findActivityByName(bali, "tanah lot", 2)?.activity.name).toBe("Tanah Lot Temple");
    expect(findActivityByName(bali, "louvre museum")).toBeNull();
  });
});

describe("activityNotFoundReason", () => {
  it("names the closest activities so the reply can offer them", () => {
    const reason = activityNotFoundReason(bali, "temple of the sea");
    expect(reason).toContain('Could not find an activity matching "temple of the sea" in your itinerary');
    expect(reason).toContain('"Tanah Lot Temple"');
    expect(reason).toContain('"Uluwatu Temple & Kecak Dance"');
  });

  it("lists the named day when nothing on it is close", () => {
    const reason = activityNotFoundReason(bali, "louvre", 2);
    expect(reason).toContain("on Day 2");
    expect(reason).toContain('That day has "Tanah Lot Temple", "Tegallalang Rice Terraces"');
  });

  it("keeps the plain reason when there is nothing to offer", () => {
    expect(activityNotFoundReason(bali, "louvre")).toBe('Could not find an activity matching "louvre" in your itinerary');
  });
});
