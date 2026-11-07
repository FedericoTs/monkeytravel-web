import { describe, expect, it } from "vitest";
import { buildStaticChatHistory, buildUserPrompt } from "./trip-prompt";
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

  it("says nothing about travellers when nobody answered", () => {
    expect(buildUserPrompt(trip())).not.toContain("Travellers:");
  });

  it("keeps the line with the trip's details", () => {
    const prompt = buildUserPrompt(trip({ tripIntent: "solo" }));
    expect(prompt.indexOf("Travellers:")).toBeGreaterThan(prompt.indexOf("Travel Pace:"));
    expect(prompt.indexOf("Travellers:")).toBeLessThan(prompt.indexOf("Traveler Preferences"));
  });
});
