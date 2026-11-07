import { test, expect, type Page } from "@playwright/test";
import { stubGeneration } from "./generation-stub";

/**
 * The backpacker page's buttons open the planner in Backpacker Mode, and the
 * plan is asked for as a backpacker trip. The planner's own opening stays the
 * classic one. The generation is answered by the test (generation-stub.ts), so
 * no model is called, and nothing else that could write leaves the page.
 */

async function isolate(page: Page) {
  await page.route("**/*", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (/(googletagmanager|google-analytics|posthog|buildhop)\.|^maps\.googleapis\.com$/.test(url.host)) {
      return route.abort();
    }
    if (url.pathname === "/api/plans" && req.method() === "POST") {
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ token: "A".repeat(22), key: "B".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z" }),
      });
    }
    if (url.pathname.startsWith("/api/plans/")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ expiresAt: "2099-01-01T00:00:00.000Z" }) });
    }
    if (/^\/api\/(wizard-event|consent-event|page-engaged|page-view|session)/.test(url.pathname)) {
      return route.fulfill({ status: 204, body: "" });
    }
    if (/^\/api\/(places|images|img)(\/|$)/.test(url.pathname) || req.resourceType() === "image") {
      return route.abort();
    }
    return route.continue();
  });
}

const modeOn = (page: Page) => page.getByRole("button", { name: /Backpacker mode — ON/ });

test.describe("the backpacker page", () => {
  test("its main button opens the planner in Backpacker Mode, which can be switched off", async ({ page }) => {
    await isolate(page);
    await page.goto("/backpacker");
    await page.getByRole("link", { name: "Plan a backpacker trip" }).first().click();
    await expect(page).toHaveURL(/\/trips\/new\?style=backpacker/);
    await expect(modeOn(page)).toBeVisible();

    await modeOn(page).click();
    await expect(modeOn(page)).toHaveCount(0);
  });

  test("a sample route fills the place, and the plan is asked for as a backpacker trip", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    await page.goto("/backpacker");
    await page.locator('a[href*="destination=Lisbon"]').first().click();
    await expect(page).toHaveURL(/destination=Lisbon&style=backpacker/);
    await expect(modeOn(page)).toBeVisible();

    await page.getByRole("button", { name: /^Weekend$/ }).click();
    await page.getByTestId("wizard-continue").click();
    await page.getByRole("heading", { name: "Set your travel style" }).waitFor();
    const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
    const generate = page.getByRole("button", { name: "Generate Itinerary" });
    await expect(async () => {
      if (await generate.isDisabled()) await foodie.click();
      await expect(generate).toBeEnabled({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await generate.click();

    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0].travelStyle).toBe("backpacker");
    expect(streamed[0].destination).toMatch(/lisbon/i);
  });
});

test("the planner opens in the classic style on its own", async ({ page }) => {
  await isolate(page);
  await page.goto("/trips/new");
  await page.getByRole("button", { name: /^Continue/ }).first().waitFor();
  await expect(modeOn(page)).toHaveCount(0);
});
