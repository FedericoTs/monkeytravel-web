import { test, expect, type Page } from "@playwright/test";
import { acceptEssentialOnly } from "./consent-banner";
import { stubGeneration } from "./generation-stub";
import { isolate } from "./wizard-draft";

/**
 * A whole country typed as the destination, with a week's dates, is offered the
 * route most travellers take there, under the dates; one tap plans the trip
 * through those cities. The route, the reading of the dates and the plan are
 * answered by the test, so no model is called.
 */

const ROUTE = [
  { city: "Bangkok", nights: 3 },
  { city: "Chiang Mai", nights: 4 },
];

async function typeCountry(page: Page, route: unknown[]) {
  const asked: Array<{ place: string; days: number; startDate: string; locale: string }> = [];
  await page.route("**/api/wizard/route-plan", async (r) => {
    asked.push(r.request().postDataJSON());
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ route }) });
  });
  // The dates come from a typed request, read by the test.
  await page.route("**/api/wizard/read-request", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reading: {
          places: [{ name: "Thailand", days: 7 }],
          days: 7,
          startDate: "2027-03-10",
          endDate: "2027-03-16",
          month: null,
          who: null,
          vibes: [],
          budget: null,
        },
      }),
    })
  );
  // The search finds nothing, so the place stays as typed: a country, not a picked city.
  await page.route("**/api/destinations/search", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ predictions: [] }) })
  );
  await page.goto("/trips/new");
  await acceptEssentialOnly(page);
  const field = page.getByRole("combobox").first();
  await field.fill("Thailand for a week from 10 to 16 March");
  await field.press("Escape");
  await page.getByRole("button", { name: "Fill in from what I wrote" }).click();
  await expect(field).toHaveValue("Thailand");
  return asked;
}

const ROUTE_18 = [
  { city: "Hanoi", nights: 5 },
  { city: "Hoi An", nights: 6 },
  { city: "Ho Chi Minh City", nights: 7 },
];

/** Days from the first to the last date, both counted. */
const span = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/** "Vietnam" typed, and on the calendar the 1st to the 18th of next month: longer than one place may be. */
async function typeLongTrip(page: Page, route: unknown[]) {
  const asked: Array<{ place: string; days: number }> = [];
  await page.route("**/api/wizard/route-plan", async (r) => {
    asked.push(r.request().postDataJSON());
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ route }) });
  });
  await page.route("**/api/destinations/search", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ predictions: [] }) })
  );
  await page.goto("/trips/new");
  await acceptEssentialOnly(page);
  const field = page.getByRole("combobox").first();
  await field.fill("Vietnam");
  await field.press("Escape");
  await page.getByRole("button", { name: /Check-in/ }).first().click();
  // Next month's days are never in the past, whatever day the test runs.
  await page.getByRole("button", { name: "Next month" }).click();
  await page.getByRole("button", { name: "1", exact: true }).first().click();
  await page.getByRole("button", { name: "18", exact: true }).first().click();
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

test.describe("a whole country typed as the destination", () => {
  test("is offered the usual route under the dates, and one tap opens it in the route builder", async ({ page }) => {
    await isolate(page);
    const { json, streamed } = await stubGeneration(page);
    const asked = await typeCountry(page, ROUTE);

    await expect(page.getByText("Your route through Thailand, 7 days")).toBeVisible({ timeout: 15_000 });
    expect(asked).toEqual([{ place: "Thailand", days: 7, startDate: "2027-03-10", locale: "en" }]);
    await expect(page.getByText("Bangkok · 3 nights")).toBeVisible();
    await page.getByRole("button", { name: "Change the route" }).click();

    await expect(page.getByRole("textbox", { name: "City 1" })).toHaveValue("Bangkok");
    await expect(page.getByRole("textbox", { name: "City 2" })).toHaveValue("Chiang Mai");
    await expect(page.getByRole("spinbutton", { name: "Nights in city 2" })).toHaveValue("4");

    await generate(page);
    await expect.poll(() => json.length).toBe(1);
    expect(streamed).toHaveLength(0);
    expect(json[0]).toMatchObject({
      destination: "Bangkok & Chiang Mai",
      startDate: "2027-03-10",
      endDate: "2027-03-16",
      destinations: ROUTE,
      routeFrom: "Thailand",
    });
  });

  test("gets the country back when the route is switched off", async ({ page }) => {
    await isolate(page);
    await typeCountry(page, ROUTE);
    await page.getByRole("button", { name: "Change the route" }).click({ timeout: 15_000 });
    await page.getByRole("switch", { name: "Toggle multi-city planning" }).click();
    await expect(page.getByRole("combobox").first()).toHaveValue("Thailand");
  });

  test("the date limit names the longer trip a route can take", async ({ page }) => {
    await isolate(page);
    await page.goto("/trips/new");
    await acceptEssentialOnly(page);
    await page.getByRole("button", { name: /Check-in/ }).first().click();
    // Next month's 20th is never in the past, whatever day the test runs.
    await page.getByRole("button", { name: "Next month" }).click();
    await page.getByRole("button", { name: "20", exact: true }).first().click();
    await expect(page.getByText("Up to 14 days in one place, or 21 across several cities")).toBeVisible();
  });

  // The route under the dates is what Continue plans: a country left as one place jumps across it with no ride.
  test("Continue plans the route it shows", async ({ page }) => {
    await isolate(page);
    const { json, streamed } = await stubGeneration(page);
    await typeCountry(page, ROUTE);
    await expect(page.getByText("Continue plans this route.")).toBeVisible({ timeout: 15_000 });
    await generate(page);
    await expect.poll(() => json.length).toBe(1);
    expect(streamed).toHaveLength(0);
    expect(json[0]).toMatchObject({ destinations: ROUTE, routeFrom: "Thailand", startDate: "2027-03-10", endDate: "2027-03-16" });
  });

  test("plans the country as one place when the traveller says so", async ({ page }) => {
    await isolate(page);
    const { json, streamed } = await stubGeneration(page);
    await typeCountry(page, ROUTE);
    await page.getByRole("button", { name: "Plan Thailand as one place" }).click({ timeout: 15_000 });
    await expect(page.getByText("Your route through Thailand, 7 days")).toHaveCount(0);
    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(json).toHaveLength(0);
    expect(streamed[0].destination).toBe("Thailand");
  });

  // One place stops at 14 days; a route through a country goes to 21, so a country typed may take more.
  test("is offered the route for all the days when they are more than one place takes, and Continue plans it", async ({ page }) => {
    await isolate(page);
    const { json, streamed } = await stubGeneration(page);
    const asked = await typeLongTrip(page, ROUTE_18);
    await expect(page.getByText("Your route through Vietnam, 18 days")).toBeVisible({ timeout: 15_000 });
    expect(asked[asked.length - 1]).toMatchObject({ place: "Vietnam", days: 18 });
    await generate(page);
    await expect.poll(() => json.length).toBe(1);
    expect(streamed).toHaveLength(0);
    expect(json[0]).toMatchObject({ destinations: ROUTE_18, routeFrom: "Vietnam" });
    expect(span(json[0].startDate, json[0].endDate)).toBe(18);
  });

  test("planned as one place instead, a longer trip keeps one place's 14 days", async ({ page }) => {
    await isolate(page);
    const { json, streamed } = await stubGeneration(page);
    await typeLongTrip(page, ROUTE_18);
    await page.getByRole("button", { name: "Plan Vietnam as one place, 14 days" }).click({ timeout: 15_000 });
    await expect(page.getByText("Your route through Vietnam", { exact: false })).toHaveCount(0);
    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(json).toHaveLength(0);
    expect(streamed[0].destination).toBe("Vietnam");
    expect(span(streamed[0].startDate, streamed[0].endDate)).toBe(14);
  });

  test("stays one place when no route comes back", async ({ page }) => {
    await isolate(page);
    const { streamed } = await stubGeneration(page);
    const asked = await typeCountry(page, []);
    await expect.poll(() => asked.length, { timeout: 15_000 }).toBe(1);
    await expect(page.getByRole("button", { name: "Change the route" })).toHaveCount(0);
    await generate(page);
    await expect.poll(() => streamed.length).toBe(1);
    expect(streamed[0].destination).toBe("Thailand");
  });
});
