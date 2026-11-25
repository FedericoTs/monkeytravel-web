import { describe, expect, it } from "vitest";
import { placeKind, step2Default, type PlaceKind } from "./step2-default";
import type { TripIntent } from "@/lib/posthog/events";

describe("the kind of place a trip is to", () => {
  it("a route is a route, picked or typed", () => {
    expect(placeKind("Lisbon", true)).toBe("route");
    expect(placeKind("Lisbon, Porto & Lagos", false)).toBe("route");
  });

  it("a beach place, a nature place, a country and a city", () => {
    expect(placeKind("Playa del Carmen, Mexico", false)).toBe("beach");
    expect(placeKind("Bali, Indonesia", false)).toBe("beach");
    expect(placeKind("Dolomites, Italy", false)).toBe("nature");
    expect(placeKind("Kerala, India", false)).toBe("nature");
    expect(placeKind("Japan", false)).toBe("country");
    expect(placeKind("Giappone", false)).toBe("country");
    expect(placeKind("Rome, Italy", false)).toBe("city");
    expect(placeKind("Tokyo, Japan", false)).toBe("city");
  });

  it("countries mostly visited for the outdoors are nature, in any of the four languages", () => {
    expect(placeKind("Iceland", false)).toBe("nature");
    expect(placeKind("Islandia", false)).toBe("nature");
    expect(placeKind("Nuova Zelanda", false)).toBe("nature");
    expect(placeKind("Costa Rica", false)).toBe("nature");
  });

  it("cities whose names hold a lake, a mount or a valley are cities", () => {
    expect(placeKind("Salt Lake City, United States", false)).toBe("city");
    expect(placeKind("Monte Carlo, Monaco", false)).toBe("city");
    expect(placeKind("Mountain View, United States", false)).toBe("city");
  });
});

describe("step 2's two styles to start with", () => {
  const kinds: PlaceKind[] = ["city", "route", "country", "nature", "beach"];
  const people: Array<TripIntent | null> = ["solo", "couple", "family", "group", "unspecified", null];

  it("are never empty, always two different styles step 2 offers", () => {
    const offered = ["adventure", "cultural", "foodie", "romantic", "nature", "urban"];
    for (const kind of kinds) {
      for (const who of people) {
        const styles = step2Default(who, kind);
        expect(styles).toHaveLength(2);
        expect(new Set(styles).size).toBe(2);
        for (const style of styles) expect(offered).toContain(style);
      }
    }
  });

  it("follow the kind of place", () => {
    expect(step2Default("family", "city")).toEqual(["cultural", "foodie"]);
    expect(step2Default("group", "route")).toEqual(["cultural", "nature"]);
    expect(step2Default("family", "nature")).toEqual(["nature", "adventure"]);
    expect(step2Default(null, "country")).toEqual(["urban", "foodie"]);
  });

  it("follow who's coming where enough trips say so", () => {
    expect(step2Default("couple", "city")).toEqual(["cultural", "romantic"]);
    expect(step2Default("couple", "route")).toEqual(["cultural", "romantic"]);
    expect(step2Default("solo", "city")).toEqual(["adventure", "cultural"]);
    expect(step2Default("group", "beach")).toEqual(["foodie", "urban"]);
    expect(step2Default("family", "beach")).toEqual(["cultural", "foodie"]);
  });

  it("hands back a copy, so a change to step 2's choice can't change the table", () => {
    const first = step2Default("couple", "city");
    first.push("urban");
    expect(step2Default("couple", "city")).toEqual(["cultural", "romantic"]);
  });
});
