import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * A trip reaches Explore only through POST /api/trips/[id]/publish, which
 * asks before publishing fixed plans and applies the activity, length and
 * weekly limits. These guards fail if another route starts listing trips.
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

describe("Explore listing", () => {
  it("only the publish route writes the listing column", () => {
    const writers = ["app", "lib", "components"]
      .flatMap(sourceFiles)
      .filter((file) => /submitted_to_trending_at\s*:/.test(read(file)));
    expect(writers).toEqual([path.join("app", "api", "trips", "[id]", "publish", "route.ts")]);
  });

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
