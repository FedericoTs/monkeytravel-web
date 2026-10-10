import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A trip reaches Explore only through POST /api/trips/[id]/publish, which
 * asks before publishing fixed plans and applies the activity, length and
 * weekly limits. These guards fail if another route starts listing trips.
 * Unpublishing and stopping sharing take a trip off, and clear the stamp.
 */

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r/g, "");

function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  return readdirSync(abs).flatMap((name) => {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) && !/\.vitest\.tsx?$/.test(name) ? [rel] : [];
  });
}

const PUBLISH_ROUTE = path.join("app", "api", "trips", "[id]", "publish", "route.ts");
const SHARE_ROUTE = path.join("app", "api", "trips", "[id]", "share", "route.ts");

// Every file that writes the listing column; one scan serves both guards.
let writers: Array<[string, string]> | undefined;
const listingWriters = () =>
  (writers ??= ["app", "lib", "components"]
    .flatMap(sourceFiles)
    .map((file): [string, string] => [file, read(file)])
    .filter(([, src]) => /submitted_to_trending_at\s*:/.test(src)));

describe("Explore listing", () => {
  // Reads every source file: give it room when the whole suite runs at once.
  it("only the publish route sets the listing column", () => {
    const setters = listingWriters().filter(([, src]) => /submitted_to_trending_at\s*:(?!\s*null\b)/.test(src));
    expect(setters.map(([file]) => file)).toEqual([PUBLISH_ROUTE]);
  }, 30_000);

  it("only unpublishing and stopping sharing clear it", () => {
    const clearers = listingWriters().filter(([, src]) => /submitted_to_trending_at\s*:\s*null\b/.test(src));
    expect(clearers.map(([file]) => file).sort()).toEqual([PUBLISH_ROUTE, SHARE_ROUTE].sort());
  }, 30_000);

  it("the unchecked submit-trending route stays gone", () => {
    expect(existsSync(path.join(ROOT, "app/api/trips/[id]/submit-trending"))).toBe(false);
  });

  it("the share window lists a trip through the publish modal", () => {
    const modal = read("components/trip/ShareAndInviteModal.tsx");
    expect(modal).not.toContain("submit-trending");
    expect(modal).toContain("onRequestPublish?.()");
    expect(read("components/trip/ShareButton.tsx")).toMatch(/<PublishTripModal\b/);
  });
});
