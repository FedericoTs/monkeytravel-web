import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural guard: every destination defined in lib/destinations/data.ts MUST
 * ship a cover image at public/images/destinations/<slug>.jpg. This is the same
 * invariant the `prebuild` step enforces on Vercel — keeping it in the unit
 * suite means `npm test` catches drift locally too.
 *
 * We parse the source text rather than importing the module so we don't pull in
 * its `server-only` guard (which throws outside a server bundle).
 */
const ROOT = process.cwd();
const src = readFileSync(join(ROOT, "lib", "destinations", "data.ts"), "utf8");
const slugs = [...src.matchAll(/\bslug:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);

describe("destination covers", () => {
  it("parses a sane number of unique destinations from data.ts", () => {
    // Guards against the parser silently breaking and reporting zero slugs.
    expect(slugs.length).toBeGreaterThanOrEqual(20);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each(slugs)("has a cover image for '%s'", (slug) => {
    const p = join(ROOT, "public", "images", "destinations", `${slug}.jpg`);
    expect(
      existsSync(p),
      `Missing cover: public/images/destinations/${slug}.jpg — run 'npm run covers:backfill'`
    ).toBe(true);
  });
});
