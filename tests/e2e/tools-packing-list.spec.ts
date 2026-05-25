import { test, expect } from "@playwright/test";

/**
 * /tools/packing-list — read-only render smoke tests across locales.
 * (Doesn't submit the form because that hits the AI quota.)
 */

test.describe("packing-list page @prod", () => {
  test("renders form on /tools/packing-list", async ({ page }) => {
    const res = await page.goto("/tools/packing-list");
    expect(res?.status()).toBe(200);
    // Match the first <h1> only — page may have an h1 in the navbar logo
    // sub-element + the main heading.
    await expect(page.locator("main h1").first()).toContainText(
      /packing list/i
    );
    // The form is the textarea + submit, not a literal <form> in the
    // wizard tree — use the destination input as the visible anchor.
    await expect(
      page.getByPlaceholder(/tokyo|tokio|paris|where|dónde|dove/i)
    ).toBeVisible();
  });

  test("/it/tools/packing-list renders localized h1", async ({ page }) => {
    await page.goto("/it/tools/packing-list");
    // Italian copy may pluralize: "Lista Bagaglio" or "Liste Bagaglio".
    await expect(page.locator("main h1").first()).toContainText(
      /list[ae] bagaglio/i
    );
  });

  test("/es/tools/packing-list renders localized h1", async ({ page }) => {
    await page.goto("/es/tools/packing-list");
    await expect(page.locator("main h1").first()).toContainText(
      /lista de equipaje/i
    );
  });
});
