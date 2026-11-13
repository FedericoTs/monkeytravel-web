import { test, expect, type Page } from "@playwright/test";
import { acceptEssentialOnly } from "./consent-banner";
import { stubGeneration } from "./generation-stub";
import { isolate } from "./wizard-draft";

/**
 * Where the traveller is staying reaches the plan: a stay picked from the
 * suggestions near the destination sends its words and its place, typed words
 * go on their own. The suggestions and the generation are answered by the
 * test, so neither Photon nor a model is called.
 */

async function pickPopular(page: Page) {
  await page.goto("/trips/new");
  await acceptEssentialOnly(page);
  const pick = page.getByRole("group", { name: "Popular right now" }).getByRole("button").first();
  await pick.click();
}

async function generate(page: Page) {
  // As in daylight-request.spec.ts: the footer's button, pressed until step 2 shows.
  const travelStyle = page.getByRole("heading", { name: "Set your travel style" });
  await expect(async () => {
    if (await travelStyle.isVisible()) return;
    await page.getByTestId("wizard-continue").click({ timeout: 3_000 });
    await expect(travelStyle).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  const foodie = page.getByText("Foodie Journey", { exact: true }).filter({ visible: true }).first();
  const generateButton = page.getByRole("button", { name: "Generate Itinerary" });
  await expect(async () => {
    if (await generateButton.isDisabled()) await foodie.click();
    await expect(generateButton).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
  await generateButton.click();
}

test.describe("where they're staying, for the plan", () => {
  test("a stay picked near the destination goes with the plan, its place too", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    const searched: Array<{ input: string; near: { latitude: number; longitude: number } }> = [];
    // Whichever city "Popular right now" offers first, the hotel is a short walk from its centre.
    const nearby = ({ latitude, longitude }: { latitude: number; longitude: number }) => ({ lat: latitude + 0.01, lng: longitude + 0.01 });
    await page.route("**/api/places/stay-search", async (route) => {
      const asked = route.request().postDataJSON();
      searched.push(asked);
      await route.fulfill({
        json: { places: [{ name: "Riverside Hotel", detail: "Main Street 27", ...nearby(asked.near) }] },
      });
    });
    await pickPopular(page);

    await page.getByRole("button", { name: "+ Add where you’re staying" }).click();
    const stayBox = page.getByRole("combobox", { name: "Where are you staying?" });
    await stayBox.fill("riverside");
    await page.getByRole("option", { name: /Riverside Hotel/ }).click();
    await expect(stayBox).toHaveValue("Riverside Hotel");
    expect(typeof searched[0]?.near.latitude).toBe("number");
    const { lat, lng } = nearby(searched[0].near);

    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0]).toMatchObject({ stay: "Riverside Hotel", stayCoords: { latitude: lat, longitude: lng } });
  });

  test("typed words go on their own, with no place", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    await page.route("**/api/places/stay-search", (route) => route.fulfill({ json: { places: [] } }));
    await pickPopular(page);

    await page.getByRole("button", { name: "+ Add where you’re staying" }).click();
    const stayBox = page.getByRole("combobox", { name: "Where are you staying?" });
    await stayBox.fill("an apartment near the Rossio");
    await stayBox.press("Tab");

    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0].stay).toBe("an apartment near the Rossio");
    expect(streamed[0]).not.toHaveProperty("stayCoords");
  });
});
