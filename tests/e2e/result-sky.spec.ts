import { test, expect, type Page } from "@playwright/test";
import draft from "./fixtures/wizard-draft-paris.json";
import { isolate } from "./wizard-draft";

/**
 * The plan as a sky, which a link turns on: each day in the light its stops
 * will really have, from the true sunset for that place and date. The plan is
 * the restored Paris draft, so no model is called and nothing is written.
 */

async function restore(page: Page, variant: string) {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("e2e-draft-seeded")) return;
    localStorage.setItem("monkeytravel-itinerary-draft", JSON.stringify({ ...value, savedAt: Date.now() }));
    sessionStorage.setItem("e2e-draft-seeded", "1");
  }, draft);
  await page.goto(`/trips/new?result_variant=${variant}`);
  const essentialOnly = page.getByRole("button", { name: /essential only/i });
  await essentialOnly
    .waitFor({ state: "visible", timeout: 4_000 })
    .then(() => essentialOnly.click())
    .catch(() => {});
  await page.getByRole("button", { name: "Restore Trip" }).click({ timeout: 30_000 });
}

test.describe("the plan as a sky", () => {
  test.beforeEach(async ({ page }) => {
    await isolate(page);
  });

  test("shows every stop in its real light, opens one, and still saves", async ({ page }) => {
    await restore(page, "sky");
    const sky = page.getByTestId("sky-plan");
    await expect(sky).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Paris" })).toBeVisible();
    for (const day of draft.generatedItinerary.days) {
      for (const activity of day.activities) {
        await expect(sky.getByRole("heading", { level: 3, name: activity.name, exact: true })).toBeAttached();
      }
    }
    // The sun goes down in Paris on 10 May 2027 at 21:17, worked out from the date and the place.
    await expect(sky.getByText(/^The sun sets at 21:1\d$/).first()).toBeVisible();

    const stop = sky.locator('[data-activity-name="Eiffel Tower at Sunset"]');
    await stop.getByRole("button", { expanded: false }).click();
    await expect(stop.getByText("Book summit tickets online 60 days in advance")).toBeVisible();
    await expect(stop.getByRole("button", { name: "Maps" })).toBeVisible();

    // The classic plan isn't drawn underneath it.
    await expect(page.getByRole("heading", { name: "Day by day" })).toHaveCount(0);

    await page.getByRole("button", { name: /Save Trip/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("a link to the classic plan turns it off", async ({ page }) => {
    await restore(page, "classic");
    await expect(page.getByRole("heading", { level: 1, name: "Paris, France" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("sky-plan")).toHaveCount(0);
  });
});
