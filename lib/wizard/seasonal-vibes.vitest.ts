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
    expect(seasonalVibeSeed(season("spring"), "2027-04-10", "solo")).toEqual(["nature"]);
    expect(seasonalVibeSeed(season("summer"), "2027-07-10", "family")).toEqual(["adventure"]);
  });

  it("puts a festival and February first, two at most", () => {
    expect(seasonalVibeSeed(season("winter", ["Carnival"]), "2027-02-10", "couple")).toEqual(["cultural", "romantic"]);
  });

  it("skips suggestions step 2 doesn't offer", () => {
    expect(seasonalVibeSeed(season("autumn"), "2027-10-10", "couple")).toEqual(["foodie"]);
    expect(seasonalVibeSeed(season("winter"), "2027-12-10", "couple")).toEqual([]);
  });

  it("reads the month from the trip's start", () => {
    expect(seasonalVibeSeed(season("winter"), "2027-02-10", "couple")).toEqual(["romantic"]);
    expect(seasonalVibeSeed(season("winter"), "2027-01-10", "couple")).toEqual([]);
  });

  it("starts February with romance for a couple only: a family, friends or one traveller start without it", () => {
    expect(seasonalVibeSeed(season("winter"), "2027-02-10", "family")).toEqual([]);
    expect(seasonalVibeSeed(season("winter"), "2027-02-10", "group")).toEqual([]);
    expect(seasonalVibeSeed(season("winter"), "2027-02-10", "solo")).toEqual([]);
    // Nobody said who's coming: it isn't assumed to be two.
    expect(seasonalVibeSeed(season("winter"), "2027-02-10", "unspecified")).toEqual([]);
    // The festival's vibe stays for them.
    expect(seasonalVibeSeed(season("winter", ["Carnival"]), "2027-02-10", "group")).toEqual(["cultural"]);
  });
});
