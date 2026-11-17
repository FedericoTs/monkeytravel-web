import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The articles whose readers need a tool link it near the top, in their own language: the packing checklist to the
 * packing list generator, the visa articles to the visa checker. A rewrite of an article keeps the link.
 */
const ARTICLES: Array<[slug: string, tool: string]> = [
  ["travel-packing-checklist", "tools/packing-list"],
  ["visa-free-destinations-by-passport", "tools/visa-checker"],
  ["visa-requirements-us-citizens", "tools/visa-checker"],
];
const LOCALES = ["en", "es", "it", "pt"] as const;
const read = (slug: string, locale: (typeof LOCALES)[number]) =>
  readFileSync(join(process.cwd(), "content", "blog", locale === "en" ? "" : locale, `${slug}.md`), "utf8");

describe("articles that lead to a tool", () => {
  for (const [slug, tool] of ARTICLES) {
    it.each(LOCALES)(`${slug} links ${tool} in %s, in its own language, before its second section`, (locale) => {
      const text = read(slug, locale);
      const href = `(${locale === "en" ? "" : `/${locale}`}/${tool})`;
      const at = text.indexOf(href);
      expect(at).toBeGreaterThan(-1);
      const sections = [...text.matchAll(/\r?\n## /g)].map((m) => m.index ?? 0);
      expect(at).toBeLessThan(sections[1] ?? Infinity);
    });
  }

  it("never puts the link's sentence right above a rule, where it would become a heading", () => {
    for (const [slug, tool] of ARTICLES) {
      for (const locale of LOCALES) {
        const line = read(slug, locale).split(/\r?\n/).findIndex((l) => l.includes(tool));
        const next = read(slug, locale).split(/\r?\n/)[line + 1];
        expect(next, `${locale}/${slug}`).toBe("");
      }
    }
  });
});
