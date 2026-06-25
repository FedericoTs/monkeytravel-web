import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * Structural guard, defense-in-depth: run the EXACT check the `prebuild` step
 * (and every Vercel deploy) runs, so `npm test` fails for the same reasons a
 * deploy would — a missing cover, OR a destination slug that isn't a plain
 * lowercase-hyphen literal. Invoking the real script (rather than re-deriving
 * slugs here) means there is one parser, with no chance of the test and the
 * build guard drifting apart.
 */
describe("destination covers guard", () => {
  it("every destination in data.ts has a cover (scripts/destination-covers.mjs --check)", () => {
    expect(() =>
      execFileSync("node", ["scripts/destination-covers.mjs", "--check"], {
        stdio: "pipe",
      })
    ).not.toThrow();
  });
});
