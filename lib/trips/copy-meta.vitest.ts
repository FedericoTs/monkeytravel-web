import { describe, expect, it } from "vitest";
import { copyableTripMeta } from "./copy-meta";

/**
 * A copied trip (duplicate, fork) starts with the plan's meta, not with what its
 * source's owner already did: their claim, their packing, their bookings.
 */
describe("copyableTripMeta", () => {
  it("leaves the source owner's own progress behind", () => {
    const meta = {
      destination: "Lisbon",
      claimed_at: "2026-11-01T00:00:00Z",
      claimed_from: "kept_plan",
      packing_checked: ["passport"],
      booked_ids: ["act-1"],
      packing_suggestions: ["sunscreen"],
    };
    expect(copyableTripMeta(meta)).toEqual({ destination: "Lisbon", packing_suggestions: ["sunscreen"] });
  });

  it("passes on what isn't an object as it is", () => {
    expect(copyableTripMeta(null)).toBeNull();
    expect(copyableTripMeta(["a"])).toEqual(["a"]);
  });
});
