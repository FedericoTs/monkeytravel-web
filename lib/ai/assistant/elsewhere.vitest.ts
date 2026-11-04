import { describe, expect, it } from "vitest";
import { MAX_ELSEWHERE, placeLabel, readElsewhere } from "./elsewhere";

/**
 * The places the wizard's assistant offers for the whole trip end up in the
 * destination field and in a new plan, so only names that field would take
 * get through, never the trip's own place, each once.
 */

describe("readElsewhere", () => {
  it("takes the places offered, as the destination field reads them", () => {
    const places = readElsewhere([{ name: " Málaga ", country: "Spain" }, { name: "Porto", country: "Portugal" }], "Moab, USA");
    expect(places).toEqual([
      { name: "Málaga", country: "Spain" },
      { name: "Porto", country: "Portugal" },
    ]);
    expect(places.map(placeLabel)).toEqual(["Málaga, Spain", "Porto, Portugal"]);
  });

  it("leaves out the trip's own place, a repeat, and names the field would refuse", () => {
    const offered = [
      { name: "Moab", country: "USA" },
      { name: "Malaga", country: "Spain" },
      { name: "Málaga", country: "Spain" },
      { name: "<script>alert(1)</script>", country: "Spain" },
      { name: "X", country: "Spain" },
      { name: "A".repeat(120), country: "Spain" },
      { name: 42, country: "Spain" },
      null,
    ];
    expect(readElsewhere(offered, "Moab, USA")).toEqual([{ name: "Malaga", country: "Spain" }]);
  });

  it("offers three at most, and nothing from anything but a list", () => {
    const many = ["Coorg", "Hampi", "Gokarna", "Chikmagalur"].map((name) => ({ name, country: "India" }));
    expect(readElsewhere(many, "Mysuru, India")).toHaveLength(MAX_ELSEWHERE);
    expect(readElsewhere({ name: "Hampi", country: "India" }, "Mysuru, India")).toEqual([]);
    expect(readElsewhere(undefined, "Mysuru, India")).toEqual([]);
  });
});

describe("placeLabel", () => {
  it("is the name alone without a country", () => {
    expect(placeLabel({ name: "Madeira", country: "" })).toBe("Madeira");
  });
});
