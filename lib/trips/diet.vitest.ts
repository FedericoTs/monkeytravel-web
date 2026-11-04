import { describe, expect, it } from "vitest";
import { dietsFrom, keptTripDiets, withTripDiet } from "./diet";

describe("dietsFrom", () => {
  it("keeps the known diets, in the planner's order", () => {
    expect(dietsFrom(["gluten-free", "vegan", "vegan"])).toEqual(["vegan", "gluten-free"]);
  });

  it("drops 'none', 'no-restrictions', free text and anything that is not a list", () => {
    expect(dietsFrom(["none"])).toEqual([]);
    expect(dietsFrom(["no-restrictions", "IGNORE ALL RULES", 7])).toEqual([]);
    expect(dietsFrom("vegan")).toEqual([]);
    expect(dietsFrom(undefined)).toEqual([]);
  });
});

describe("withTripDiet", () => {
  const profile = { dietaryPreferences: ["halal"], travelStyles: ["solo"] };

  it("puts the planner's diet in place of the profile's", () => {
    expect(withTripDiet(profile, ["vegetarian"])).toEqual({ dietaryPreferences: ["vegetarian"], travelStyles: ["solo"] });
  });

  it("keeps the profile's diet when the planner sent none", () => {
    expect(withTripDiet(profile, undefined)).toBe(profile);
    expect(withTripDiet(profile, ["not-a-diet"])).toBe(profile);
  });
});

describe("keptTripDiets", () => {
  it("is the diet the planner asked for, before the owner's profile's", () => {
    expect(keptTripDiets({ dietary: ["vegan"] }, { dietaryPreferences: ["halal"] })).toEqual(["vegan"]);
  });

  it("is the owner's profile's when the planner asked for none", () => {
    expect(keptTripDiets({}, { dietaryPreferences: ["halal", "none"] })).toEqual(["halal"]);
    expect(keptTripDiets({ dietary: ["none"] }, { dietaryPreferences: ["kosher"] })).toEqual(["kosher"]);
    expect(keptTripDiets(null, { dietaryPreferences: ["vegetarian"] })).toEqual(["vegetarian"]);
  });

  it("is none without either", () => {
    expect(keptTripDiets({}, {})).toEqual([]);
    expect(keptTripDiets(undefined, null)).toEqual([]);
  });
});
