import { describe, expect, it } from "vitest";
import { funnelDays, funnelTraits } from "./plan-funnel";

describe("funnelTraits", () => {
  it("names the place, who is coming and whether it is a backpacking trip", () => {
    expect(funnelTraits({ destination: "Lisbon, Portugal", tripIntent: "group", travelStyle: "backpacker" })).toEqual({
      destination: "Lisbon, Portugal",
      group_size: "group",
      backpacker_mode: true,
    });
    expect(funnelTraits({ destination: "", tripIntent: "unspecified", travelStyle: "classic" })).toEqual({
      destination: "",
      group_size: "unspecified",
      backpacker_mode: false,
    });
  });
});

describe("funnelDays", () => {
  it("counts both ends of the trip", () => {
    expect(funnelDays("2027-05-10", "2027-05-14")).toBe(5);
    expect(funnelDays("2027-05-10", "2027-05-10")).toBe(1);
  });

  it("is at least one day once both dates are set", () => {
    expect(funnelDays("2027-05-14", "2027-05-10")).toBe(1);
    expect(funnelDays("not a date", "2027-05-10")).toBe(1);
  });

  it("is left out until both dates are set", () => {
    expect(funnelDays("", "2027-05-10")).toBeUndefined();
    expect(funnelDays("2027-05-10", "")).toBeUndefined();
  });
});
