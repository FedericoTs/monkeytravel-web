import { test, expect, type Page } from "@playwright/test";
import { acceptEssentialOnly } from "./consent-banner";
import { stubGeneration } from "./generation-stub";
import { isolate } from "./wizard-draft";

/**
 * A whole trip typed into the destination box ("Bali for 8 days with 3 kids")
 * is read into step 1 on a press: the place or the route, the dates and who's
 * going, with the words carried to the planner as notes. The reading and the
 * plan are answered by the test, so no model is called.
 */

async function typeRequest(page: Page, text: string, reading: unknown) {
  const asked: Array<{ text: string; today: string; locale: string }> = [];
  await page.route("**/api/wizard/read-request", async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reading }) });
  });
  // The search finds nothing, so the place stays as it was read.
  await page.route("**/api/destinations/search", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ predictions: [] }) })
  );
  await page.goto("/trips/new");
  await acceptEssentialOnly(page);
  const field = page.getByRole("combobox").first();
  await field.fill(text);
  await field.press("Escape");
  await page.getByRole("button", { name: "Fill in from what I wrote" }).click();
  return asked;
}

async function generate(page: Page) {
  // Pressed until step 2 shows: right after a change the footer's button can be busy for a moment.
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

const span = (r: { startDate: string; endDate: string }) =>
  Math.round((Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000) + 1;

test.describe("a whole trip typed as the destination", () => {
  test("fills in the place and its days, and the plan gets the words too", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    const request = "Bali for 8 days with 3 kids and our friends; somewhere quiet";
    const asked = await typeRequest(page, request, {
      places: [{ name: "Bali", days: 8 }],
      days: 8,
      startDate: null,
      endDate: null,
      month: null,
      who: "family",
      vibes: [],
      budget: null,
    });

    await expect(page.getByRole("combobox").first()).toHaveValue("Bali");
    await expect(page.getByText(/Filled in from what you wrote/)).toBeVisible();
    expect(asked).toEqual([expect.objectContaining({ text: request, locale: "en" })]);

    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0].destination).toBe("Bali");
    expect(span(streamed[0])).toBe(8);
    expect(String(streamed[0].requirements)).toContain(request);
  });

  test("makes a list of places with their days a route", async ({ page }) => {
    await isolate(page);
    const { json } = await stubGeneration(page);
    await typeRequest(page, "rome 4 days, milan 2 days , turin 2 days , from 14 to 21 March", {
      places: [
        { name: "Rome", days: 4 },
        { name: "Milan", days: 2 },
        { name: "Turin", days: 2 },
      ],
      days: 8,
      startDate: "2027-03-14",
      endDate: "2027-03-21",
      month: null,
      who: null,
      vibes: [],
      budget: null,
    });

    await expect(page.getByRole("textbox", { name: "City 1" })).toHaveValue("Rome");
    await expect(page.getByRole("textbox", { name: "City 3" })).toHaveValue("Turin");
    await expect(page.getByRole("spinbutton", { name: "Nights in city 2" })).toHaveValue("2");

    await generate(page);
    await expect.poll(() => json.length).toBe(1);
    expect(json[0]).toMatchObject({
      destination: "Rome, Milan & Turin",
      startDate: "2027-03-14",
      endDate: "2027-03-21",
      destinations: [
        { city: "Rome", nights: 4 },
        { city: "Milan", nights: 2 },
        { city: "Turin", nights: 2 },
      ],
    });
  });

  test("keeps the days for the place picked next when the request names none", async ({ page }) => {
    await isolate(page);
    await typeRequest(page, "somewhere warm with a beach for 6 days with the kids", {
      places: [],
      days: 6,
      startDate: null,
      endDate: null,
      month: null,
      who: "family",
      vibes: [],
      budget: null,
    });
    await expect(page.getByText("Saved for the next step. Now, where are you going?")).toBeVisible();
    await expect(page.getByRole("combobox").first()).toHaveValue("");
    await expect(page.getByText("6 days", { exact: true })).toBeVisible();
  });

  test("keeps the words for the next step when no place could be read", async ({ page }) => {
    await isolate(page);
    await typeRequest(page, "somewhere warm with the kids in April, not too expensive please", null);
    await expect(page.getByText("Saved for the next step. Now, where are you going?")).toBeVisible();
    await expect(page.getByRole("combobox").first()).toHaveValue("");
  });
});
