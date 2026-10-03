import { describe, it, expect } from "vitest";
import { isCreatorIndexable } from "./creator-indexable";

describe("isCreatorIndexable", () => {
  it("indexes a creator with three or more public trips", () => {
    expect(isCreatorIndexable({ publicTripCount: 3 })).toBe(true);
    expect(isCreatorIndexable({ publicTripCount: 12, bio: null })).toBe(true);
  });

  it("indexes a creator with a bio, whatever the trip count", () => {
    expect(isCreatorIndexable({ publicTripCount: 1, bio: "Weekend hiker in the Dolomites." })).toBe(true);
  });

  it("does not index a thin profile", () => {
    expect(isCreatorIndexable({ publicTripCount: 1 })).toBe(false);
    expect(isCreatorIndexable({ publicTripCount: 2, bio: "   " })).toBe(false);
  });
});
