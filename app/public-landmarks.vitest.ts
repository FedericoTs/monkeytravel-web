import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Landmarks are how a screen reader jumps around a page: to the header, the
 * main area, one navigation or another. These public pages render on the
 * server, so the checks read their source. The live check is an axe scan of
 * the deployed pages (outside CI).
 */

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf-8");

// Pages and parts that sit beside the top bar's own navigation: each of their
// navigations needs a name, or a screen reader lists several "navigation" alike.
const NAMED_NAVS = [
  "app/[locale]/(app)/explore/page.tsx",
  "app/[locale]/blog/page.tsx",
  "app/[locale]/blog/tag/[tag]/page.tsx",
  "app/[locale]/blog/[slug]/page.tsx",
  "app/[locale]/destinations/page.tsx",
  "app/[locale]/destinations/style/[tag]/page.tsx",
  "app/[locale]/destinations/[slug]/page.tsx",
  "app/[locale]/tools/page.tsx",
  "app/[locale]/tools/check-my-plan/page.tsx",
  "app/[locale]/tools/packing-list/page.tsx",
  "app/[locale]/tools/visa-checker/page.tsx",
  "components/blog/BlogContentClient.tsx",
  "components/blog/BlogSidebar.tsx",
];

describe("navigations on the public pages", () => {
  it.each(NAMED_NAVS)("%s names each navigation", (file) => {
    const navs = read(file).match(/<nav\b[^>]*>/g) ?? [];
    expect(navs.length).toBeGreaterThan(0);
    for (const nav of navs) expect(nav).toMatch(/aria-label=/);
  });

  it("names breadcrumbs in the page's language, not in English everywhere", () => {
    for (const file of NAMED_NAVS) expect(read(file)).not.toMatch(/aria-label="Breadcrumb"/);
  });
});

describe("parts that sit inside an article's main area", () => {
  // A complementary landmark belongs at the top level of the page, not inside main.
  it.each(["components/blog/BlogInlineAiCta.tsx", "components/blog/BlogSidebar.tsx"])("%s is not an aside", (file) => {
    expect(read(file)).not.toMatch(/<aside\b/);
  });
});

describe("the explore page", () => {
  const src = read("app/[locale]/(app)/explore/page.tsx");

  it("keeps its hero in a header landmark, before main", () => {
    const header = src.indexOf("<header");
    const main = src.indexOf("<main");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(main);
    expect(src.slice(0, main)).not.toMatch(/<section\b/);
  });

  it("heads the trip cards with the trip count, so headings go 1, 2, 3", () => {
    expect(src).toMatch(/<h2[^>]*>\s*\{total === 0/);
  });
});
