import { describe, it, expect } from "vitest";
import { getAllSlugs, getPostBySlug, hasLocaleTranslation } from "./api";

/**
 * The post page renders the only <h1>, so a rendered body must have none.
 * Runs on the real content tree: the defect lives in actual posts (for
 * example a review comment placed before the markdown's own "# Title").
 */
describe("rendered post bodies carry no <h1>", () => {
  for (const locale of ["en", "es", "it", "pt"] as const) {
    it(`${locale}: every post`, async () => {
      const slugs = getAllSlugs().filter((s) => locale === "en" || hasLocaleTranslation(s, locale));
      expect(slugs.length).toBeGreaterThan(50);
      const withH1: string[] = [];
      for (const slug of slugs) {
        const post = await getPostBySlug(slug, locale);
        if (post && /<h1[\s>]/.test(post.html)) withH1.push(slug);
      }
      expect(withH1).toEqual([]);
    }, 120_000);
  }
});
