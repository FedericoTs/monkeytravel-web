import { describe, expect, it } from "vitest";
import { VIBE_CONFIGS } from "@/components/trip/VibeSelector";
import type { SeasonalContext } from "@/types";
import { seasonalVibeSeed, STEP2_VIBES } from "./seasonal-vibes";

const season = (name: SeasonalContext["season"], holidays: string[] = []) =>
  ({ season: name, holidays }) as unknown as SeasonalContext;

describe("STEP2_VIBES", () => {
  it("is the list step 2's selector offers, in its order", () => {
    expect(VIBE_CONFIGS.map((config) => config.id)).toEqual([...STEP2_VIBES]);
  });
});

describe("seasonalVibeSeed", () => {
  it("starts step 2 with the season's vibe", () => {
    expect(seasonalVibeSeed(season("spring"), "2027-04-10")).toEqual(["nature"]);
    expect(seasonalVibeSeed(season("summer"), "2027-07-10")).toEqual(["adventure"]);
  });

  it("puts a festival and February first, two at most", () => {
    expect(seasonalVibeSeed(season("winter", ["Carnival"]), "2027-02-10")).toEqual(["cultural", "romantic"]);
  });

  it("skips suggestions step 2 doesn't offer", () => {
    expect(seasonalVibeSeed(season("autumn"), "2027-10-10")).toEqual(["foodie"]);
    expect(seasonalVibeSeed(season("winter"), "2027-12-10")).toEqual([]);
  });

  it("reads the month from the trip's start", () => {
    expect(seasonalVibeSeed(season("winter"), "2027-02-10")).toEqual(["romantic"]);
    expect(seasonalVibeSeed(season("winter"), "2027-01-10")).toEqual([]);
  });
});
