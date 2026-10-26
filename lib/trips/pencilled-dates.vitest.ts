import { describe, expect, it } from "vitest";
import { stillPencilled } from "./pencilled-dates";

describe("stillPencilled", () => {
  const pencilled = { start: "2027-03-15", end: "2027-03-19" };

  it("holds while the trip keeps the dates pencilled in for it", () => {
    expect(stillPencilled(pencilled, "2027-03-15", "2027-03-19")).toBe(true);
  });

  it("ends once either date is changed", () => {
    expect(stillPencilled(pencilled, "2027-03-16", "2027-03-19")).toBe(false);
    expect(stillPencilled(pencilled, "2027-03-15", "2027-03-21")).toBe(false);
  });

  it("is false for a trip with no pencilled dates or a malformed record", () => {
    expect(stillPencilled(null, "2027-03-15", "2027-03-19")).toBe(false);
    expect(stillPencilled(undefined, "2027-03-15", "2027-03-19")).toBe(false);
    expect(stillPencilled(true, "2027-03-15", "2027-03-19")).toBe(false);
    expect(stillPencilled({ start: "2027-03-15" }, "2027-03-15", "2027-03-19")).toBe(false);
  });
});
