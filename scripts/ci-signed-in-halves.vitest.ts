import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The signed-in browser tests run in two halves side by side, each on its own runner with its own local stack. The
 * branch rules require a check named `e2e`: here it is a small job that passes only when both halves did, so a
 * failing half still blocks a merge.
 */
const source = readFileSync(join(process.cwd(), ".github", "workflows", "e2e-signed-in.yml"), "utf8").replace(/\r\n/g, "\n");
/** A job's block of the workflow, from its key to the next job's. */
const job = (name: string) => {
  const at = source.indexOf(`\n  ${name}:\n`);
  if (at < 0) return "";
  const rest = source.slice(at + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 2);
};

describe("the signed-in browser tests", () => {
  it("run in two halves, each its own half, both to the end", () => {
    const halves = job("halves");
    expect(halves).toMatch(/matrix:\n\s+half: \[1, 2\]/);
    expect(halves).toContain("fail-fast: false");
    expect(halves).toContain("--shard=${{ matrix.half }}/2");
  });

  it("report as the required e2e check, green only when both halves passed", () => {
    const e2e = job("e2e");
    expect(e2e).toContain("needs: halves");
    expect(e2e).toContain("if: always()");
    expect(e2e).toContain('test "${{ needs.halves.result }}" = "success"');
  });

  it("keep each half's report apart", () => {
    expect(job("halves")).toContain("name: playwright-report-signed-in-${{ matrix.half }}");
  });
});
