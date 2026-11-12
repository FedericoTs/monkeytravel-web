import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Words in an article are read, so they are set in the text colours: coral is
 * decoration (DESIGN.md), 2.7:1 on white, under the 4.5:1 a reader needs. The
 * brand stays in the underlines, borders and highlights around them.
 */

const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

/** The selector and declarations of every rule that styles the article body. */
const blogRules = [...css.matchAll(/([^{}]*\.blog-prose[^{}]*)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  body: m[2],
}));

describe("the article body's text colours", () => {
  it("has rules to check", () => {
    expect(blogRules.length).toBeGreaterThan(10);
  });

  it("sets no text in coral: links, bold words in tables and destination chips take the text colours", () => {
    const coral = blogRules.filter((r) => /(^|[;\s{])color:\s*var\(--primary(-ink)?\)/.test(r.body));
    expect(coral.map((r) => r.selector)).toEqual([]);
  });

  it("keeps the coral as the links' underline", () => {
    const link = blogRules.find((r) => r.selector === '.blog-prose a:not([class*="bg-"])');
    expect(link?.body).toMatch(/text-decoration-color:\s*var\(--primary\)/);
    expect(link?.body).toMatch(/color:\s*var\(--foreground\)/);
  });
});
