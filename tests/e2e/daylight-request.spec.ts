import { test, expect, type Page } from "@playwright/test";
import { acceptEssentialOnly } from "./consent-banner";
import { stubGeneration } from "./generation-stub";
import { isolate } from "./wizard-draft";

/**
 * A plan is told the real sunrise and sunset when the planner knows where the
 * place is: a place picked from the page sends its coordinates. A name typed
 * over it sends none, so an old place's sun never lands on a new trip. The
 * generation is answered by the test, so no model is called.
 */

async function pickPopular(page: Page) {
  await page.goto("/trips/new");
  await acceptEssentialOnly(page);
  const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
  const place = (await pick.getAttribute("aria-label"))?.match(/^Start a trip to (.+) — /)?.[1];
  expect(place, "the pick names its place").toBeTruthy();
  await pick.click();
  await expect(page.getByRole("combobox").first()).toHaveValue(place!);
}

async function generate(page: Page) {
  // The footer's own button: a typed place with no match shows a "Continue with …" button too, which picks
  // the place and stays on step 1.
  await page.getByTestId("wizard-continue").click();
  await page.getByRole("heading", { name: "Set your travel style" }).waitFor({ timeout: 15_000 });
  const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
  const generateButton = page.getByRole("button", { name: "Generate Itinerary" });
  await expect(async () => {
    if (await generateButton.isDisabled()) await foodie.click();
    await expect(generateButton).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await generateButton.click();
}

test.describe("where the place is, for its daylight", () => {
  test("a picked place sends its coordinates with the plan", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    await pickPopular(page);
    await generate(page);

    await expect.poll(() => streamed.length).toBe(1);
    const coords = (streamed[0] as { destinationCoords?: { latitude: number; longitude: number } }).destinationCoords;
    expect(typeof coords?.latitude).toBe("number");
    expect(typeof coords?.longitude).toBe("number");
  });

  test("a name typed over a picked place sends none", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    await pickPopular(page);
    const field = page.getByRole("combobox").first();
    await field.fill("Reykjavik, Iceland");
    await field.press("Escape");
    await generate(page);

    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0].destination).toBe("Reykjavik, Iceland");
    expect(streamed[0]).not.toHaveProperty("destinationCoords");
  });
});
