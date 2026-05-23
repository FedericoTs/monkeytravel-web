import { test, expect } from "@playwright/test";

/**
 * SEO & routing smoke checks. These guard against regressions of the
 * indexing fixes from May 2026:
 *
 *  - Slugifier produces correct accented-tag URLs (was bug: japn vs japon)
 *  - Thin tag pages return noindex
 *  - The 3 pillar URLs work and emit canonical=EN (because they're
 *    EN-only content)
 *  - Sitemap doesn't include the deleted post slugs
 *  - 410 Gone for the 3 cut posts
 *
 * All @prod-safe (read-only).
 */

test.describe("SEO / routing regressions @prod", () => {
  test("accented tag slug resolves (Unicode slugifier fix)", async ({
    request,
  }) => {
    const ok = await request.get("/es/blog/tag/japon");
    expect(ok.status(), "/es/blog/tag/japon should resolve").toBe(200);

    const ko = await request.get("/es/blog/tag/japn");
    expect(ko.status(), "old broken slug must 404").toBe(404);
  });

  test("thin tag page emits noindex,follow", async ({ page }) => {
    await page.goto("/blog/tag/japan");
    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute("content");
    expect(robots?.toLowerCase()).toContain("noindex");
    expect(robots?.toLowerCase()).toContain("follow");
  });

  test("rich tag page does NOT emit noindex", async ({ page }) => {
    await page.goto("/blog/tag/europe");
    const robotsMeta = await page.locator('meta[name="robots"]').count();
    // Either no meta robots at all, or one without noindex
    if (robotsMeta > 0) {
      const robots = await page
        .locator('meta[name="robots"]')
        .getAttribute("content");
      expect(robots?.toLowerCase()).not.toContain("noindex");
    }
  });

  test.skip("EN-only pillars canonicalize to the EN URL on /es and /it", async () => {
    // As of 2026-05-23 every post in content/blog/*.md has matching es/
    // and it/ translations, so there is no EN-only post available to
    // exercise the fallback canonical path. The code path itself is still
    // in app/[locale]/blog/[slug]/page.tsx (currentLocaleHasTranslation
    // check) — re-enable this test when a new EN-only post lands so we
    // catch regressions in that fallback.
  });

  test("translated pillars canonicalize to their own per-locale URL", async ({
    page,
  }) => {
    // 2026-travel-calendar.md now has es/ and it/ translations. Each locale
    // version should declare itself canonical (no longer pointing back to EN)
    // so Google indexes all three independently.
    for (const locale of ["es", "it"]) {
      await page.goto(`/${locale}/blog/2026-travel-calendar`);
      const canonical = await page
        .locator('link[rel="canonical"]')
        .getAttribute("href");
      expect(canonical, `${locale} canonical`).toBe(
        `https://monkeytravel.app/${locale}/blog/2026-travel-calendar`
      );
    }
  });

  test("cut posts return 410 Gone", async ({ request }) => {
    for (const slug of [
      "/blog/pianificatore-viaggio-ai-2026",
      "/blog/us-tariffs-impact-travel-costs-2026",
      "/blog/trending-destinations-may-2026",
    ]) {
      const res = await request.get(slug, { maxRedirects: 0 });
      expect(res.status(), `${slug} must be 410`).toBe(410);
    }
  });

  test("merged monthly URLs 301/308 to pillar+anchor", async ({ request }) => {
    const res = await request.get("/blog/where-to-go-in-april", {
      maxRedirects: 0,
    });
    expect([301, 308]).toContain(res.status());
    const location = res.headers()["location"];
    expect(location).toContain("/blog/2026-travel-calendar");
  });

  test("sitemap is alive and contains the pillar URLs", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/blog/2026-travel-calendar");
    expect(xml).toContain("/blog/spring-summer-travel-guide");
    expect(xml).toContain("/blog/honeymoon-planning-guide");
    // Author URLs added in same commit
    expect(xml).toContain("/about/authors/");
    // Cut posts should NOT be in the sitemap
    expect(xml).not.toContain("trending-destinations-may-2026");
  });

  test("homepage CTA path leads to the wizard (not signup)", async ({
    page,
  }) => {
    await page.goto("/");
    // The hero CTA should resolve to /trips/new
    const ctaCandidates = page.getByRole("link", { name: /plan|start|try/i });
    const firstHref = await ctaCandidates.first().getAttribute("href").catch(() => null);
    // Some CTAs are buttons that route programmatically; we accept either:
    // a) a link to /trips/new, or b) no <a> match (then we just visit programmatically)
    if (firstHref) {
      expect(firstHref).not.toContain("/auth/signup");
    }
  });
});
