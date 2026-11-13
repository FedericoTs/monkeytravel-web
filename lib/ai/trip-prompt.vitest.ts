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

  it("places every sight on a day and at a time it is open", () => {
    expect(spec).toMatch(/Place every sight, museum, church and market on a day and at a time it is open/);
  });
});

describe("each day's weekday", () => {
  const trip = (startDate: string, endDate: string): TripCreationParams => ({
    destination: "Seville, Spain",
    startDate,
    endDate,
    budgetTier: "balanced",
    pace: "moderate",
    vibes: [],
    interests: [],
  });

  it("names the weekday of every day, so a place shut on Mondays stays off the Monday", () => {
    expect(buildUserPrompt(trip("2026-11-28", "2026-11-30"))).toContain(
      "- Days: Day 1 Saturday 2026-11-28, Day 2 Sunday 2026-11-29, Day 3 Monday 2026-11-30",
    );
  });

  it("keeps the line with the trip's details", () => {
    const details = buildUserPrompt(trip("2027-03-25", "2027-03-25")).split("## Travel Details")[1].split("\n\n")[0];
    expect(details).toContain("- Days: Day 1 Thursday 2027-03-25");
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

  it("plans for two when a couple is going, without assuming romance", () => {
    const prompt = buildUserPrompt(trip({ tripIntent: "couple" }));
    expect(prompt).toContain("- Travellers: two people travelling together.");
    expect(prompt).toContain("Don't assume it's a romantic trip unless the vibes say so.");
  });

  it("plans for children when a family is going, with no bars or late nights", () => {
    const prompt = buildUserPrompt(trip({ tripIntent: "family" }));
    expect(prompt).toContain("- Travellers: a family with children.");
    expect(prompt).toContain("Use any ages under Special Requirements.");
    expect(prompt).toContain("Don't plan bars or late nights as stops.");
  });

  it.each(["solo", "couple", "family", "group"] as const)("asks for %s to show in the choices rather than in every tip", (tripIntent) => {
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

// A trip through Busan and Seoul listed ten must-dos for both cities, and each
// city's plan was told to schedule every one: Busan sights landed on Seoul days.
describe("must-dos on a trip through several cities", () => {
  const mustDos = ["gamcheon culture village", "gyeongbokgung palace", "songdo cable car"];
  const leg = (over: Partial<TripCreationParams> = {}): TripCreationParams => ({
    destination: "Seoul",
    startDate: "2026-11-14",
    endDate: "2026-11-17",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: [],
    interests: [],
    mustDos,
    destinations: [
      { city: "Busan", nights: 4 },
      { city: "Seoul", nights: 4 },
    ],
    ...over,
  });

  it("asks each city for only the ones there, leaving the others to their own days", () => {
    const prompt = buildUserPrompt(leg());
    expect(prompt).toContain("This plan covers Seoul, one city of a trip that also visits Busan, which gets its own days.");
    expect(prompt).toContain("include each one that is in or near Seoul");
    expect(prompt).toContain("Leave out the ones in or near Busan: never put a place of Busan on a day here.");
    expect(prompt).toContain("- gamcheon culture village");
    expect(prompt).not.toContain("schedule every one");
  });

  // "gyeongbukgung palace" was left out of every plan: Gyeongbokgung Palace.
  it("takes a misspelled must-do for the real place it means", () => {
    expect(buildUserPrompt(leg())).toContain("(a misspelled or partial name means the most likely real place)");
    expect(buildUserPrompt(leg({ destinations: undefined }))).toContain("(a misspelled or partial name means the most likely real place)");
  });

  it("names every other city", () => {
    const three = leg({ destinations: [{ city: "Busan", nights: 3 }, { city: "Seoul", nights: 3 }, { city: "Gyeongju", nights: 2 }] });
    expect(buildUserPrompt(three)).toContain("one city of a trip that also visits Busan and Gyeongju, which get their own days.");
  });

  it("still asks a trip to one place for every one", () => {
    const single = buildUserPrompt(leg({ destination: "Seoul, South Korea", destinations: undefined }));
    expect(single).toContain("Traveller Must-Dos (explicitly requested — schedule every one)");
    expect(single).not.toContain("one city of a trip");
  });
});
