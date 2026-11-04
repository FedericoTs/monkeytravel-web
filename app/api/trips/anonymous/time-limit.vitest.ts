/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * A signed-out share answers with the link at once, then upgrades the trip's
 * photos and picks its cover after the response (after() in route.ts), within
 * the same function's time limit. The trips glob caps that at 10 s, and a
 * 14-day share was cut off mid-enrichment: no photos, and no cover, so the
 * shared page showed a bare gradient. Asserted against vercel.json, like the
 * audience sync's limit.
 */

const SRC = readFileSync(join(__dirname, "route.ts"), "utf8");
const VERCEL = JSON.parse(
  readFileSync(join(__dirname, "../../../../vercel.json"), "utf8")
) as { functions: Record<string, { maxDuration?: number }> };
const KEY = "app/api/trips/anonymous/route.ts";
const TRIPS_GLOB = "app/api/trips/*/route.ts";

describe("signed-out share time limit", () => {
  it("still upgrades the photos and picks the cover after the response", () => {
    expect(SRC).toMatch(/after\(async \(\) => \{[\s\S]*enrichTripByIdAdmin\([\s\S]*backfillCoverFromItinerary\(/);
  });

  it("leaves that work the time the shared-trips backfill cron gets", () => {
    expect(VERCEL.functions[KEY]?.maxDuration ?? 0).toBeGreaterThanOrEqual(VERCEL.functions["app/api/cron/*/route.ts"].maxDuration ?? 60);
  });

  it("is configured ahead of the trips glob that would cap it at 10 s", () => {
    const keys = Object.keys(VERCEL.functions);
    expect(keys.indexOf(KEY)).toBeGreaterThanOrEqual(0);
    expect(keys.indexOf(KEY)).toBeLessThan(keys.indexOf(TRIPS_GLOB));
  });
});
