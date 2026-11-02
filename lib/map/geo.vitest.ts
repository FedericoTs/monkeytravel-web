import { describe, it, expect } from "vitest";
import { formatDuration } from "./geo";

describe("formatDuration", () => {
  it("reads minutes, hours, and both", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(12)).toBe("12 min");
    expect(formatDuration(83)).toBe("1 h 23 min");
    expect(formatDuration(120)).toBe("2 h");
  });

  it("rounds, and never goes below zero", () => {
    expect(formatDuration(12.6)).toBe("13 min");
    expect(formatDuration(-5)).toBe("0 min");
  });
});
