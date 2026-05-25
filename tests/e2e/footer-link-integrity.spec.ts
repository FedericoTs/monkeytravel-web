import { test, expect } from "@playwright/test";

/**
 * Footer link integrity. Catches:
 *  - Dead links (404) anywhere in the footer (e.g. the /faq → 404 bug
 *    we shipped commit 4c094aa for)
 *  - Locale-strip: an internal route href starting with "/" but missing
 *    the /es or /it prefix on those locales (e.g. /contact instead of
 *    /es/contact — same commit, raw <a> bypassed next-intl's <Link>)
 */

const LOCALES = ["/", "/it", "/es"] as const;

/** Internal route that should always honor the active locale prefix. */
function expectsLocalePrefix(href: string): boolean {
  if (!href.startsWith("/")) return false; // External, mailto:, tel:, etc.
  if (href.startsWith("//")) return false; // Protocol-relative
  // Anchor-only links resolve against the current page — they're OK.
  if (href.startsWith("/#")) return false;
  return true;
}

test.describe("footer link integrity @prod", () => {
  for (const root of LOCALES) {
    test(`footer links on ${root} resolve + carry locale prefix`, async ({
      page,
      request,
    }) => {
      await page.goto(root);
      const locale = root === "/" ? "en" : root.slice(1);

      const hrefs = await page.locator("footer a[href]").evaluateAll((els) =>
        (els as HTMLAnchorElement[]).map((a) => a.getAttribute("href") || "")
      );

      // Dedupe — same link can appear twice (top + bottom bar).
      const unique = Array.from(new Set(hrefs)).filter(Boolean);

      // 1) Locale-prefix check (only for internal routes, on non-EN sites).
      if (locale !== "en") {
        const bad: string[] = [];
        for (const href of unique) {
          if (!expectsLocalePrefix(href)) continue;
          // Valid prefixes: `/<locale>/...`, exactly `/<locale>`, or
          // `/<locale>#anchor` (locale-prefixed same-page anchors).
          const okSlash = href.startsWith(`/${locale}/`);
          const okExact = href === `/${locale}`;
          const okAnchor = href.startsWith(`/${locale}#`);
          if (!okSlash && !okExact && !okAnchor) {
            bad.push(href);
          }
        }
        expect(
          bad,
          `${locale} footer has internal links missing /${locale} prefix:\n${bad.join("\n")}`
        ).toEqual([]);
      }

      // 2) 404 check — HEAD each unique internal route. (External + mailto
      //    omitted so we don't ping random third parties from CI.)
      const dead: { href: string; status: number }[] = [];
      for (const href of unique) {
        if (!href.startsWith("/")) continue;
        if (href.startsWith("/#")) continue;
        // Strip fragment — server doesn't care about hashes.
        const path = href.split("#")[0];
        const r = await request.head(path, { failOnStatusCode: false });
        if (r.status() >= 400) {
          dead.push({ href, status: r.status() });
        }
      }
      expect(
        dead,
        `${root} footer has dead links:\n${dead.map((d) => `  ${d.href} → ${d.status}`).join("\n")}`
      ).toEqual([]);
    });
  }
});
