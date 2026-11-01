// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Comments describe the code as it is now. A date in one tells how the code
 * got here, which the git history keeps and the comment lets go stale. The
 * count can only go down: lower CEILING when a change removes some.
 */
const CEILING = 150;

const DATED = /^\s*(\/\/|\*|\/\*).*\b20\d{2}-\d{2}(-\d{2})?\b/;
const SOURCE = /^(app|lib|components|hooks|scripts|tests|types)\/.*\.(ts|tsx|mts|cts|js|mjs)$/;

function datedCommentLines(): Array<{ file: string; line: string }> {
  const files = execSync("git ls-files", { encoding: "utf8" })
    .split("\n")
    .filter((f) => SOURCE.test(f));
  return files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => DATED.test(line))
      .map((line) => ({ file, line: line.trim() })),
  );
}

describe("dated comments", () => {
  it(`stay at or under ${CEILING} lines`, () => {
    const found = datedCommentLines();
    expect(found.length, `${found.length} comment lines carry a date (ceiling ${CEILING}): say what the code does now instead`).toBeLessThanOrEqual(CEILING);
  });

  it("spots a date in a line or block comment, not in code", () => {
    expect(DATED.test("  // Live, 2026-11-01: a reply said it was done")).toBe(true);
    expect(DATED.test("   * added on 2026-09 for the cruise trip")).toBe(true);
    expect(DATED.test('  const start = "2026-11-24";')).toBe(false);
  });
});
