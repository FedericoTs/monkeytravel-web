import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A pull request's new push cancels its own older run: only its head matters. A run on master must finish, or the
 * change it tests goes live with no verdict. GitHub keeps one waiting run per group and replaces it with a newer one,
 * so master's runs need a group per commit, not just no cancelling.
 */
const WORKFLOWS = ["ci.yml", "e2e-public.yml", "e2e-signed-in.yml"];
const read = (name: string) => readFileSync(join(process.cwd(), ".github", "workflows", name), "utf8");
const groupOf = (source: string) => {
  const lines = source.split(/\r?\n/);
  const at = lines.indexOf("concurrency:");
  return lines.slice(at + 1).find((line) => line.startsWith("  group: "))?.slice("  group: ".length);
};

describe("the check runs", () => {
  it.each(WORKFLOWS)("in %s give each push to master a group of its own, so none is cancelled or replaced", (name) => {
    const group = groupOf(read(name));
    expect(group).toContain("${{ github.ref }}");
    expect(group).toContain("${{ github.event_name == 'push' && github.sha || 'latest' }}");
  });

  it.each(WORKFLOWS)("in %s still run on every push to master", (name) => {
    expect(read(name)).toMatch(/push:\s*\n\s*branches: \[master\]/);
  });
});
