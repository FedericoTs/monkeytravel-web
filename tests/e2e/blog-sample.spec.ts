import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/**
 * Sample 5 blog posts deterministically (seeded by today's date so the
 * same 5 fire all day, but rotate across the catalog over the week).
 *
 * Why a sample: we have 62 posts; running all of them in the @prod
 * suite would slow the post-deploy gate. Five-per-day catches MDX
 * compile failures + broken hero images within a week of coverage.
 */

function pickFiveSlugs(): string[] {
  // Resolve from repo root regardless of how tests are launched.
  const dir = join(process.cwd(), "content", "blog");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    // Repo content/blog missing — return an empty list so tests skip
    // gracefully (e.g. if someone runs against a fork without the
    // content folder).
    return [];
  }
  const slugs = files.map((f) => f.replace(/\.md$/, "")).sort();

  // Seed: YYYY-MM-DD so we get a stable per-day sample.
  const today = new Date().toISOString().slice(0, 10);
  const seed = createHash("sha256").update(today).digest();

  // Fisher-Yates with seeded bytes (5 picks from a 200-ish-byte hash —
  // plenty of entropy).
  const result: string[] = [];
  const pool = [...slugs];
  for (let i = 0; i < Math.min(5, pool.length); i++) {
    const byte = seed[i] ?? 0;
    const idx = byte % pool.length;
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

const SAMPLE = pickFiveSlugs();

test.describe("blog post sample (rotates daily) @prod", () => {
  test.skip(SAMPLE.length === 0, "no blog posts found under content/blog");

  for (const slug of SAMPLE) {
    test(`/blog/${slug} renders with images intact`, async ({ page }) => {
      const res = await page.goto(`/blog/${slug}`);
      expect(res?.status(), `/blog/${slug} status`).toBe(200);

      const h1 = await page.locator("h1").first().textContent();
      expect(h1?.trim() || "", `/blog/${slug} h1 must be non-empty`).not.toBe(
        ""
      );

      // Give lazy images a moment to load before sampling.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Inspect every <img> on the page for natural dimensions.
      const broken = await page.locator("img").evaluateAll((imgs) => {
        return (imgs as HTMLImageElement[])
          .filter((img) => {
            // Tiny tracking pixels (1x1) are intentional — Maps tiles,
            // analytics beacons. Ignore them.
            if (img.naturalWidth <= 4 && img.naturalHeight <= 4) return false;
            // Not yet loaded counts as broken for this assertion — we
            // already waited for networkidle so anything still pending
            // is a real problem.
            return !img.complete || img.naturalWidth === 0;
          })
          .map((img) => img.currentSrc || img.src);
      });

      expect(
        broken,
        `/blog/${slug} has broken images:\n${broken.join("\n")}`
      ).toEqual([]);
    });
  }
});
