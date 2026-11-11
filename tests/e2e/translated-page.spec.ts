import { test, expect } from "@playwright/test";
import { stubGeneration } from "./generation-stub";
import { translator } from "./browser-translator";
import { acceptEssentialOnly } from "./consent-banner";
import { isolate } from "./wizard-draft";

/** A planner the visitor's browser is translating still goes from step to step and makes a plan. */

test.describe("a page the browser translates", () => {
  test("the planner goes on to the next step and to a plan", async ({ page }) => {
    await isolate(page);
    await stubGeneration(page);

    await page.goto("/trips/new");
    await acceptEssentialOnly(page);
    const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
    const place = (await pick.getAttribute("aria-label"))?.match(/^Start a trip to (.+) — /)?.[1];
    expect(place, "the pick names its place").toBeTruthy();

    await page.evaluate(translator);
    await expect(page.locator("h1 font").first()).toBeAttached();

    await pick.click();
    await expect(page.getByRole("combobox").first()).toHaveValue(place!);
    await page.getByRole("button", { name: /^Continue/ }).click();
    await expect(page.getByRole("heading", { name: "Set your travel style" })).toBeVisible();
    // Words that change with the step change here too, instead of staying in the old translation.
    await expect(page.getByText("2/2")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Continue/ })).toHaveCount(0);

    const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
    const generate = page.getByRole("button", { name: "Generate Itinerary" });
    await expect(async () => {
      if (await generate.isDisabled()) await foodie.click();
      await expect(generate).toBeEnabled({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await generate.click();

    await expect(page.getByRole("heading", { level: 1, name: place })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
});
