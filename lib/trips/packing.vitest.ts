// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TripMeta } from "@/types";
import { tripPackingList } from "./packing";

const meta = { packing_suggestions: ["Sunscreen", "Adapter"] } as TripMeta;

describe("tripPackingList", () => {
  it("shows the stored list when it has items", () => {
    expect(tripPackingList(["Passport"], meta)).toEqual(["Passport"]);
  });

  it("falls back to the plan's suggestions when the stored list is empty or missing", () => {
    expect(tripPackingList([], meta)).toEqual(["Sunscreen", "Adapter"]);
    expect(tripPackingList(null, meta)).toEqual(["Sunscreen", "Adapter"]);
    expect(tripPackingList(undefined, meta)).toEqual(["Sunscreen", "Adapter"]);
  });

  it("is empty when there is neither", () => {
    expect(tripPackingList([], {} as TripMeta)).toEqual([]);
  });
});
