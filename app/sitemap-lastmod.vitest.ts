import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Guards the hardcoded LASTMOD_* constants in app/sitemap.ts against silent rot.
 *
 * Hardcoding them is deliberate — see the comment in sitemap.ts. An inaccurate
 * lastmod is worse than a stale one, so we don't want a build stamping "today"
 * on every URL. But the values still have to be MAINTAINED, and until
 * 2026-08-25 they were not: the homepage declared 2026-04-30 while 26 commits
 * had touched homepage-rendered files since.
 *
 * That failure was invisible in two places at once. Google was told our
 * best-converting page hadn't changed in four months, and
 * `scripts/indexnow-submit.mts --since N` filters on lastmod, so the homepage
 * was silently dropped from every IndexNow submission.
 *
 * This reads the constants out of sitemap.ts as TEXT rather than importing it.
 * sitemap.ts is a Next route module whose default export Next owns, and it
 * pulls in `server-only` transitively — parsing avoids both problems.
 *
 * Skips (does not fail) when git history isn't available: a shallow CI clone
 * has no real dates to compare against, and a false failure there would be
 * worse than no check.
 */

const SITEMAP = join(__dirname, "sitemap.ts");
const REPO = join(__dirname, "..");

/** Files whose change means that content type genuinely changed. */
const COVERAGE: Record<string, string[]> = {
  // The homepage renders from landing.json — there is no home.json. The
  // dead-path assertion below caught that when this list first claimed one.
  LASTMOD_HOMEPAGE: [
    "app/[locale]/page.tsx",
    "components/marketing",
    "messages/en/landing.json",
  ],
  LASTMOD_LANDING: [
    "app/[locale]/free-ai-trip-planner",
    "app/[locale]/backpacker",
    "app/[locale]/budget-trip-planner",
    "app/[locale]/family-trip-planner",
    "app/[locale]/group-trip-planner",
    "app/[locale]/solo-trip-planner",
    "app/[locale]/weekend-trip-planner",
    "app/[locale]/multi-city-trip-planner",
    "app/[locale]/ai-itinerary-generator",
    "app/[locale]/tools",
    "app/[locale]/explore",
  ],
  LASTMOD_DESTINATIONS: [
    "lib/destinations/data.ts",
    "app/[locale]/destinations",
    "messages/en/destinations.json",
  ],
  LASTMOD_LEGAL: ["app/[locale]/privacy", "app/[locale]/terms"],
};

function gitAvailable(): boolean {
  try {
    const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: REPO,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return shallow === "false";
  } catch {
    return false;
  }
}

/** YYYY-MM-DD of the newest commit touching any of `paths`, or null. */
function lastCommitDate(paths: string[]): string | null {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%ad", "--date=short", "--", ...paths],
      { cwd: REPO, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function declaredValue(source: string, name: string): string | null {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*"(\\d{4}-\\d{2}-\\d{2})"`).exec(source);
  return m ? m[1] : null;
}

describe("sitemap LASTMOD constants track real content changes", () => {
  const source = readFileSync(SITEMAP, "utf-8");
  const haveGit = gitAvailable();

  for (const [name, paths] of Object.entries(COVERAGE)) {
    it(`${name} is not behind its content`, () => {
      const declared = declaredValue(source, name);
      expect(declared, `${name} not found in sitemap.ts`).not.toBeNull();

      if (!haveGit) return; // shallow clone / no git — nothing trustworthy to compare
      const actual = lastCommitDate(paths);
      if (!actual) return; // paths matched no history (renamed?) — don't fail blind

      expect(
        declared! >= actual,
        `${name} declares ${declared} but ${paths[0]} et al. last changed ${actual}. ` +
          `Bump the constant in app/sitemap.ts. Stale lastmod also removes these URLs ` +
          `from 'npm run seo:indexnow -- --since N', which filters on lastmod.`,
      ).toBe(true);
    });
  }

  it("declares no lastmod in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const name of Object.keys(COVERAGE)) {
      const declared = declaredValue(source, name);
      expect(declared! <= today, `${name} declares ${declared}, which is in the future`).toBe(true);
    }
  });

  it("every covered path still exists, so the guard cannot silently pass", () => {
    if (!haveGit) return;
    for (const [name, paths] of Object.entries(COVERAGE)) {
      for (const p of paths) {
        const tracked = execFileSync("git", ["ls-files", "--", p], {
          cwd: REPO,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        expect(
          tracked.length > 0,
          `${name} covers "${p}", which matches no tracked file — the guard for ` +
            `that path is dead. Update COVERAGE in this file.`,
        ).toBe(true);
      }
    }
  });
});
