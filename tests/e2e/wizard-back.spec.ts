import { test, expect } from "@playwright/test";
import { isolate } from "./wizard-draft";

/**
 * On a phone the planner's two ways back, the header's and the footer's, show
 * only an arrow. The word "Back" stays for screen readers, so each has a name
 * there: before, a screen reader met two unnamed controls.
 */
test.describe("the planner's ways back on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("each has a name, and the footer's leads back to step 1", async ({ page }) => {
    await isolate(page);
    await page.goto("/trips/new");
    const essentialOnly = page.getByRole("button", { name: /essential only/i });
    await essentialOnly
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => essentialOnly.click())
      .catch(() => {});

    const headerBack = page.getByRole("banner").getByRole("link", { name: "Back" });
    await expect(headerBack).toBeVisible();
    await expect(headerBack).toHaveAttribute("href", "/");

    await page.getByRole("group", { name: "Popular right now" }).getByRole("button").first().click();
    await page.getByRole("button", { name: /^Continue/ }).click();
    await expect(page.getByRole("heading", { name: "Set your travel style" })).toBeVisible();

    const footerBack = page.getByRole("button", { name: "Back", exact: true });
    await expect(footerBack).toBeVisible();
    // From the keyboard, as a screen reader user would.
    await footerBack.press("Enter");
    await expect(page.getByRole("heading", { name: "Set your travel style" })).toHaveCount(0);
    // Step 1 again: its destination field, with the place picked.
    await expect(page.getByRole("combobox").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Continue/ })).toBeVisible();
  });
});
