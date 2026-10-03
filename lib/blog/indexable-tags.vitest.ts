/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  TAG_MIN_POSTS_FOR_INDEX,
  getAllTagSlugs,
  getIndexableTags,
  getIndexableTagsForPost,
  getPostsByTagSlug,
} from "./tags";

/**
 * Posts and /blog link to tag archives. They must link to exactly the
 * archives the sitemap lists (enough posts to be indexed), never to a
 * noindexed thin one.
 */
describe.each(["en", "es", "it", "pt"])("indexable tags (%s)", (locale) => {
  const sitemapSet = getAllTagSlugs(locale)
    .filter((slug) => getPostsByTagSlug(slug, locale).length >= TAG_MIN_POSTS_FOR_INDEX)
    .sort();

  it("matches the sitemap's tag archives", () => {
    expect(getIndexableTags(locale).map((t) => t.slug).sort()).toEqual(sitemapSet);
    expect(sitemapSet.length).toBeGreaterThan(0);
  });

  it("keeps only a post's indexable tags, once each", () => {
    const [top] = getIndexableTags(locale);
    const out = getIndexableTagsForPost([top.display, top.display, "no such tag at all"], locale);
    expect(out).toEqual([top]);
  });
});
