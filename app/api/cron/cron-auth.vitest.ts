/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Every cron route is public on the internet. Each must refuse everything but
 * the cron's bearer token, through the one shared check.
 */
const DIR = join(process.cwd(), "app", "api", "cron");
const ROUTES = readdirSync(DIR)
  .map((name) => join(DIR, name, "route.ts"))
  .filter((file) => existsSync(file));

describe("cron routes", () => {
  it("are found", () => {
    expect(ROUTES.length).toBeGreaterThan(10);
  });

  it.each(ROUTES)("%s refuses everything but the cron", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("refuseUnlessCron(request)");
    expect(src, "reads the secret itself").not.toMatch(/process\.env\.CRON_SECRET/);
  });
});
