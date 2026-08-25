import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPostBySlug } from "./api";

/**
 * Guards localizeInternalLinks in api.ts.
 *
 * Runs against the REAL content tree, because the defect being guarded is
 * "the rendered HTML on a locale page links to the English article" — a
 * property of actual posts, which a fixture cannot be wrong about.
 */

/** Root-relative hrefs in rendered post HTML, excluding anchors and externals. */
function rootRelativeHrefs(html: string): string[] {
  return [...html.matchAll(/href="(\/[^"]*)"/g)]
    .map((m) => m[1])
    .filter((h) => !h.startsWith("//"));
}

const LOCALE_SEG = /^\/(en|es|it|pt)(\/|$)/;

describe("locale list stays in sync with routing", () => {
  /**
   * routing.ts is read as TEXT, not imported.
   *
   * Importing it calls createNavigation(), which resolves `next/navigation`
   * and throws outside a Next runtime — which is precisely why api.ts
   * hardcodes its own copy of the list (two .mts scripts import api.ts under
   * tsx). Parsing the source is the only drift guard that works from here, and
   * it still fails loudly if someone adds a locale in one place only.
   */
  function localesFromRoutingSource(): { locales: string[]; defaultLocale: string } {
    const src = readFileSync(join(process.cwd(), "lib/i18n/routing.ts"), "utf8");
    const list = /locales:\s*\[([^\]]*)\]/.exec(src);
    const def = /defaultLocale:\s*"([a-z]{2})"/.exec(src);
    if (!list || !def) throw new Error("routing.ts shape changed — update this parser");
    return {
      locales: [...list[1].matchAll(/"([a-z]{2})"/g)].map((m) => m[1]),
      defaultLocale: def[1],
    };
  }

  it("api.ts's duplicated LOCALES matches lib/i18n/routing.ts", () => {
    const { locales, defaultLocale } = localesFromRoutingSource();
    expect([...locales].sort()).toEqual(["en", "es", "it", "pt"].sort());
    expect(defaultLocale).toBe("en");
  });
});

describe("in-body links are locale-prefixed", () => {
  // A post with a lot of in-body internal links in every locale.
  const SLUG = "best-ai-trip-planners-2026-compared";

  for (const locale of ["es", "it", "pt"] as const) {
    it(`${locale}: every root-relative in-body href carries the locale`, async () => {
      const post = await getPostBySlug(SLUG, locale);
      expect(post).not.toBeNull();
      const hrefs = rootRelativeHrefs(post!.html);
      // Guard the guard: if the post stops having in-body links, this test
      // would pass vacuously and hide a regression.
      expect(hrefs.length).toBeGreaterThan(3);

      const unprefixed = hrefs.filter((h) => !h.startsWith(`/${locale}`));
      expect(unprefixed, `${locale} leaks to another locale: ${unprefixed.join(", ")}`)
        .toEqual([]);
    });
  }

  it("en is left alone — it is the default locale and takes no prefix", async () => {
    const post = await getPostBySlug(SLUG, "en");
    const hrefs = rootRelativeHrefs(post!.html);
    expect(hrefs.length).toBeGreaterThan(3);
    // No href should have picked up a locale segment on the English page.
    expect(hrefs.filter((h) => LOCALE_SEG.test(h))).toEqual([]);
  });

  it("does not double-prefix links that were already hand-prefixed", async () => {
    // es/it files contain ~145 links written as /es/blog/... by hand. Those
    // must survive untouched rather than becoming /es/es/blog/...
    for (const locale of ["es", "it"] as const) {
      const post = await getPostBySlug("how-to-plan-a-group-trip", locale);
      const doubled = rootRelativeHrefs(post!.html).filter((h) =>
        new RegExp(`^/${locale}/(en|es|it|pt)(/|$)`).test(h),
      );
      expect(doubled, `double-prefixed in ${locale}`).toEqual([]);
    }
  });

  it("keeps the wizard CTA on the reader's locale", async () => {
    const post = await getPostBySlug("how-to-plan-a-multi-city-trip", "es");
    // The in-body CTA carries the route-builder prefill; it must not drop the
    // reader onto the English wizard.
    expect(post!.html).toContain('href="/es/trips/new?multi=1"');
    expect(post!.html).not.toContain('href="/trips/new?multi=1"');
  });
});
