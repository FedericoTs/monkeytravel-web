import { describe, expect, it } from "vitest";
import { buildUserPrompt } from "./trip-prompt";
import type { TripCreationParams } from "@/types";

/** A later city of a route begins its first day when the ride from the one before gets in (lib/ai/multi-city.ts). */

const edinburgh = (at: string, mode: NonNullable<TripCreationParams["arrivesBy"]>["mode"] = "train") =>
  buildUserPrompt({
    destination: "Edinburgh",
    startDate: "2027-03-12",
    endDate: "2027-03-13",
    budgetTier: "balanced",
    pace: "moderate",
    vibes: ["cultural"],
    interests: [],
    arrivesBy: { from: "London", mode, at },
  } as TripCreationParams);

describe("a route city's first day", () => {
  it("begins half an hour after the ride gets in, with lunch near where they arrive when that is by half past two", () => {
    expect(edinburgh("13:15")).toContain(
      "Travel days: They reach Edinburgh on day 1 by train from London, in at about 13:15: plan nothing that day before about 13:45, then lunch near where they arrive, and the afternoon."
    );
    expect(edinburgh("14:00")).toContain("plan nothing that day before about 14:30, then lunch near where they arrive");
  });

  it("is a light afternoon and dinner after a later ride, dinner only in the evening, and only the arrival at night", () => {
    expect(edinburgh("15:00", "flight")).toContain(
      "They reach Edinburgh on day 1 by plane from London, in at about 15:00: plan nothing that day before about 15:30, then a light afternoon, and dinner."
    );
    expect(edinburgh("19:00", "bus")).toContain("by bus from London, in at about 19:00: plan only dinner that day, close to where they're staying.");
    expect(edinburgh("21:30", "ferry")).toContain("by ferry from London, in at about 21:30: plan nothing that day but the arrival and the check-in.");
  });

  it("says nothing of a ride to a city the trip begins in", () => {
    const first = buildUserPrompt({
      destination: "London",
      startDate: "2027-03-10",
      endDate: "2027-03-11",
      budgetTier: "balanced",
      pace: "moderate",
      vibes: ["cultural"],
      interests: [],
    } as TripCreationParams);
    expect(first).not.toContain("They reach");
  });
});
