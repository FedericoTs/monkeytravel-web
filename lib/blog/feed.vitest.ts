import { describe, expect, it } from "vitest";
import { getAllFrontmatter } from "@/lib/blog/api";
import { blogFeedResponse, type FeedLocale } from "./feed";

/**
 * Each locale's RSS feed: a well-formed channel in that locale, one item per
 * post, every link under the locale's prefix.
 */
const CASES: Array<[FeedLocale, string, string]> = [
  ["en", "", "en"],
  ["es", "/es", "es"],
  ["it", "/it", "it"],
  ["pt", "/pt", "pt-BR"],
];

describe.each(CASES)("the %s feed", (locale, prefix, language) => {
  it("is a well-formed RSS channel with one item per post", async () => {
    const response = blogFeedResponse(locale);
    expect(response.headers.get("content-type")).toBe("application/rss+xml; charset=utf-8");

    const doc = new DOMParser().parseFromString(await response.text(), "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const channel = doc.getElementsByTagName("channel")[0];
    expect(channel.getElementsByTagName("language")[0].textContent).toBe(language);
    expect(channel.getElementsByTagName("link")[0].textContent).toBe(`https://monkeytravel.app${prefix}/blog`);
    expect(channel.getElementsByTagName("atom:link")[0].getAttribute("href")).toBe(`https://monkeytravel.app${prefix}/feed.xml`);

    const items = Array.from(doc.getElementsByTagName("item"));
    const posts = getAllFrontmatter(locale);
    expect(items).toHaveLength(posts.length);
    expect(items[0].getElementsByTagName("title")[0].textContent).toBe(posts[0].title);
    for (const item of items) {
      expect(item.getElementsByTagName("link")[0].textContent).toMatch(new RegExp(`^https://monkeytravel\\.app${prefix}/blog/[^/]+$`));
    }
  });
});
