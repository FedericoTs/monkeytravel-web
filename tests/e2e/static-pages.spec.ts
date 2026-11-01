import { test, expect } from "@playwright/test";

/**
 * Static pages: /contact, /privacy, /terms.
 *
 * Checks that:
 *  - /contact renders with the Navbar and Footer;
 *  - /privacy and /terms titles leave the brand to the root template
 *    "%s | MonkeyTravel", so it never shows twice ("X - MonkeyTravel |
 *    MonkeyTravel"), and they carry locale canonical/hreflang links.
 */

test.describe("static pages — chrome + metadata @prod", () => {
  const CONTACT_PATHS = ["/contact", "/it/contact", "/es/contact"] as const;

  for (const path of CONTACT_PATHS) {
    test(`${path} has Navbar + Footer (not orphaned)`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      // Navbar lives at <nav> within <header>; Footer is <footer>. Both
      // must exist so the user has back-to-home links.
      await expect(page.locator("nav").first()).toBeVisible();
      await expect(page.locator("footer")).toBeVisible();
    });
  }

  test("/privacy title is 'Privacy Policy | MonkeyTravel' (no double brand)", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page).toHaveTitle("Privacy Policy | MonkeyTravel");
  });

  test("/terms title is 'Terms of Service | MonkeyTravel' (no double brand)", async ({
    page,
  }) => {
    await page.goto("/terms");
    await expect(page).toHaveTitle("Terms of Service | MonkeyTravel");
  });

  // The legal text is English in every locale, so the locale copies point at
  // the English page — never at the homepage the root layout defaults to.
  const LEGAL_CANONICALS = [
    ["/it/privacy", "https://monkeytravel.app/privacy"],
    ["/it/terms", "https://monkeytravel.app/terms"],
    ["/es/privacy", "https://monkeytravel.app/privacy"],
  ] as const;

  for (const [path, expected] of LEGAL_CANONICALS) {
    test(`${path} canonical points at the English page`, async ({ page }) => {
      await page.goto(path);
      const canonical = await page
        .locator("link[rel='canonical']")
        .getAttribute("href");
      expect(canonical).toBe(expected);
    });
  }
});
