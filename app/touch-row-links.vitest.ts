import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * On a touch screen every link is at least 44 px tall (app/globals.css). A text
 * link that is an item of a flex row becomes a box of that height with its
 * words at the top, while the row's separators sit in the middle: a breadcrumb
 * read "Home" on one line and its slash on the next. Such links centre their
 * words in the box. These pages render on the server, so the check reads their
 * source; the live check is a phone-sized screenshot.
 */

const read = (file: string) => readFileSync(join(__dirname, "..", file), "utf-8").replace(/\r\n/g, "\n");
const CENTRED = /\binline-flex items-center\b/;

const BREADCRUMB_ROWS = [
  "app/[locale]/blog/page.tsx",
  "app/[locale]/blog/tag/[tag]/page.tsx",
  "app/[locale]/blog/[slug]/page.tsx",
  "app/[locale]/destinations/page.tsx",
  "app/[locale]/destinations/style/[tag]/page.tsx",
  "app/[locale]/destinations/[slug]/page.tsx",
];

describe("text links in a row, on a touch screen", () => {
  it.each(BREADCRUMB_ROWS)("%s centres each breadcrumb link's words", (file) => {
    const src = read(file);
    const start = src.search(/<nav aria-label=\{t(?:A11y|Common)\("(?:a11y\.)?breadcrumb"\)\} className="flex items-center/);
    expect(start).toBeGreaterThan(-1);
    const row = src.slice(start, src.indexOf("</nav>", start));
    const links = row.match(/<Link\b[^>]*>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(CENTRED);
  });

  it("centres each language link's words beside its dot", () => {
    const src = read("components/i18n/LanguageAlternates.tsx");
    const link = src.match(/<a\s[^>]*hrefLang[^>]*>/)?.[0] ?? "";
    expect(link).not.toBe("");
    expect(link).toMatch(CENTRED);
  });
});
