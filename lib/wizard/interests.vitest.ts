import { describe, expect, it } from "vitest";
import { interestsFromVibes } from "./interests";

describe("interestsFromVibes", () => {
  it("is each vibe's interests, each once, in the vibes' order", () => {
    expect(interestsFromVibes(["cultural", "foodie"])).toEqual(["culture", "history", "art", "food"]);
    expect(interestsFromVibes(["nature", "adventure"])).toEqual(["nature", "photography", "adventure"]);
  });

  it("is nothing for no vibes or one it doesn't know", () => {
    expect(interestsFromVibes([])).toEqual([]);
    expect(interestsFromVibes(["unknown"])).toEqual([]);
  });
});
