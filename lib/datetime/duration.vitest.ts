import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { formatDuration } from "./duration";

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

// A component with its own duration formatter drifts from the others; every
// duration goes through formatDuration.
describe("durations", () => {
  it("are formatted by formatDuration only", () => {
    const files = execSync("git ls-files --cached --others --exclude-standard app components lib hooks", { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f) && !f.includes(".vitest.") && f !== "lib/datetime/duration.ts");
    const own = files.filter((f) => /\b(function|const) format(Duration|Minutes)\b|duration_minutes\}\s*min\b/.test(readFileSync(f, "utf8")));
    expect(own).toEqual([]);
  });
});
