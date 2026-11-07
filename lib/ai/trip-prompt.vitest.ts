import { describe, expect, it } from "vitest";
import { buildStaticChatHistory, buildUserPrompt, daylightLine } from "./trip-prompt";
import type { TripCreationParams } from "@/types";

/**
 * Left alone, 3.5 Flash-Lite writes short descriptions and ends most days at
 * lunch, so the prompt every plan shares asks for both.
 */
describe("what every plan is asked for", () => {
  const spec = buildStaticChatHistory("system")[0].parts[0].text;

  it("has lunch and dinner on every full day, at real places", () => {
    expect(spec).toMatch(/every full day has lunch, and dinner in the evening, at real named places/i);
  });

  it("describes each stop with why it is worth it", () => {
    expect(spec).toMatch(/"description": "What to do here and why it is worth it, in about 25 words"/);
  });
});

describe("who's coming", () => {
  const trip = (over: Partial<TripCreationParams> = {}): TripCreationParams => ({
    destination: "Lisbon, Portugal",
    startDate: "2027-05-10",
    endDate: "2027-05-12",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: [],
    interests: [],
    ...over,
  });

  it("plans for one person when they're travelling alone", () => {
    expect(buildUserPrompt(trip({ tripIntent: "solo" }))).toContain("- Travellers: one person travelling alone.");
  });

  it("plans for a group when friends are coming", () => {
    expect(buildUserPrompt(trip({ tripIntent: "group" }))).toContain("- Travellers: friends travelling together.");
  });

  it.each(["solo", "group"] as const)("asks for %s to show in the choices rather than in every tip", (tripIntent) => {
    expect(buildUserPrompt(trip({ tripIntent }))).toContain("Show this in what you choose, and mention it only where it helps.");
  });

  it("says nothing about travellers when nobody answered", () => {
    expect(buildUserPrompt(trip())).not.toContain("Travellers:");
  });

  it("keeps the line with the trip's details", () => {
    const prompt = buildUserPrompt(trip({ tripIntent: "solo" }));
    expect(prompt.indexOf("Travellers:")).toBeGreaterThan(prompt.indexOf("Travel Pace:"));
    expect(prompt.indexOf("Travellers:")).toBeLessThan(prompt.indexOf("Traveler Preferences"));
  });
});

describe("daylight", () => {
  const trip = (over: Partial<TripCreationParams> = {}): TripCreationParams => ({
    destination: "Paris, France",
    startDate: "2027-05-10",
    endDate: "2027-05-12",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: [],
    interests: [],
    ...over,
  });
  const may = { first: { sunrise: "06:16", sunset: "21:17" }, last: { sunrise: "06:13", sunset: "21:20" } };

  it("gives the plan the real sunrise and sunset, and what a sunset stop must do", () => {
    const prompt = buildUserPrompt(trip({ daylight: may }));
    expect(prompt).toContain("- Daylight (local time): sunrise about 06:16 to 06:13, sunset about 21:17 to 21:20.");
    expect(prompt).toContain("A stop named for the sunrise or the sunset must be under way at that time");
    expect(prompt.indexOf("Daylight")).toBeLessThan(prompt.indexOf("Traveler Preferences"));
  });

  it("says one time when the first and last days match", () => {
    const same = { sunrise: "07:00", sunset: "19:00" };
    expect(daylightLine({ daylight: { first: same, last: same } })).toContain("sunrise about 07:00, sunset about 19:00.");
  });

  it("says so when the sun doesn't set, or doesn't rise", () => {
    const polar = (kind: "day" | "night") => ({ sunrise: null, sunset: null, polar: kind });
    expect(daylightLine({ daylight: { first: polar("day"), last: polar("day") } })).toBe("Daylight: the sun doesn't set on these dates.");
    expect(daylightLine({ daylight: { first: polar("night"), last: polar("night") } })).toBe("Daylight: the sun doesn't rise on these dates.");
  });

  it("isn't mentioned when the place wasn't known", () => {
    expect(buildUserPrompt(trip())).not.toContain("Daylight");
  });
});
