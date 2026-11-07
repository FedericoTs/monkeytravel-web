import type { Page } from "@playwright/test";

/**
 * Closes the cookie banner with "Essential only" when it shows. It can cover
 * the wizard's footer, and a click on a covered button waits until the test
 * times out.
 */
export async function acceptEssentialOnly(page: Page) {
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
}
